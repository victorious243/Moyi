const axios = require('axios');
const env = require('../config/env');
const GoogleIntegration = require('../models/GoogleIntegration');
const ProjectSearchProperty = require('../models/ProjectSearchProperty');
const SearchMetric = require('../models/SearchMetric');
const { decrypt, encrypt } = require('../utils/crypto');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEARCH_CONSOLE_API = 'https://searchconsole.googleapis.com/webmasters/v3';
const SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly'];

function assertGoogleConfigured() {
  if (!env.googleClientId || !env.googleClientSecret || !env.googleRedirectUri) {
    const error = new Error('Google OAuth is not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.');
    error.statusCode = 503;
    throw error;
  }
}

function buildGoogleAuthUrl({ state }) {
  assertGoogleConfigured();
  const params = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: env.googleRedirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  assertGoogleConfigured();
  const response = await axios.post(GOOGLE_TOKEN_URL, new URLSearchParams({
    code,
    client_id: env.googleClientId,
    client_secret: env.googleClientSecret,
    redirect_uri: env.googleRedirectUri,
    grant_type: 'authorization_code'
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  return response.data;
}

async function storeGoogleIntegration(userId, tokenPayload) {
  if (!tokenPayload.access_token) {
    const error = new Error('Google did not return an access token. Please try connecting again.');
    error.statusCode = 502;
    throw error;
  }

  const existing = await GoogleIntegration.findOne({ userId, provider: 'google' });
  const refreshToken = tokenPayload.refresh_token || (existing ? decrypt(existing.refreshToken) : '');
  const expiresAt = tokenPayload.expires_in ? new Date(Date.now() + tokenPayload.expires_in * 1000) : undefined;

  return GoogleIntegration.findOneAndUpdate(
    { userId, provider: 'google' },
    {
      userId,
      provider: 'google',
      accessToken: encrypt(tokenPayload.access_token),
      refreshToken: encrypt(refreshToken),
      scopes: String(tokenPayload.scope || SCOPES.join(' ')).split(/\s+/).filter(Boolean),
      expiresAt,
      connectedAt: existing ? existing.connectedAt : new Date()
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
}

async function getIntegration(userId) {
  return GoogleIntegration.findOne({ userId, provider: 'google' });
}

async function refreshAccessToken(integration) {
  assertGoogleConfigured();
  const refreshToken = decrypt(integration.refreshToken);
  if (!refreshToken) {
    const error = new Error('Google refresh token is missing. Reconnect Google Search Console.');
    error.statusCode = 401;
    throw error;
  }

  const response = await axios.post(GOOGLE_TOKEN_URL, new URLSearchParams({
    client_id: env.googleClientId,
    client_secret: env.googleClientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  integration.accessToken = encrypt(response.data.access_token);
  integration.expiresAt = response.data.expires_in ? new Date(Date.now() + response.data.expires_in * 1000) : integration.expiresAt;
  await integration.save();
  return response.data.access_token;
}

async function getAccessToken(userId) {
  const integration = await getIntegration(userId);
  if (!integration) {
    const error = new Error('Connect Google Search Console first.');
    error.statusCode = 401;
    throw error;
  }

  const expiresAt = integration.expiresAt ? integration.expiresAt.getTime() : 0;
  if (expiresAt && expiresAt < Date.now() + 60 * 1000) {
    return refreshAccessToken(integration);
  }

  return decrypt(integration.accessToken);
}

async function googleRequest(userId, config) {
  let token = await getAccessToken(userId);

  try {
    return await axios({
      ...config,
      headers: {
        ...(config.headers || {}),
        Authorization: `Bearer ${token}`
      }
    });
  } catch (error) {
    if (error.response && error.response.status === 401) {
      const integration = await getIntegration(userId);
      token = await refreshAccessToken(integration);
      return axios({
        ...config,
        headers: {
          ...(config.headers || {}),
          Authorization: `Bearer ${token}`
        }
      });
    }
    throw error;
  }
}

async function listSearchConsoleSites(userId) {
  const response = await googleRequest(userId, {
    method: 'get',
    url: `${SEARCH_CONSOLE_API}/sites`
  });

  return (response.data.siteEntry || []).map((site) => ({
    siteUrl: site.siteUrl,
    permissionLevel: site.permissionLevel
  }));
}

function dateDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function syncSearchConsoleProject({ project, userId, days = 28 }) {
  const property = await ProjectSearchProperty.findOne({ projectId: project._id, userId });
  if (!property) {
    const error = new Error('No Search Console property is connected to this project.');
    error.statusCode = 422;
    throw error;
  }

  const startDate = dateDaysAgo(Number(days) || 28);
  const endDate = dateDaysAgo(1);
  const response = await googleRequest(userId, {
    method: 'post',
    url: `${SEARCH_CONSOLE_API}/sites/${encodeURIComponent(property.siteUrl)}/searchAnalytics/query`,
    data: {
      startDate,
      endDate,
      dimensions: ['date', 'query', 'page', 'country', 'device'],
      rowLimit: 25000
    }
  });

  const rows = response.data.rows || [];
  const operations = rows.map((row) => {
    const [date, query, page, country, device] = row.keys || ['', '', '', '', ''];
    return {
      updateOne: {
        filter: {
          projectId: project._id,
          userId,
          siteUrl: property.siteUrl,
          date,
          query: query || '',
          page: page || '',
          country: country || '',
          device: device || ''
        },
        update: {
          $set: {
            clicks: row.clicks || 0,
            impressions: row.impressions || 0,
            ctr: row.ctr || 0,
            position: row.position || 0
          }
        },
        upsert: true
      }
    };
  });

  if (operations.length) {
    await SearchMetric.bulkWrite(operations, { ordered: false });
  }

  property.lastSyncedAt = new Date();
  await property.save();

  return {
    rowsSynced: rows.length,
    startDate,
    endDate,
    property
  };
}

function summarizeMetrics(metrics) {
  const totalClicks = metrics.reduce((sum, item) => sum + item.clicks, 0);
  const totalImpressions = metrics.reduce((sum, item) => sum + item.impressions, 0);
  const weightedPositionNumerator = metrics.reduce((sum, item) => sum + (item.position || 0) * (item.impressions || 0), 0);
  const averageCtr = totalImpressions ? totalClicks / totalImpressions : 0;
  const averagePosition = totalImpressions ? weightedPositionNumerator / totalImpressions : 0;

  return {
    totalClicks,
    totalImpressions,
    averageCtr,
    averagePosition
  };
}

function groupBy(metrics, key) {
  const map = new Map();
  metrics.forEach((metric) => {
    const value = metric[key] || '(not set)';
    const item = map.get(value) || { value, clicks: 0, impressions: 0, weightedPosition: 0 };
    item.clicks += metric.clicks || 0;
    item.impressions += metric.impressions || 0;
    item.weightedPosition += (metric.position || 0) * (metric.impressions || 0);
    map.set(value, item);
  });

  return [...map.values()].map((item) => ({
    ...item,
    ctr: item.impressions ? item.clicks / item.impressions : 0,
    position: item.impressions ? item.weightedPosition / item.impressions : 0
  }));
}

function groupQueryPageMetrics(metrics) {
  const map = new Map();
  metrics.forEach((metric) => {
    if (!metric.query || !metric.page) return;
    const key = `${metric.query}|||${metric.page}`;
    const item = map.get(key) || {
      query: metric.query,
      page: metric.page,
      clicks: 0,
      impressions: 0,
      weightedPosition: 0
    };

    item.clicks += metric.clicks || 0;
    item.impressions += metric.impressions || 0;
    item.weightedPosition += (metric.position || 0) * (metric.impressions || 0);
    map.set(key, item);
  });

  return [...map.values()].map((item) => ({
    ...item,
    ctr: item.impressions ? item.clicks / item.impressions : 0,
    position: item.impressions ? item.weightedPosition / item.impressions : 0
  }));
}

async function calculateGscOpportunities(projectId) {
  const metrics = await SearchMetric.find({ projectId }).lean();
  const summary = summarizeMetrics(metrics);
  const averageCtr = summary.averageCtr;
  const queryPageMetrics = groupQueryPageMetrics(metrics);
  const sortedByImpressions = queryPageMetrics.slice().sort((a, b) => b.impressions - a.impressions);
  const highImpressionThreshold = sortedByImpressions.length
    ? Math.max(50, sortedByImpressions[Math.min(sortedByImpressions.length - 1, 9)].impressions)
    : 50;

  const boostCtr = sortedByImpressions
    .filter((item) => item.impressions >= 20 && item.position >= 1 && item.position <= 10 && item.ctr < averageCtr)
    .slice(0, 10)
    .map((item) => ({
      type: 'boost_ctr',
      title: 'Boost CTR',
      actionLabel: 'Create Optimization Draft',
      query: item.query,
      page: item.page,
      clicks: item.clicks,
      impressions: item.impressions,
      ctr: item.ctr,
      position: item.position,
      benchmarkCtr: averageCtr,
      reason: 'This query is already on page 1, but its CTR is below the project average.',
      recommendation: 'Update the page meta title and meta description to better match the search intent.'
    }));

  const pushToPageOne = sortedByImpressions
    .filter((item) => item.impressions >= highImpressionThreshold && item.position > 10 && item.position <= 20)
    .slice(0, 10)
    .map((item) => ({
      type: 'push_to_page_one',
      title: 'Push to Page 1',
      actionLabel: 'Create Content Draft',
      query: item.query,
      page: item.page,
      clicks: item.clicks,
      impressions: item.impressions,
      ctr: item.ctr,
      position: item.position,
      benchmarkCtr: averageCtr,
      reason: 'This query has strong demand and is close enough to page 1 to be worth improving.',
      recommendation: 'Expand the target page with intent-matched sections, subheadings, FAQs, and internal links.'
    }));

  return {
    averageCtr,
    highImpressionThreshold,
    boostCtr,
    pushToPageOne,
    total: boostCtr.length + pushToPageOne.length
  };
}

async function buildPerformanceDashboard({ projectId, userId, days = 28 }) {
  const startDate = dateDaysAgo(Number(days) || 28);
  const metrics = await SearchMetric.find({ projectId, userId, date: { $gte: startDate } }).lean();
  const summary = summarizeMetrics(metrics);
  const queryGroups = groupBy(metrics, 'query').filter((item) => item.value !== '(not set)');
  const pageGroups = groupBy(metrics, 'page').filter((item) => item.value !== '(not set)');

  const topQueries = queryGroups.sort((a, b) => b.clicks - a.clicks).slice(0, 10);
  const topPages = pageGroups.sort((a, b) => b.clicks - a.clicks).slice(0, 10);
  const highImpressionsLowCtr = pageGroups
    .filter((item) => item.impressions >= 50 && item.ctr < 0.02)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10);
  const queriesCloseToPageOne = queryGroups
    .filter((item) => item.position > 10 && item.position <= 15)
    .sort((a, b) => a.position - b.position)
    .slice(0, 10);

  const midpoint = dateDaysAgo(Math.ceil((Number(days) || 28) / 2));
  const older = metrics.filter((item) => item.date < midpoint);
  const newer = metrics.filter((item) => item.date >= midpoint);
  const olderPages = groupBy(older, 'page');
  const newerPages = groupBy(newer, 'page');
  const newerMap = new Map(newerPages.map((item) => [item.value, item]));

  const visibility = olderPages.map((oldPage) => {
    const newPage = newerMap.get(oldPage.value) || { clicks: 0, impressions: 0 };
    return {
      page: oldPage.value,
      oldImpressions: oldPage.impressions,
      newImpressions: newPage.impressions,
      change: newPage.impressions - oldPage.impressions
    };
  });

  return {
    summary,
    topQueries,
    topPages,
    highImpressionsLowCtr,
    queriesCloseToPageOne,
    pagesLosingVisibility: visibility.filter((item) => item.change < 0).sort((a, b) => a.change - b.change).slice(0, 10),
    pagesGainingVisibility: visibility.filter((item) => item.change > 0).sort((a, b) => b.change - a.change).slice(0, 10)
  };
}

module.exports = {
  SCOPES,
  buildGoogleAuthUrl,
  calculateGscOpportunities,
  buildPerformanceDashboard,
  exchangeCodeForTokens,
  getIntegration,
  listSearchConsoleSites,
  storeGoogleIntegration,
  syncSearchConsoleProject
};
