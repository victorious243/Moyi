const axios = require('axios');
const ShopifyIntegration = require('../models/ShopifyIntegration');
const PublishAction = require('../models/PublishAction');
const { decrypt, encrypt } = require('../utils/crypto');

function normalizeShopDomain(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!raw || !/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(raw)) {
    const error = new Error('Shopify shop domain must be a valid domain, such as example.myshopify.com.');
    error.statusCode = 422;
    throw error;
  }
  return raw;
}

function shopifyBaseUrl(integration) {
  return `https://${normalizeShopDomain(integration.shopDomain)}/admin/api/${integration.apiVersion || '2025-01'}`;
}

function shopifyClient(integration) {
  return axios.create({
    baseURL: shopifyBaseUrl(integration),
    timeout: 15000,
    headers: {
      'X-Shopify-Access-Token': decrypt(integration.accessToken),
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    validateStatus: () => true
  });
}

function shopifyError(response, fallback = 'Shopify request failed.') {
  const data = response && response.data;
  const message = data && (data.errors || data.error)
    ? (typeof (data.errors || data.error) === 'string' ? (data.errors || data.error) : JSON.stringify(data.errors || data.error))
    : fallback;
  const error = new Error(message);
  error.statusCode = response ? response.status : 502;
  return error;
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

async function upsertShopifyIntegration({ projectId, userId, shopDomain, blogId, accessToken, apiVersion }) {
  return ShopifyIntegration.findOneAndUpdate(
    { projectId, userId },
    {
      projectId,
      userId,
      shopDomain: normalizeShopDomain(shopDomain),
      blogId,
      accessToken: encrypt(accessToken),
      apiVersion: apiVersion || '2025-01',
      status: 'disconnected'
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
}

async function testShopifyConnection(integration) {
  const response = await shopifyClient(integration).get(`/blogs/${integration.blogId}.json`);
  integration.lastTestedAt = new Date();

  if (response.status >= 200 && response.status < 300) {
    integration.status = 'connected';
    await integration.save();
    return response.data;
  }

  integration.status = 'error';
  await integration.save();
  throw shopifyError(response, 'Could not connect to Shopify.');
}

async function createShopifyDraftArticle({ integration, draft, userId }) {
  const action = await PublishAction.create({
    projectId: draft.projectId,
    userId,
    contentDraftId: draft._id,
    integrationType: 'shopify',
    actionType: 'create_post',
    status: 'pending'
  });

  if (draft.status !== 'approved') {
    action.status = 'failed';
    action.errorMessage = 'Only approved content drafts can be sent to Shopify.';
    await action.save();
    throw new Error(action.errorMessage);
  }

  if (!isPostDraftType(draft.type)) {
    action.status = 'failed';
    action.errorMessage = 'Only approved article-style assets can be sent to Shopify.';
    await action.save();
    throw new Error(action.errorMessage);
  }

  try {
    const response = await shopifyClient(integration).post(`/blogs/${integration.blogId}/articles.json`, {
      article: {
        title: draft.title || 'Untitled draft',
        body_html: plainTextToHtml(draft.body || ''),
        published: false
      }
    });

    if (response.status < 200 || response.status >= 300) {
      throw shopifyError(response, 'Could not create Shopify draft article.');
    }

    action.externalId = String(response.data && response.data.article ? response.data.article.id : '');
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
  createShopifyDraftArticle,
  normalizeShopDomain,
  testShopifyConnection,
  upsertShopifyIntegration
};
