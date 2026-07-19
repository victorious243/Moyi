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
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.nodeEnv === 'production',
    maxAge: 10 * 60 * 1000
  };
}

function clearOauthCookies(res) {
  res.clearCookie('gsc_oauth_state');
  res.clearCookie('gsc_oauth_project');
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

module.exports = router;
