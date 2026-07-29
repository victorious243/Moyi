const crypto = require('crypto');
const axios = require('axios');

function plainTextToHtml(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${paragraph.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function metaTagsForDraft(draft) {
  const tags = {};
  if (draft.type === 'meta_title') tags.title = draft.body || draft.title || '';
  if (draft.type === 'meta_description') tags.description = draft.body || '';
  if (draft.title) tags.ogTitle = draft.title;
  return tags;
}

function webhookPayload({ project, draft }) {
  return {
    event: 'content_draft.approved',
    sentAt: new Date().toISOString(),
    project: {
      id: project._id.toString(),
      name: project.name,
      websiteUrl: project.websiteUrl
    },
    draft: {
      id: draft._id.toString(),
      type: draft.type,
      status: draft.status,
      title: draft.title || '',
      body: draft.body || '',
      htmlBody: plainTextToHtml(draft.body || ''),
      metaTags: metaTagsForDraft(draft),
      keyword: draft.keyword || '',
      keywords: draft.keyword ? [draft.keyword] : [],
      targetUrl: draft.targetUrl || '',
      improvementReason: draft.improvementReason || '',
      executionContext: draft.executionContext || null,
      reviewNotes: draft.reviewNotes || '',
      approvedAt: draft.approvedAt ? draft.approvedAt.toISOString() : null,
      jsonBody: draft.jsonBody || null
    }
  };
}

function signPayload(body, secret) {
  return crypto.createHmac('sha256', String(secret || '')).update(body).digest('hex');
}

async function sendContentApprovedWebhook({ project, draft }) {
  if (!project.webhookUrl) {
    return { skipped: true, reason: 'No webhook URL configured.' };
  }

  const payload = webhookPayload({ project, draft });
  const body = JSON.stringify(payload);
  const signature = signPayload(body, project.webhookSigningSecret);

  const response = await axios.post(project.webhookUrl, body, {
    timeout: 10000,
    headers: {
      'Content-Type': 'application/json',
      'X-Moyi-Signature': signature,
      'X-Moyi-Event': payload.event
    },
    validateStatus: () => true
  });

  if (response.status < 200 || response.status >= 300) {
    const error = new Error(`Webhook returned HTTP ${response.status}.`);
    error.statusCode = response.status;
    throw error;
  }

  return {
    skipped: false,
    status: response.status
  };
}

module.exports = {
  plainTextToHtml,
  sendContentApprovedWebhook,
  signPayload,
  webhookPayload
};
