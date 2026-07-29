const axios = require('axios');
const WordPressIntegration = require('../models/WordPressIntegration');
const PublishAction = require('../models/PublishAction');
const { decrypt, encrypt } = require('../utils/crypto');
const { normalizeUrl } = require('../utils/url');

function apiBase(siteUrl) {
  return `${normalizeUrl(siteUrl)}/wp-json/wp/v2`;
}

function authHeader(integration) {
  const token = Buffer.from(`${integration.username}:${decrypt(integration.appPassword)}`).toString('base64');
  return `Basic ${token}`;
}

function wpClient(integration) {
  return axios.create({
    baseURL: apiBase(integration.siteUrl),
    timeout: 15000,
    headers: {
      Authorization: authHeader(integration),
      Accept: 'application/json'
    },
    validateStatus: () => true
  });
}

function wordpressError(response, fallback = 'WordPress request failed.') {
  const message = response && response.data && (response.data.message || response.data.code)
    ? `${response.data.message || response.data.code}`
    : fallback;
  const error = new Error(message);
  error.statusCode = response ? response.status : 502;
  return error;
}

async function upsertWordPressIntegration({ projectId, userId, siteUrl, username, appPassword }) {
  return WordPressIntegration.findOneAndUpdate(
    { projectId, userId },
    {
      projectId,
      userId,
      siteUrl: normalizeUrl(siteUrl),
      username,
      appPassword: encrypt(appPassword),
      status: 'disconnected'
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
}

async function testWordPressConnection(integration) {
  const response = await wpClient(integration).get('/users/me');
  integration.lastTestedAt = new Date();

  if (response.status >= 200 && response.status < 300) {
    integration.status = 'connected';
    await integration.save();
    return response.data;
  }

  integration.status = 'error';
  await integration.save();
  throw wordpressError(response, 'Could not connect to WordPress.');
}

async function fetchWordPressPages(integration) {
  const client = wpClient(integration);
  const [pagesResponse, postsResponse] = await Promise.all([
    client.get('/pages', { params: { per_page: 50, status: 'publish,draft,private' } }),
    client.get('/posts', { params: { per_page: 50, status: 'publish,draft,private' } })
  ]);

  if (pagesResponse.status >= 400) throw wordpressError(pagesResponse, 'Could not fetch WordPress pages.');
  if (postsResponse.status >= 400) throw wordpressError(postsResponse, 'Could not fetch WordPress posts.');

  return {
    pages: pagesResponse.data || [],
    posts: postsResponse.data || []
  };
}

function plainTextToHtml(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${paragraph.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function isPostDraftType(type) {
  return ['blog_article', 'comparison_page_draft', 'vs_comparison_article', 'alternatives_list', 'product_led_guide'].includes(type);
}

async function createWordPressDraftPost({ integration, draft, userId }) {
  const action = await PublishAction.create({
    projectId: draft.projectId,
    userId,
    contentDraftId: draft._id,
    integrationType: 'wordpress',
    actionType: isPostDraftType(draft.type) ? 'create_post' : 'export_only',
    status: 'pending'
  });

  if (draft.status !== 'approved') {
    action.status = 'failed';
    action.errorMessage = 'Only approved content drafts can be sent to WordPress.';
    await action.save();
    throw new Error(action.errorMessage);
  }

  if (!isPostDraftType(draft.type)) {
    action.status = 'success';
    action.errorMessage = '';
    await action.save();
    return action;
  }

  try {
    const response = await wpClient(integration).post('/posts', {
      title: draft.title || 'Untitled draft',
      content: plainTextToHtml(draft.body || ''),
      status: 'draft'
    });

    if (response.status < 200 || response.status >= 300) {
      throw wordpressError(response, 'Could not create WordPress draft.');
    }

    action.externalId = String(response.data.id || '');
    action.status = 'success';
    await action.save();
    return action;
  } catch (error) {
    action.status = 'failed';
    action.errorMessage = error.message;
    await action.save();
    throw error;
  }
}

module.exports = {
  createWordPressDraftPost,
  fetchWordPressPages,
  testWordPressConnection,
  upsertWordPressIntegration
};
