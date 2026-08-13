const asyncHandler = require('express-async-handler');
const { body, param } = require('express-validator');
const crypto = require('crypto');
const env = require('../../config/env');
const {
  fetchWordPressPages,
  testWordPressConnection,
  upsertWordPressIntegration
} = require('../../services/wordpressService');
const {
  testWebflowConnection,
  upsertWebflowIntegration
} = require('../../services/webflowService');
const {
  testShopifyConnection,
  upsertShopifyIntegration
} = require('../../services/shopifyService');

function registerIntegrationRoutes(router, context, services = {}) {
  const { ensureFeature, upgradeRedirect } = services;

  router.get('/:id/integrations/wordpress', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    let upgradeMessage = '';
    try {
      ensureFeature(req.user, 'wordpress', 'WordPress drafts are available on Pro and Agency plans.', 'pro');
    } catch (error) {
      upgradeMessage = error.message;
    }

    const integration = await context.WordPressIntegration.findOne({ projectId: req.project._id, userId: req.user._id });
    const recentActions = await context.PublishAction.find({ projectId: req.project._id, userId: req.user._id, integrationType: 'wordpress' }).sort({ createdAt: -1 }).limit(10);

    res.render('projects/integrations/wordpress', {
      title: `${req.project.name} WordPress`,
      integration,
      recentActions,
      errorMessage: req.query.error || upgradeMessage,
      successMessage: req.query.success || ''
    });
  }));

  router.post('/:id/integrations/wordpress/connect', [param('id').isMongoId(), ...context.wordpressValidation], context.loadProject, asyncHandler(async (req, res) => {
    try {
      ensureFeature(req.user, 'wordpress', 'WordPress drafts are available on Pro and Agency plans.', 'pro');
    } catch (error) {
      return res.redirect(upgradeRedirect(req.project._id, error.message));
    }

    await upsertWordPressIntegration({
      projectId: req.project._id,
      userId: req.user._id,
      siteUrl: req.body.siteUrl,
      username: req.body.username,
      appPassword: req.body.appPassword
    });

    res.redirect(`/projects/${req.project._id}/integrations/wordpress?success=${encodeURIComponent('WordPress credentials saved. Test the connection before publishing drafts.')}`);
  }));

  router.post('/:id/integrations/wordpress/test', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    try {
      ensureFeature(req.user, 'wordpress', 'WordPress drafts are available on Pro and Agency plans.', 'pro');
    } catch (error) {
      return res.redirect(`/projects/${req.project._id}/integrations/wordpress?error=${encodeURIComponent(error.message)}`);
    }

    const integration = await context.WordPressIntegration.findOne({ projectId: req.project._id, userId: req.user._id });
    if (!integration) {
      return res.redirect(`/projects/${req.project._id}/integrations/wordpress?error=${encodeURIComponent('Connect WordPress first.')}`);
    }

    try {
      await testWordPressConnection(integration);
      res.redirect(`/projects/${req.project._id}/integrations/wordpress?success=${encodeURIComponent('WordPress connection test passed.')}`);
    } catch (error) {
      res.redirect(`/projects/${req.project._id}/integrations/wordpress?error=${encodeURIComponent(error.message)}`);
    }
  }));

  router.get('/:id/integrations/wordpress/pages', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    try {
      ensureFeature(req.user, 'wordpress', 'WordPress drafts are available on Pro and Agency plans.', 'pro');
    } catch (error) {
      return res.redirect(`/projects/${req.project._id}/integrations/wordpress?error=${encodeURIComponent(error.message)}`);
    }

    const integration = await context.WordPressIntegration.findOne({ projectId: req.project._id, userId: req.user._id });
    if (!integration) {
      return res.redirect(`/projects/${req.project._id}/integrations/wordpress?error=${encodeURIComponent('Connect WordPress first.')}`);
    }

    try {
      const wordpressContent = await fetchWordPressPages(integration);
      res.render('projects/integrations/wordpress-pages', {
        title: `${req.project.name} WordPress content`,
        integration,
        wordpressContent,
        errorMessage: ''
      });
    } catch (error) {
      res.render('projects/integrations/wordpress-pages', {
        title: `${req.project.name} WordPress content`,
        integration,
        wordpressContent: { pages: [], posts: [] },
        errorMessage: error.message
      });
    }
  }));

  router.get('/:id/integrations/webflow', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    let upgradeMessage = '';
    try {
      ensureFeature(req.user, 'webflow', 'Webflow CMS drafts are available on Pro and Agency plans.', 'pro');
    } catch (error) {
      upgradeMessage = error.message;
    }

    const integration = await context.WebflowIntegration.findOne({ projectId: req.project._id, userId: req.user._id });
    const recentActions = await context.PublishAction.find({ projectId: req.project._id, userId: req.user._id, integrationType: 'webflow' }).sort({ createdAt: -1 }).limit(10);

    res.render('projects/integrations/webflow', {
      title: `${req.project.name} Webflow`,
      integration,
      recentActions,
      errorMessage: req.query.error || upgradeMessage,
      successMessage: req.query.success || ''
    });
  }));

  router.post('/:id/integrations/webflow/connect', [param('id').isMongoId(), ...context.webflowValidation], context.loadProject, asyncHandler(async (req, res) => {
    try {
      ensureFeature(req.user, 'webflow', 'Webflow CMS drafts are available on Pro and Agency plans.', 'pro');
    } catch (error) {
      return res.redirect(upgradeRedirect(req.project._id, error.message));
    }

    await upsertWebflowIntegration({
      projectId: req.project._id,
      userId: req.user._id,
      siteId: req.body.siteId || '',
      collectionId: req.body.collectionId,
      apiToken: req.body.apiToken,
      titleField: req.body.titleField || 'name',
      slugField: req.body.slugField || 'slug',
      bodyField: req.body.bodyField || 'post-body'
    });

    res.redirect(`/projects/${req.project._id}/integrations/webflow?success=${encodeURIComponent('Webflow credentials saved. Test the connection before publishing drafts.')}`);
  }));

  router.post('/:id/integrations/webflow/test', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    try {
      ensureFeature(req.user, 'webflow', 'Webflow CMS drafts are available on Pro and Agency plans.', 'pro');
    } catch (error) {
      return res.redirect(`/projects/${req.project._id}/integrations/webflow?error=${encodeURIComponent(error.message)}`);
    }

    const integration = await context.WebflowIntegration.findOne({ projectId: req.project._id, userId: req.user._id });
    if (!integration) {
      return res.redirect(`/projects/${req.project._id}/integrations/webflow?error=${encodeURIComponent('Connect Webflow first.')}`);
    }

    try {
      await testWebflowConnection(integration);
      res.redirect(`/projects/${req.project._id}/integrations/webflow?success=${encodeURIComponent('Webflow connection test passed.')}`);
    } catch (error) {
      res.redirect(`/projects/${req.project._id}/integrations/webflow?error=${encodeURIComponent(error.message)}`);
    }
  }));

  router.get('/:id/integrations/shopify', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    let upgradeMessage = '';
    try {
      ensureFeature(req.user, 'shopify', 'Shopify blog drafts are available on Pro and Agency plans.', 'pro');
    } catch (error) {
      upgradeMessage = error.message;
    }

    const integration = await context.ShopifyIntegration.findOne({ projectId: req.project._id, userId: req.user._id });
    const recentActions = await context.PublishAction.find({ projectId: req.project._id, userId: req.user._id, integrationType: 'shopify' }).sort({ createdAt: -1 }).limit(10);

    res.render('projects/integrations/shopify', {
      title: `${req.project.name} Shopify`,
      integration,
      recentActions,
      errorMessage: req.query.error || upgradeMessage,
      successMessage: req.query.success || ''
    });
  }));

  router.post('/:id/integrations/shopify/connect', [param('id').isMongoId(), ...context.shopifyValidation], context.loadProject, asyncHandler(async (req, res) => {
    try {
      ensureFeature(req.user, 'shopify', 'Shopify blog drafts are available on Pro and Agency plans.', 'pro');
    } catch (error) {
      return res.redirect(upgradeRedirect(req.project._id, error.message));
    }

    await upsertShopifyIntegration({
      projectId: req.project._id,
      userId: req.user._id,
      shopDomain: req.body.shopDomain,
      blogId: req.body.blogId,
      accessToken: req.body.accessToken,
      apiVersion: req.body.apiVersion || '2025-01'
    });

    res.redirect(`/projects/${req.project._id}/integrations/shopify?success=${encodeURIComponent('Shopify credentials saved. Test the connection before publishing drafts.')}`);
  }));

  router.post('/:id/integrations/shopify/test', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    try {
      ensureFeature(req.user, 'shopify', 'Shopify blog drafts are available on Pro and Agency plans.', 'pro');
    } catch (error) {
      return res.redirect(`/projects/${req.project._id}/integrations/shopify?error=${encodeURIComponent(error.message)}`);
    }

    const integration = await context.ShopifyIntegration.findOne({ projectId: req.project._id, userId: req.user._id });
    if (!integration) {
      return res.redirect(`/projects/${req.project._id}/integrations/shopify?error=${encodeURIComponent('Connect Shopify first.')}`);
    }

    try {
      await testShopifyConnection(integration);
      res.redirect(`/projects/${req.project._id}/integrations/shopify?success=${encodeURIComponent('Shopify connection test passed.')}`);
    } catch (error) {
      res.redirect(`/projects/${req.project._id}/integrations/shopify?error=${encodeURIComponent(error.message)}`);
    }
  }));

  router.get('/:id/integrations/webhook', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    if (!req.project.webhookSigningSecret) {
      req.project.webhookSigningSecret = crypto.randomBytes(32).toString('hex');
      await req.project.save();
    }

    res.render('projects/integrations/webhook', {
      title: `${req.project.name} webhook`,
      errorMessage: req.query.error || '',
      successMessage: req.query.success || ''
    });
  }));

  router.post(
    '/:id/integrations/webhook',
    [
      param('id').isMongoId(),
      body('webhookUrl')
        .optional({ checkFalsy: true })
        .trim()
        .isLength({ max: 500 })
        .withMessage('Webhook URL is too long.')
        .isURL({ require_protocol: true, protocols: ['http', 'https'] })
        .withMessage('Webhook URL must be a full URL, including https://.'),
      context.handleValidation
    ],
    context.loadProject,
    asyncHandler(async (req, res) => {
      req.project.webhookUrl = req.body.webhookUrl || '';
      if (!req.project.webhookSigningSecret) {
        req.project.webhookSigningSecret = crypto.randomBytes(32).toString('hex');
      }
      await req.project.save();
      res.redirect(`/projects/${req.project._id}/integrations/webhook?success=${encodeURIComponent('Outgoing webhook settings saved.')}`);
    })
  );

  // Social Account Integrations
  const {
    DIRECT_API_PLATFORMS,
    connectSocialApiAccount,
    connectSocialWebhook,
    disconnectSocialAccount,
    listProjectSocialAccounts
  } = require('../../services/socialAccountService');

  router.get('/:id/integrations/social', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const accounts = await listProjectSocialAccounts(req.project._id);
    const recentActions = await context.PublishAction.find({
      projectId: req.project._id,
      integrationType: { $in: ['bluesky', 'linkedin', 'x', 'facebook', 'instagram', 'threads', 'youtube', 'tiktok', 'ayrshare', 'buffer', 'webhook'] }
    }).sort({ createdAt: -1 }).limit(10);

    res.render('projects/integrations/social', {
      title: `${req.project.name} Connected Social Accounts`,
      accounts,
      recentActions,
      socialReadiness: env.socialProviderReadiness(),
      errorMessage: req.query.error || '',
      successMessage: req.query.success || ''
    });
  }));

  router.post(
    '/:id/integrations/social/webhook/connect',
    [
      param('id').isMongoId(),
      body('accountName').trim().notEmpty().withMessage('Account name is required.'),
      body('webhookUrl').trim().isURL({ require_protocol: true, protocols: ['http', 'https'] }).withMessage('Webhook URL must be a valid http or https URL.'),
      body('platform').optional().isIn(['webhook']),
      context.handleValidation
    ],
    context.loadProject,
    asyncHandler(async (req, res) => {
      try {
        await connectSocialWebhook({
          projectId: req.project._id,
          userId: req.user._id,
          platform: 'webhook',
          accountName: req.body.accountName,
          webhookUrl: req.body.webhookUrl,
          webhookSecret: req.body.webhookSecret || ''
        });
        res.redirect(`/projects/${req.project._id}/integrations/social?success=${encodeURIComponent('Social webhook connected successfully.')}`);
      } catch (error) {
        res.redirect(`/projects/${req.project._id}/integrations/social?error=${encodeURIComponent(error.message)}`);
      }
    })
  );

  router.post(
    '/:id/integrations/social/api/connect',
    [
      param('id').isMongoId(),
      body('platform').isIn(DIRECT_API_PLATFORMS).withMessage('Invalid social platform.'),
      body('accountName').trim().notEmpty().withMessage('Account name is required.'),
      body('accessToken').trim().notEmpty().withMessage('Access token is required.'),
      context.handleValidation
    ],
    context.loadProject,
    asyncHandler(async (req, res) => {
      try {
        await connectSocialApiAccount({
          projectId: req.project._id,
          userId: req.user._id,
          platform: req.body.platform,
          accountName: req.body.accountName,
          externalAccountId: req.body.externalAccountId || '',
          accessToken: req.body.accessToken,
          refreshToken: req.body.refreshToken || ''
        });
        res.redirect(`/projects/${req.project._id}/integrations/social?success=${encodeURIComponent(`Connected ${req.body.platform} account successfully.`)}`);
      } catch (error) {
        res.redirect(`/projects/${req.project._id}/integrations/social?error=${encodeURIComponent(error.message)}`);
      }
    })
  );

  router.post(
    '/:id/integrations/social/:accountId/disconnect',
    [param('id').isMongoId(), param('accountId').isMongoId(), context.handleValidation],
    context.loadProject,
    asyncHandler(async (req, res) => {
      try {
        await disconnectSocialAccount({
          projectId: req.project._id,
          accountId: req.params.accountId
        });
        res.redirect(`/projects/${req.project._id}/integrations/social?success=${encodeURIComponent('Social account disconnected.')}`);
      } catch (error) {
        res.redirect(`/projects/${req.project._id}/integrations/social?error=${encodeURIComponent(error.message)}`);
      }
    })
  );
}

module.exports = {
  registerIntegrationRoutes
};
