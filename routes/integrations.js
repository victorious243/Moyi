const crypto = require('crypto');
const express = require('express');
const asyncHandler = require('express-async-handler');
const env = require('../config/env');
const Project = require('../models/Project');
const { requireAuth } = require('../middleware/auth');
const { canChangeProjectRole, projectAccessRole } = require('../services/projectAccessService');
const {
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  getIntegration,
  storeGoogleIntegration
} = require('../services/searchConsoleService');

const router = express.Router();

router.use(requireAuth);

function oauthCookieOptions() {
  const options = {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProduction,
    path: '/',
    maxAge: 10 * 60 * 1000
  };

  if (env.cookieDomain) {
    options.domain = env.cookieDomain;
  }

  return options;
}

function clearOauthCookies(res) {
  res.clearCookie('gsc_oauth_state', oauthCookieOptions());
  res.clearCookie('gsc_oauth_project', oauthCookieOptions());
}

router.get('/', asyncHandler(async (req, res) => {
  const integration = await getIntegration(req.user._id);
  res.render('integrations/index', {
    title: 'Integrations',
    integration,
    errorMessage: req.query.error || '',
    successMessage: req.query.connected ? 'Google Search Console is connected.' : ''
  });
}));

router.get('/google/connect', (req, res) => {
  const state = crypto.randomBytes(24).toString('hex');
  res.cookie('gsc_oauth_state', state, oauthCookieOptions());

  if (req.query.projectId) {
    res.cookie('gsc_oauth_project', String(req.query.projectId), oauthCookieOptions());
  }

  try {
    res.redirect(buildGoogleAuthUrl({ state }));
  } catch (error) {
    clearOauthCookies(res);
    res.redirect(`/integrations?error=${encodeURIComponent(error.message)}`);
  }
});

router.get('/google/callback', asyncHandler(async (req, res) => {
  const expectedState = req.cookies.gsc_oauth_state;
  const projectId = req.cookies.gsc_oauth_project;
  clearOauthCookies(res);

  if (req.query.error) {
    return res.redirect(`/integrations?error=${encodeURIComponent(`Google connection failed: ${req.query.error}`)}`);
  }

  if (!expectedState || req.query.state !== expectedState) {
    console.warn('Google integration state verification failed.', {
      hasExpectedState: Boolean(expectedState),
      hasReturnedState: Boolean(req.query.state),
      cookieDomain: env.cookieDomain || '(host-only)',
      secureCookies: env.isProduction
    });
    return res.redirect(`/integrations?error=${encodeURIComponent('Google connection could not be verified. Please try again.')}`);
  }

  if (!req.query.code) {
    return res.redirect(`/integrations?error=${encodeURIComponent('Google did not return an authorization code.')}`);
  }

  try {
    const tokenPayload = await exchangeCodeForTokens(req.query.code);
    await storeGoogleIntegration(req.user._id, tokenPayload);
  } catch (error) {
    return res.redirect(`/integrations?error=${encodeURIComponent(error.message)}`);
  }

  if (projectId && /^[a-f0-9]{24}$/i.test(projectId)) {
    return res.redirect(`/projects/${projectId}/search-console/connect`);
  }

  res.redirect('/integrations?connected=1');
}));

// ------------------------------------------
// 1-CLICK SOCIAL OAUTH CONNECT ROUTES (NON-TECHNICAL)
// ------------------------------------------
const {
  connectProvider,
  getAuthorizationRequest
} = require('../services/socialProviderService');

const { connectSocialApiAccount } = require('../services/socialAccountService');

function clearSocialOauthCookies(res) {
  res.clearCookie('social_oauth_state', oauthCookieOptions());
  res.clearCookie('social_oauth_project', oauthCookieOptions());
  res.clearCookie('social_oauth_platform', oauthCookieOptions());
  res.clearCookie('social_oauth_code_verifier', oauthCookieOptions());
  res.clearCookie('social_oauth_handle', oauthCookieOptions());
}

function normalizeSocialPlatform(value) {
  return value === 'twitter' ? 'x' : value;
}

async function requireManageableOAuthProject(projectId, userId) {
  if (!projectId || !/^[a-f0-9]{24}$/i.test(String(projectId))) {
    const error = new Error('Open Social Accounts from a project before connecting an account.');
    error.statusCode = 400;
    throw error;
  }
  const project = await Project.findById(projectId);
  const role = project ? await projectAccessRole({ project, userId }) : null;
  if (!project || !canChangeProjectRole(role)) {
    const error = new Error('You do not have permission to connect accounts to this project.');
    error.statusCode = 403;
    throw error;
  }
  return project;
}

router.get('/social/:platform/connect', asyncHandler(async (req, res) => {
  const platform = normalizeSocialPlatform(req.params.platform);
  const state = crypto.randomBytes(24).toString('hex');
  const projectId = req.query.projectId || '';
  const redirectPath = projectId ? `/projects/${projectId}/integrations/social` : '/integrations';

  try {
    await requireManageableOAuthProject(projectId, req.user._id);
    res.cookie('social_oauth_state', state, oauthCookieOptions());
    res.cookie('social_oauth_platform', platform, oauthCookieOptions());
    res.cookie('social_oauth_project', String(projectId), oauthCookieOptions());

    let authUrl = '';
    const providerPlatform = platform === 'meta' ? 'facebook' : platform;
    if (['bluesky', 'linkedin', 'x', 'facebook', 'instagram', 'threads', 'tiktok', 'youtube'].includes(providerPlatform)) {
      const handle = String(req.query.handle || '').trim();
      const request = await getAuthorizationRequest(providerPlatform, { state, handle });
      if (request.codeVerifier) {
        res.cookie('social_oauth_code_verifier', request.codeVerifier, oauthCookieOptions());
      }
      if (handle) res.cookie('social_oauth_handle', handle, oauthCookieOptions());
      authUrl = request.url;
    } else {
      throw new Error(`Unsupported 1-click OAuth platform: ${platform}`);
    }

    res.redirect(authUrl);
  } catch (error) {
    clearSocialOauthCookies(res);
    let friendlyMessage = error.message;
    if (/not configured|missing|env|client_id|redirect_uri/i.test(error.message)) {
      const displayName = platform === 'meta' ? 'Facebook & Instagram' : (platform === 'x' ? 'X' : platform.charAt(0).toUpperCase() + platform.slice(1));
      friendlyMessage = `1-click connection for ${displayName} will be available soon.`;
    }
    res.redirect(`${redirectPath}?error=${encodeURIComponent(friendlyMessage)}`);
  }
}));

router.get('/social/:platform/callback', asyncHandler(async (req, res) => {
  const platform = req.params.platform;
  const expectedState = req.cookies.social_oauth_state;
  const projectId = req.cookies.social_oauth_project;
  const requestedPlatform = req.cookies.social_oauth_platform;
  const codeVerifier = req.cookies.social_oauth_code_verifier;
  const blueskyHandle = req.cookies.social_oauth_handle;
  clearSocialOauthCookies(res);

  const redirectPath = projectId ? `/projects/${projectId}/integrations/social` : '/integrations';

  if (req.query.error) {
    return res.redirect(`${redirectPath}?error=${encodeURIComponent(`Connection canceled: ${req.query.error_description || req.query.error}`)}`);
  }

  if (!expectedState || (platform !== 'bluesky' && req.query.state !== expectedState)) {
    return res.redirect(`${redirectPath}?error=${encodeURIComponent('Social connection state verification failed. Please try again.')}`);
  }

  const callbackPlatform = normalizeSocialPlatform(platform);
  const expectedPlatform = normalizeSocialPlatform(requestedPlatform);
  const isMetaFamily = ['meta', 'facebook', 'instagram'].includes(callbackPlatform) && ['meta', 'facebook', 'instagram'].includes(expectedPlatform);
  if (expectedPlatform && callbackPlatform !== expectedPlatform && !isMetaFamily) {
    return res.redirect(`${redirectPath}?error=${encodeURIComponent('Social connection platform verification failed. Please try again.')}`);
  }

  if (!req.query.code) {
    return res.redirect(`${redirectPath}?error=${encodeURIComponent('Authorization code was not returned by the platform.')}`);
  }

  try {
    await requireManageableOAuthProject(projectId, req.user._id);
    let accounts = [];
    const providerPlatform = callbackPlatform === 'meta' ? 'facebook' : callbackPlatform;
    if (['bluesky', 'linkedin', 'x', 'facebook', 'instagram', 'threads', 'tiktok', 'youtube'].includes(providerPlatform)) {
      const callbackUrl = new URL(req.originalUrl, env.appUrl);
      accounts = await connectProvider(providerPlatform, String(req.query.code), {
        callbackParams: callbackUrl.searchParams,
        codeVerifier,
        handle: blueskyHandle
      });
      if (providerPlatform === 'bluesky') {
        const returnedState = accounts[0] && accounts[0].metadata
          ? String(accounts[0].metadata.appState || '')
          : '';
        if (!returnedState || returnedState !== expectedState) {
          throw new Error('Bluesky connection state verification failed. Please try again.');
        }
      }
    } else {
      throw new Error('Invalid platform callback');
    }

    await Promise.all(accounts.map((account) => {
      const metadata = { ...(account.metadata || {}) };
      delete metadata.appState;
      return connectSocialApiAccount({
        projectId,
        userId: req.user._id,
        platform: account.platform,
        accountName: account.accountName,
        externalAccountId: account.externalAccountId,
        accessToken: account.accessToken,
        refreshToken: account.refreshToken,
        expiresInSeconds: account.expiresInSeconds,
        expiresAt: account.expiresAt,
        scopes: account.scopes,
        metadata
      });
    }));

    const accountCount = accounts.length;
    res.redirect(`${redirectPath}?success=${encodeURIComponent(`Connected ${accountCount} social account${accountCount === 1 ? '' : 's'} successfully.`)}`);
  } catch (error) {
    res.redirect(`${redirectPath}?error=${encodeURIComponent(error.message)}`);
  }
}));

// ------------------------------------------
// MODEL CONTEXT PROTOCOL (MCP) SERVER API ENDPOINTS
// ------------------------------------------
const { listMcpTools, handleMcpToolCall } = require('../services/mcpServerService');

router.get('/api/mcp/tools', (req, res) => {
  res.json({
    success: true,
    protocol: 'mcp-v1',
    tools: listMcpTools()
  });
});

router.post('/api/mcp', asyncHandler(async (req, res) => {
  const { tool, params } = req.body;
  if (!tool) {
    return res.status(400).json({ error: 'Tool name is required.' });
  }

  const result = await handleMcpToolCall({
    toolName: tool,
    params: params || {},
    userId: req.user._id
  });

  res.json({
    jsonrpc: '2.0',
    result
  });
}));

module.exports = router;
