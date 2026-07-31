const ContentDraft = require('../models/ContentDraft');
const PublishAction = require('../models/PublishAction');
const Project = require('../models/Project');
const WordPressIntegration = require('../models/WordPressIntegration');
const WebflowIntegration = require('../models/WebflowIntegration');
const ShopifyIntegration = require('../models/ShopifyIntegration');
const { createWordPressDraftPost } = require('./wordpressService');
const { createWebflowDraftItem } = require('./webflowService');
const { createShopifyDraftArticle } = require('./shopifyService');

async function retryPublishAction({ actionId }) {
  const action = await PublishAction.findById(actionId);
  if (!action || action.status !== 'failed') {
    const error = new Error('Failed publish action not found.');
    error.statusCode = 404;
    throw error;
  }

  const [project, draft] = await Promise.all([
    Project.findById(action.projectId),
    ContentDraft.findById(action.contentDraftId)
  ]);
  if (!project || !draft) {
    const error = new Error('Publish retry source data is missing.');
    error.statusCode = 422;
    throw error;
  }

  const lookup = { projectId: action.projectId, userId: action.userId };
  if (action.integrationType === 'wordpress') {
    const integration = await WordPressIntegration.findOne(lookup);
    if (!integration) throw new Error('WordPress integration is no longer connected.');
    return createWordPressDraftPost({ integration, draft, userId: action.userId });
  }
  if (action.integrationType === 'webflow') {
    const integration = await WebflowIntegration.findOne(lookup);
    if (!integration) throw new Error('Webflow integration is no longer connected.');
    return createWebflowDraftItem({ integration, draft, userId: action.userId });
  }
  if (action.integrationType === 'shopify') {
    const integration = await ShopifyIntegration.findOne(lookup);
    if (!integration) throw new Error('Shopify integration is no longer connected.');
    return createShopifyDraftArticle({ integration, draft, userId: action.userId });
  }

  throw new Error(`Unsupported integration type: ${action.integrationType}`);
}

module.exports = {
  retryPublishAction
};
