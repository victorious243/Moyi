const axios = require('axios');
const slugify = require('slugify');
const WebflowIntegration = require('../models/WebflowIntegration');
const PublishAction = require('../models/PublishAction');
const { decrypt, encrypt } = require('../utils/crypto');

const WEBFLOW_API_BASE = 'https://api.webflow.com/v2';

function webflowClient(integration) {
  return axios.create({
    baseURL: WEBFLOW_API_BASE,
    timeout: 15000,
    headers: {
      Authorization: `Bearer ${decrypt(integration.apiToken)}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    validateStatus: () => true
  });
}

function webflowError(response, fallback = 'Webflow request failed.') {
  const data = response && response.data;
  const message = data && (data.message || data.msg || data.code || data.detail)
    ? String(data.message || data.msg || data.code || data.detail)
    : fallback;
  const error = new Error(message);
  error.statusCode = response ? response.status : 502;
  return error;
}

function draftSlug(draft) {
  return slugify(draft.title || draft.type || 'moyi-draft', { lower: true, strict: true }).slice(0, 80) || 'moyi-draft';
}

function draftHtml(draft) {
  return String(draft.body || '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${paragraph.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

async function upsertWebflowIntegration({ projectId, userId, siteId, collectionId, apiToken, titleField, slugField, bodyField }) {
  return WebflowIntegration.findOneAndUpdate(
    { projectId, userId },
    {
      projectId,
      userId,
      siteId: siteId || '',
      collectionId,
      apiToken: encrypt(apiToken),
      titleField: titleField || 'name',
      slugField: slugField || 'slug',
      bodyField: bodyField || 'post-body',
      status: 'disconnected'
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
}

async function testWebflowConnection(integration) {
  const response = await webflowClient(integration).get(`/collections/${integration.collectionId}`);
  integration.lastTestedAt = new Date();

  if (response.status >= 200 && response.status < 300) {
    integration.status = 'connected';
    await integration.save();
    return response.data;
  }

  integration.status = 'error';
  await integration.save();
  throw webflowError(response, 'Could not connect to Webflow.');
}

async function createWebflowDraftItem({ integration, draft, userId }) {
  const action = await PublishAction.create({
    projectId: draft.projectId,
    userId,
    contentDraftId: draft._id,
    integrationType: 'webflow',
    actionType: 'create_post',
    status: 'pending'
  });

  if (draft.status !== 'approved') {
    action.status = 'failed';
    action.errorMessage = 'Only approved content drafts can be sent to Webflow.';
    await action.save();
    throw new Error(action.errorMessage);
  }

  try {
    const fieldData = {
      [integration.titleField || 'name']: draft.title || 'Untitled draft',
      [integration.slugField || 'slug']: draftSlug(draft),
      [integration.bodyField || 'post-body']: draftHtml(draft)
    };
    const response = await webflowClient(integration).post(`/collections/${integration.collectionId}/items`, {
      isArchived: false,
      isDraft: true,
      fieldData
    });

    if (response.status < 200 || response.status >= 300) {
      throw webflowError(response, 'Could not create Webflow CMS item.');
    }

    action.externalId = String(response.data.id || response.data._id || '');
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
  createWebflowDraftItem,
  testWebflowConnection,
  upsertWebflowIntegration
};
