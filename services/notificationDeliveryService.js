const crypto = require('crypto');
const https = require('https');
const axios = require('axios');
const env = require('../config/env');
const GrowthAlert = require('../models/GrowthAlert');
const NotificationDelivery = require('../models/NotificationDelivery');
const NotificationEndpoint = require('../models/NotificationEndpoint');
const Project = require('../models/Project');
const emailService = require('./emailService');
const {
  getNotificationEndpointCredentials,
  resolvePublicNotificationEndpoint
} = require('./notificationEndpointService');
const { resolveNotificationRouting } = require('./notificationRoutingService');

const SEVERITY_RANK = {
  info: 0,
  growth_opportunity: 1,
  warning: 2,
  critical: 3
};

const SENSITIVITY_RANK = {
  all: 0,
  important: 1,
  high: 2,
  critical: 3
};

function passesSeverityFilter(severity, sensitivity = 'high') {
  return (SEVERITY_RANK[severity] ?? 0) >= (SENSITIVITY_RANK[sensitivity] ?? 2);
}

function safeEvidence(value, depth = 0) {
  if (depth > 3) return undefined;
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => safeEvidence(item, depth + 1));
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? value.slice(0, 500) : value;
  }
  return Object.entries(value).reduce((result, [key, item]) => {
    if (/(token|secret|credential|password|authorization|cookie|internal.*id)/i.test(key)
      || /^(id|_id)$/.test(key)
      || /(?:Id|Ids|_id|_ids)$/.test(key)) return result;
    const safeValue = safeEvidence(item, depth + 1);
    if (safeValue !== undefined) result[key] = safeValue;
    return result;
  }, {});
}

function safeDeepLink(value, projectId) {
  const fallback = `${String(env.appUrl).replace(/\/$/, '')}/projects/${projectId}`;
  try {
    const candidate = new URL(value || fallback, env.appUrl);
    const appOrigin = new URL(env.appUrl).origin;
    return candidate.origin === appOrigin ? candidate.toString() : fallback;
  } catch (error) {
    return fallback;
  }
}

function buildNotificationPayload({ project, alert }) {
  return {
    source: 'Moyi-CMO',
    version: '1.0',
    project: {
      name: project.name,
      website: project.websiteUrl || ''
    },
    alert: {
      title: alert.title,
      severity: alert.severity,
      category: alert.category,
      summary: alert.summary,
      urgency: alert.urgency,
      confidence: alert.confidence,
      businessImpact: alert.businessImpact || '',
      evidence: safeEvidence(alert.evidenceData || {}),
      recommendedAction: alert.recommendedAction || '',
      action: {
        label: alert.ctaLabel || 'Open in Moyi',
        url: safeDeepLink(alert.ctaUrl, project._id)
      },
      occurredAt: (alert.createdAt || new Date()).toISOString()
    }
  };
}

function adapterPayload(channel, payload) {
  const { project, alert } = payload;
  const heading = `${alert.severity.toUpperCase()}: ${alert.title}`;
  if (channel === 'slack') {
    return {
      text: `${heading} - ${project.name}`,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: alert.title.slice(0, 150) } },
        { type: 'section', fields: [
          { type: 'mrkdwn', text: `*Project*\n${project.name}` },
          { type: 'mrkdwn', text: `*Severity*\n${alert.severity}` }
        ] },
        { type: 'section', text: { type: 'mrkdwn', text: alert.summary.slice(0, 2500) } },
        ...(alert.recommendedAction ? [{ type: 'section', text: { type: 'mrkdwn', text: `*Recommended action*\n${alert.recommendedAction.slice(0, 1000)}` } }] : []),
        { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: alert.action.label.slice(0, 75) }, url: alert.action.url }] }
      ]
    };
  }
  if (channel === 'teams') {
    return {
      type: 'message',
      attachments: [{
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            { type: 'TextBlock', text: alert.title, weight: 'Bolder', size: 'Large', wrap: true },
            { type: 'FactSet', facts: [{ title: 'Project', value: project.name }, { title: 'Severity', value: alert.severity }, { title: 'Category', value: alert.category }] },
            { type: 'TextBlock', text: alert.summary, wrap: true },
            ...(alert.recommendedAction ? [{ type: 'TextBlock', text: `Recommended action: ${alert.recommendedAction}`, wrap: true }] : [])
          ],
          actions: [{ type: 'Action.OpenUrl', title: alert.action.label, url: alert.action.url }]
        }
      }]
    };
  }
  if (channel === 'discord') {
    return {
      content: `${alert.title} - ${project.name}`.slice(0, 2000),
      embeds: [{
        title: alert.title.slice(0, 256),
        description: alert.summary.slice(0, 4096),
        url: alert.action.url,
        fields: [
          { name: 'Severity', value: alert.severity, inline: true },
          { name: 'Category', value: alert.category, inline: true },
          ...(alert.recommendedAction ? [{ name: 'Recommended action', value: alert.recommendedAction.slice(0, 1024) }] : [])
        ]
      }]
    };
  }
  return payload;
}

function notificationEmail({ project, alert, customEmail }) {
  if (customEmail) return customEmail;
  const actionUrl = safeDeepLink(alert.ctaUrl, project._id);
  const body = [
    `<p><strong>Project:</strong> ${emailService.escapeHtml(project.name)}</p>`,
    `<p>${emailService.escapeHtml(alert.summary)}</p>`,
    alert.businessImpact ? `<p><strong>Business impact:</strong> ${emailService.escapeHtml(alert.businessImpact)}</p>` : '',
    alert.recommendedAction ? `<p><strong>Recommended action:</strong> ${emailService.escapeHtml(alert.recommendedAction)}</p>` : ''
  ].join('');
  return {
    subject: `[Moyi ${alert.severity}] ${alert.title}`,
    html: emailService.wrapEmail({
      heading: alert.title,
      intro: `${project.name} marketing notification`,
      bodyHtml: body,
      ctaUrl: actionUrl,
      ctaLabel: alert.ctaLabel || 'Open in Moyi'
    }),
    text: `${alert.title}\n\n${alert.summary}\n\n${alert.recommendedAction || ''}\n\n${actionUrl}`
  };
}

function createNotificationDeliveryService(deps = {}) {
  const AlertModel = deps.GrowthAlert || GrowthAlert;
  const DeliveryModel = deps.NotificationDelivery || NotificationDelivery;
  const EndpointModel = deps.NotificationEndpoint || NotificationEndpoint;
  const ProjectModel = deps.Project || Project;
  const http = deps.http || axios;
  const sendEmail = deps.sendEmail || emailService.sendEmail;
  const resolveRouting = deps.resolveRouting || resolveNotificationRouting;
  const getCredentials = deps.getCredentials || getNotificationEndpointCredentials;
  const resolveEndpoint = deps.resolveEndpoint || (deps.validateEndpoint
    ? async (url, channel) => ({ url: await deps.validateEndpoint(url, channel) })
    : resolvePublicNotificationEndpoint);
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  async function writeDelivery(values) {
    return DeliveryModel.create(values);
  }

  async function deliverWebhook({ project, alert, endpoint, maxAttempts = 3 }) {
    const credentials = await getCredentials({ endpointId: endpoint._id, projectId: project._id });
    if (!credentials) throw new Error('Notification endpoint is no longer available.');
    const resolvedEndpoint = await resolveEndpoint(credentials.url, endpoint.channel);
    const url = typeof resolvedEndpoint === 'string' ? resolvedEndpoint : resolvedEndpoint.url;
    const httpsAgent = resolvedEndpoint && resolvedEndpoint.address
      ? new https.Agent({
          keepAlive: false,
          lookup: (hostname, options, callback) => {
            if (hostname !== resolvedEndpoint.hostname) return callback(new Error('Webhook hostname changed during delivery.'));
            if (options && options.all) {
              return callback(null, [{ address: resolvedEndpoint.address, family: resolvedEndpoint.family || 4 }]);
            }
            return callback(null, resolvedEndpoint.address, resolvedEndpoint.family || 4);
          }
        })
      : undefined;
    const canonicalPayload = buildNotificationPayload({ project, alert });
    const body = adapterPayload(endpoint.channel, canonicalPayload);
    const serialized = JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json', 'User-Agent': 'Moyi-CMO-Notifications/1.0' };
    if (endpoint.channel === 'webhook' && credentials.signingSecret) {
      headers['X-Moyi-Signature'] = `sha256=${crypto.createHmac('sha256', credentials.signingSecret).update(serialized).digest('hex')}`;
    }
    const delivery = await writeDelivery({
      projectId: project._id,
      alertId: alert._id,
      endpointId: endpoint._id,
      channel: endpoint.channel,
      recipient: endpoint.urlHint,
      dedupeKey: `${alert._id}:${endpoint._id}`
    });

    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        delivery.attempts = attempt;
        delivery.lastAttemptAt = new Date();
        const response = await http.post(url, serialized, {
          headers,
          timeout: 10000,
          maxRedirects: 0,
          ...(httpsAgent ? { httpsAgent } : {}),
          validateStatus: (status) => status >= 200 && status < 300
        });
        delivery.status = 'sent';
        delivery.statusCode = response.status;
        delivery.deliveredAt = new Date();
        delivery.errorMessage = '';
        await delivery.save();
        await EndpointModel.updateOne({ _id: endpoint._id, projectId: project._id }, {
          $set: { status: 'active', failureCount: 0, lastAttemptAt: new Date(), lastSuccessAt: new Date(), lastError: '' }
        });
        return delivery;
      } catch (error) {
        lastError = error;
        delivery.attempts = attempt;
        delivery.statusCode = error.response && error.response.status || 0;
        delivery.errorMessage = String(error.message || 'Webhook delivery failed.').slice(0, 500);
        delivery.lastAttemptAt = new Date();
        if (attempt < maxAttempts) {
          delivery.nextRetryAt = new Date(Date.now() + attempt * 30000);
          await delivery.save();
          await sleep(attempt * 250);
        }
      }
    }
    delivery.status = 'failed';
    delivery.nextRetryAt = null;
    await delivery.save();
    await EndpointModel.updateOne({ _id: endpoint._id, projectId: project._id }, {
      $set: { status: 'error', lastAttemptAt: new Date(), lastError: delivery.errorMessage },
      $inc: { failureCount: 1 }
    });
    throw lastError;
  }

  async function deliverEmail({ project, alert, recipient, customEmail }) {
    const delivery = await writeDelivery({
      projectId: project._id,
      alertId: alert._id,
      channel: 'email',
      recipient,
      dedupeKey: `${alert._id}:email:${recipient}`
    });
    try {
      delivery.attempts = 1;
      delivery.lastAttemptAt = new Date();
      await sendEmail({ to: recipient, ...notificationEmail({ project, alert, customEmail }) });
      delivery.status = 'sent';
      delivery.deliveredAt = new Date();
    } catch (error) {
      delivery.status = 'failed';
      delivery.errorMessage = String(error.message || 'Email delivery failed.').slice(0, 500);
    }
    await delivery.save();
    return delivery;
  }

  async function createAndDispatchNotification(values) {
    const project = values.project && values.project._id
      ? values.project
      : await ProjectModel.findById(values.projectId || values.project).populate('owner');
    if (!project) throw new Error('Project not found for notification delivery.');
    const alertConfig = project.cmoNotifications && project.cmoNotifications.growthAlerts || {};
    if (!values.force && alertConfig.enabled === false) return { skipped: true, reason: 'Project alerts are disabled.' };
    if (!values.force && !passesSeverityFilter(values.severity || 'info', alertConfig.minSeverity || 'high')) {
      return { skipped: true, reason: 'Alert is below the project sensitivity threshold.' };
    }
    const routing = values.routing || await resolveRouting({ project, category: values.category || 'general' });
    if (!routing.channels.length) return { skipped: true, reason: 'No delivery route is enabled for this category.' };
    const alertData = {
      projectId: project._id,
      userId: project.owner && project.owner._id ? project.owner._id : project.owner,
      recipientUserIds: routing.users.map((user) => user._id),
      type: values.type,
      category: values.category || 'general',
      severity: values.severity || 'info',
      urgency: values.urgency || 'normal',
      confidence: values.confidence ?? 70,
      businessImpact: values.businessImpact || '',
      title: values.title,
      summary: values.summary,
      evidenceData: safeEvidence(values.evidenceData || {}),
      recommendedAction: values.recommendedAction || '',
      ctaUrl: safeDeepLink(values.ctaUrl, project._id),
      ctaLabel: values.ctaLabel || 'Open in Moyi',
      channels: routing.channels,
      deliveryPolicy: values.deliveryPolicy || 'immediate',
      recipientRouting: {
        category: values.category || 'general',
        userCount: routing.users.length,
        externalEmailCount: Math.max(0, routing.emails.length - routing.users.length),
        endpointCount: routing.endpoints.length
      },
      recipientEmail: routing.emails[0] || '',
      deliveryStatus: 'pending',
      dedupeKey: values.dedupeKey || ''
    };
    let alert;
    try {
      alert = await AlertModel.create(alertData);
    } catch (error) {
      if (error && error.code === 11000 && values.dedupeKey) {
        return { skipped: true, duplicate: true, reason: 'This notification was already delivered.' };
      }
      throw error;
    }

    const tasks = [];
    if (routing.channels.includes('in_app')) {
      tasks.push(writeDelivery({
        projectId: project._id,
        alertId: alert._id,
        channel: 'in_app',
        status: 'sent',
        attempts: 1,
        deliveredAt: new Date(),
        dedupeKey: `${alert._id}:in_app`
      }));
    }
    if (routing.channels.includes('email')) {
      routing.emails.forEach((recipient) => tasks.push(deliverEmail({ project, alert, recipient, customEmail: values.customEmail })));
    }
    routing.endpoints
      .filter((endpoint) => routing.channels.includes(endpoint.channel))
      .forEach((endpoint) => tasks.push(deliverWebhook({ project, alert, endpoint })));

    const settled = await Promise.allSettled(tasks);
    const sent = settled.filter((item) => item.status === 'fulfilled' && (!item.value || item.value.status === 'sent')).length;
    const failed = settled.length - sent;
    alert.deliveryStatus = sent ? 'sent' : 'failed';
    alert.sentAt = sent ? new Date() : null;
    await alert.save();
    return { alert, sent, failed, deliveries: settled };
  }

  return {
    createAndDispatchNotification,
    deliverEmail,
    deliverWebhook
  };
}

module.exports = {
  adapterPayload,
  buildNotificationPayload,
  createNotificationDeliveryService,
  passesSeverityFilter,
  safeDeepLink,
  safeEvidence,
  ...createNotificationDeliveryService()
};
