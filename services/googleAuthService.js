const axios = require('axios');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const env = require('../config/env');
const User = require('../models/User');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const AUTH_SCOPES = ['openid', 'email', 'profile'];

function googleLoginRedirectUriFromEnv(source = env) {
  if (source.googleRedirectUri && source.googleRedirectUri.includes('/auth/google/callback')) {
    return source.googleRedirectUri;
  }
  if (source.googleRedirectUri && source.googleRedirectUri.includes('/integrations/google/callback')) {
    return source.googleRedirectUri.replace('/integrations/google/callback', '/auth/google/callback');
  }
  return `${source.appUrl}/auth/google/callback`;
}

function googleLoginRedirectUri() {
  return googleLoginRedirectUriFromEnv(env);
}

function assertGoogleConfigured() {
  if (!env.googleClientId || !env.googleClientSecret || !env.googleRedirectUri) {
    const error = new Error('Google OAuth is not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.');
    error.statusCode = 503;
    throw error;
  }
}

function buildGoogleLoginUrl({ state }) {
  assertGoogleConfigured();
  const params = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: googleLoginRedirectUri(),
    response_type: 'code',
    scope: AUTH_SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForLoginTokens(code) {
  assertGoogleConfigured();
  const response = await axios.post(GOOGLE_TOKEN_URL, new URLSearchParams({
    code,
    client_id: env.googleClientId,
    client_secret: env.googleClientSecret,
    redirect_uri: googleLoginRedirectUri(),
    grant_type: 'authorization_code'
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  return response.data;
}

async function fetchGoogleProfile(accessToken) {
  const response = await axios.get(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  return response.data;
}

async function findOrCreateGoogleUser(profile) {
  const email = String(profile.email || '').toLowerCase().trim();
  const subject = String(profile.sub || '').trim();

  if (!email || !subject) {
    const error = new Error('Google did not return the required account identity.');
    error.statusCode = 502;
    throw error;
  }

  let user = await User.findOne({
    $or: [
      { googleSubject: subject },
      { email }
    ]
  });

  if (!user) {
    const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12);
    user = await User.create({
      name: String(profile.name || email.split('@')[0] || 'Google User').trim(),
      email,
      googleSubject: subject,
      passwordHash
    });
    return user;
  }

  let changed = false;
  if (!user.googleSubject) {
    user.googleSubject = subject;
    changed = true;
  }
  if (!user.name && profile.name) {
    user.name = String(profile.name).trim();
    changed = true;
  }
  if (changed) {
    await user.save();
  }

  return user;
}

module.exports = {
  AUTH_SCOPES,
  assertGoogleConfigured,
  buildGoogleLoginUrl,
  exchangeCodeForLoginTokens,
  fetchGoogleProfile,
  findOrCreateGoogleUser,
  googleLoginRedirectUriFromEnv,
  googleLoginRedirectUri
};
