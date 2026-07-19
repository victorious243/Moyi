const crypto = require('crypto');
const env = require('../config/env');
const ConversionGoal = require('../models/ConversionGoal');
const Project = require('../models/Project');
const TrackingEvent = require('../models/TrackingEvent');

function sanitize(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function hashIp(ip) {
  const value = sanitize(ip, 120);
  if (!value) return '';
  return crypto.createHmac('sha256', env.tokenEncryptionSecret || env.jwtSecret).update(value).digest('hex');
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.ip || req.socket.remoteAddress || '';
}

function countryFromHeaders(req) {
  return sanitize(
    req.headers['x-vercel-ip-country'] ||
    req.headers['cf-ipcountry'] ||
    req.headers['x-country-code'] ||
    '',
    8
  ).toUpperCase();
}

function detectDevice(userAgent) {
  const ua = String(userAgent || '');
  if (/mobile|iphone|android/i.test(ua)) return 'mobile';
  if (/ipad|tablet/i.test(ua)) return 'tablet';
  return 'desktop';
}

function detectBrowser(userAgent) {
  const ua = String(userAgent || '');
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
  return 'Other';
}

function eventType(value) {
  return ['page_view', 'conversion', 'custom'].includes(value) ? value : 'page_view';
}

async function matchingGoalEvent(projectId, url) {
  const goals = await ConversionGoal.find({ projectId, urlPattern: { $ne: '' } }).lean();
  const match = goals.find((goal) => String(url || '').includes(goal.urlPattern));
  return match ? match.eventName : '';
}

async function recordTrackingEvent(req) {
  const body = req.body || {};
  const publicProjectKey = sanitize(body.projectKey || body.publicProjectKey, 80);
  const project = await Project.findOne({ publicProjectKey });
  if (!project) {
    const error = new Error('Unknown tracking project.');
    error.statusCode = 404;
    throw error;
  }

  const userAgent = sanitize(req.headers['user-agent'] || body.userAgent, 500);
  const cleanUrl = sanitize(body.url, 1000);
  let type = eventType(body.eventType);
  let name = sanitize(body.eventName, 120);
  const matchedGoal = type === 'page_view' ? await matchingGoalEvent(project._id, cleanUrl) : '';
  if (matchedGoal) {
    type = 'conversion';
    name = matchedGoal;
  }

  const event = await TrackingEvent.create({
    projectId: project._id,
    publicProjectKey,
    eventType: type,
    eventName: name,
    sessionId: sanitize(body.sessionId, 120) || crypto.randomBytes(12).toString('hex'),
    visitorId: sanitize(body.visitorId, 120),
    resolvedCustomerId: sanitize(body.customerId || body.resolvedCustomerId, 160),
    resolvedEmail: sanitize(body.email || body.resolvedEmail, 240).toLowerCase(),
    stripeCustomerId: sanitize(body.stripeCustomerId, 160),
    url: cleanUrl,
    referrer: sanitize(body.referrer, 1000),
    utmSource: sanitize(body.utmSource, 160),
    utmMedium: sanitize(body.utmMedium, 160),
    utmCampaign: sanitize(body.utmCampaign, 160),
    deviceType: sanitize(body.deviceType, 40) || detectDevice(userAgent),
    browser: sanitize(body.browser, 80) || detectBrowser(userAgent),
    userAgent,
    ipHash: hashIp(clientIp(req)),
    country: countryFromHeaders(req)
  });

  return event;
}

function startDate(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Number(days || 30) + 1);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

async function groupedCount(match, field, limit = 10) {
  return TrackingEvent.aggregate([
    { $match: match },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit }
  ]);
}

async function buildAnalyticsDashboard(projectId, days = 30) {
  const since = startDate(days);
  const match = { projectId, createdAt: { $gte: since } };
  const [pageViews, sessions, conversions, topPages, topReferrers, utmCampaigns, goals] = await Promise.all([
    TrackingEvent.countDocuments({ ...match, eventType: 'page_view' }),
    TrackingEvent.distinct('sessionId', match),
    TrackingEvent.countDocuments({ ...match, eventType: 'conversion' }),
    groupedCount({ ...match, eventType: 'page_view' }, 'url', 10),
    groupedCount({ ...match, referrer: { $ne: '' } }, 'referrer', 10),
    groupedCount({ ...match, utmCampaign: { $ne: '' } }, 'utmCampaign', 10),
    ConversionGoal.find({ projectId }).sort({ createdAt: -1 })
  ]);

  const visitors = sessions.length;
  return {
    days,
    visitors,
    sessions: sessions.length,
    pageViews,
    conversions,
    conversionRate: sessions.length ? conversions / sessions.length : 0,
    topPages,
    topReferrers,
    utmCampaigns,
    goals
  };
}

module.exports = {
  buildAnalyticsDashboard,
  recordTrackingEvent
};
