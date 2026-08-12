const crypto = require('crypto');
const express = require('express');
const asyncHandler = require('express-async-handler');
const env = require('../config/env');
const { requireAuth } = require('../middleware/auth');
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
  buildLinkedInAuthUrl,
  buildMetaAuthUrl,
  buildTwitterAuthUrl,
  exchangeLinkedInCode,
  exchangeMetaCode,
  exchangeTwitterCode,
  generateTwitterPkcePair
} = require('../services/socialOauthService');

const { connectSocialApiAccount } = require('../services/socialAccountService');

function clearSocialOauthCookies(res) {
  res.clearCookie('social_oauth_state', oauthCookieOptions());
  res.clearCookie('social_oauth_project', oauthCookieOptions());
  res.clearCookie('social_oauth_platform', oauthCookieOptions());
  res.clearCookie('social_oauth_code_verifier', oauthCookieOptions());
}

router.get('/social/:platform/connect', (req, res) => {
  const platform = req.params.platform;
  const state = crypto.randomBytes(24).toString('hex');
  const projectId = req.query.projectId || '';

  res.cookie('social_oauth_state', state, oauthCookieOptions());
  res.cookie('social_oauth_platform', platform, oauthCookieOptions());
  if (projectId) {
    res.cookie('social_oauth_project', String(projectId), oauthCookieOptions());
  }

  try {
    let authUrl = '';
    if (platform === 'linkedin') {
      authUrl = buildLinkedInAuthUrl({ state });
    } else if (platform === 'x' || platform === 'twitter') {
      const pkce = generateTwitterPkcePair();
      res.cookie('social_oauth_code_verifier', pkce.verifier, oauthCookieOptions());
      authUrl = buildTwitterAuthUrl({ state, codeChallenge: pkce.challenge });
    } else if (platform === 'meta' || platform === 'facebook' || platform === 'instagram') {
      authUrl = buildMetaAuthUrl({ state });
    } else {
      throw new Error(`Unsupported 1-click OAuth platform: ${platform}`);
    }

    res.redirect(authUrl);
  } catch (error) {
    clearSocialOauthCookies(res);
    const redirectPath = projectId ? `/projects/${projectId}/integrations/social` : '/integrations';
    res.redirect(`${redirectPath}?error=${encodeURIComponent(error.message)}`);
  }
});

router.get('/social/:platform/callback', asyncHandler(async (req, res) => {
  const platform = req.params.platform;
  const expectedState = req.cookies.social_oauth_state;
  const projectId = req.cookies.social_oauth_project;
  const requestedPlatform = req.cookies.social_oauth_platform;
  const codeVerifier = req.cookies.social_oauth_code_verifier;
  clearSocialOauthCookies(res);

  const redirectPath = projectId ? `/projects/${projectId}/integrations/social` : '/integrations';

  if (req.query.error) {
    return res.redirect(`${redirectPath}?error=${encodeURIComponent(`Connection canceled: ${req.query.error_description || req.query.error}`)}`);
  }

  if (!expectedState || req.query.state !== expectedState) {
    return res.redirect(`${redirectPath}?error=${encodeURIComponent('Social connection state verification failed. Please try again.')}`);
  }

  const callbackPlatform = platform === 'twitter' ? 'x' : platform;
  const expectedPlatform = requestedPlatform === 'twitter' ? 'x' : requestedPlatform;
  const isMetaFamily = ['meta', 'facebook', 'instagram'].includes(callbackPlatform) && ['meta', 'facebook', 'instagram'].includes(expectedPlatform);
  if (expectedPlatform && callbackPlatform !== expectedPlatform && !isMetaFamily) {
    return res.redirect(`${redirectPath}?error=${encodeURIComponent('Social connection platform verification failed. Please try again.')}`);
  }

  if (!req.query.code) {
    return res.redirect(`${redirectPath}?error=${encodeURIComponent('Authorization code was not returned by the platform.')}`);
  }

  try {
    let tokenPayload = null;
    if (platform === 'linkedin') {
      tokenPayload = await exchangeLinkedInCode(req.query.code);
    } else if (platform === 'x' || platform === 'twitter') {
      tokenPayload = await exchangeTwitterCode(req.query.code, { codeVerifier });
    } else if (platform === 'meta' || platform === 'facebook' || platform === 'instagram') {
      tokenPayload = await exchangeMetaCode(req.query.code);
    } else {
      throw new Error('Invalid platform callback');
    }

    if (projectId && /^[a-f0-9]{24}$/i.test(projectId)) {
      const accounts = Array.isArray(tokenPayload.accounts) && tokenPayload.accounts.length
        ? tokenPayload.accounts
        : [tokenPayload];

      await Promise.all(accounts.map((account) => connectSocialApiAccount({
        projectId,
        userId: req.user._id,
        platform: account.platform,
        accountName: account.accountName,
        externalAccountId: account.externalAccountId,
        accessToken: account.accessToken,
        refreshToken: account.refreshToken,
        expiresInSeconds: account.expiresInSeconds
      })));
    }

    const accountCount = Array.isArray(tokenPayload.accounts) && tokenPayload.accounts.length
      ? tokenPayload.accounts.length
      : 1;
    res.redirect(`${redirectPath}?success=${encodeURIComponent(`Connected ${accountCount} social account${accountCount === 1 ? '' : 's'} successfully.`)}`);
  } catch (error) {
    res.redirect(`${redirectPath}?error=${encodeURIComponent(error.message)}`);
  }
}));

module.exports = router;
