const axios = require('axios');
const crypto = require('crypto');
const env = require('../config/env');

function getRedirectUri(platform) {
  const configured = platform === 'linkedin'
    ? env.linkedinRedirectUri
    : platform === 'x'
      ? env.twitterRedirectUri
      : env.metaRedirectUri;

  if (configured) return configured;
  const baseUrl = env.appUrl || 'http://localhost:3000';
  return `${baseUrl.replace(/\/$/, '')}/integrations/social/${platform}/callback`;
}

function base64Url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generateTwitterPkcePair() {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// ------------------------------------------
// LINKEDIN OAUTH
// ------------------------------------------
function buildLinkedInAuthUrl({ state }) {
  const redirectUri = getRedirectUri('linkedin');
  if (!env.linkedinClientId) {
    // Sandbox / Instant Connect mode when developer keys aren't set in env
    return `${redirectUri}?code=sandbox_linkedin_code&state=${state}`;
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.linkedinClientId,
    redirect_uri: redirectUri,
    state,
    scope: 'openid profile email w_member_social'
  });

  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
}

async function exchangeLinkedInCode(code) {
  if (code.startsWith('sandbox_')) {
    return {
      platform: 'linkedin',
      accountName: 'Connected LinkedIn Page',
      externalAccountId: 'urn:li:organization:demo_sandbox',
      accessToken: 'sandbox_linkedin_access_token',
      refreshToken: '',
      expiresInSeconds: 5184000
    };
  }

  const redirectUri = getRedirectUri('linkedin');
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: env.linkedinClientId,
    client_secret: env.linkedinClientSecret
  });

  const response = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  const accessToken = response.data.access_token;
  let accountName = 'LinkedIn Member';
  let externalAccountId = '';

  try {
    const profileRes = await axios.get('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (profileRes.data) {
      accountName = profileRes.data.name || profileRes.data.given_name || 'LinkedIn Account';
      externalAccountId = profileRes.data.sub || '';
    }
  } catch (error) {
    accountName = 'LinkedIn Account';
  }

  return {
    platform: 'linkedin',
    accountName,
    externalAccountId,
    accessToken,
    refreshToken: response.data.refresh_token || '',
    expiresInSeconds: response.data.expires_in || 5184000
  };
}

// ------------------------------------------
// X / TWITTER OAUTH 2.0
// ------------------------------------------
function buildTwitterAuthUrl({ state, codeChallenge }) {
  const redirectUri = getRedirectUri('x');
  if (!env.twitterClientId) {
    // Sandbox / Instant Connect mode when developer keys aren't set in env
    return `${redirectUri}?code=sandbox_twitter_code&state=${state}`;
  }

  if (!codeChallenge) {
    throw new Error('X OAuth requires a PKCE code challenge.');
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.twitterClientId,
    redirect_uri: redirectUri,
    state,
    scope: 'tweet.read tweet.write users.read offline.access',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });

  return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
}

async function exchangeTwitterCode(code, { codeVerifier } = {}) {
  if (code.startsWith('sandbox_')) {
    return {
      platform: 'x',
      accountName: '@ConnectedXAccount',
      externalAccountId: 'x_sandbox_user_id',
      accessToken: 'sandbox_twitter_access_token',
      refreshToken: '',
      expiresInSeconds: 7200
    };
  }

  const redirectUri = getRedirectUri('x');
  if (!codeVerifier) {
    const error = new Error('X connection could not be completed because the OAuth verifier expired. Please try connecting again.');
    error.statusCode = 400;
    throw error;
  }

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: env.twitterClientId,
    code_verifier: codeVerifier
  });

  const authHeader = env.twitterClientSecret
    ? `Basic ${Buffer.from(`${env.twitterClientId}:${env.twitterClientSecret}`).toString('base64')}`
    : null;

  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (authHeader) headers.Authorization = authHeader;

  const response = await axios.post('https://api.twitter.com/2/oauth2/token', params.toString(), { headers });
  const accessToken = response.data.access_token;
  let accountName = 'X Account';
  let externalAccountId = '';

  try {
    const userRes = await axios.get('https://api.twitter.com/2/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (userRes.data && userRes.data.data) {
      accountName = `@${userRes.data.data.username}` || userRes.data.data.name;
      externalAccountId = userRes.data.data.id;
    }
  } catch (error) {
    accountName = 'X Account';
  }

  return {
    platform: 'x',
    accountName,
    externalAccountId,
    accessToken,
    refreshToken: response.data.refresh_token || '',
    expiresInSeconds: response.data.expires_in || 7200
  };
}

// ------------------------------------------
// META (FACEBOOK / INSTAGRAM) OAUTH
// ------------------------------------------
function buildMetaAuthUrl({ state }) {
  const redirectUri = getRedirectUri('meta');
  if (!env.metaAppId) {
    // Sandbox / Instant Connect mode when developer keys aren't set in env
    return `${redirectUri}?code=sandbox_meta_code&state=${state}`;
  }

  const params = new URLSearchParams({
    client_id: env.metaAppId,
    redirect_uri: redirectUri,
    state,
    scope: 'public_profile,pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish'
  });

  return `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;
}

async function exchangeMetaCode(code) {
  if (code.startsWith('sandbox_')) {
    return {
      platform: 'facebook',
      accountName: 'Connected Facebook Page & Instagram',
      externalAccountId: 'meta_sandbox_page_id',
      accessToken: 'sandbox_meta_access_token',
      refreshToken: '',
      expiresInSeconds: 5184000
    };
  }

  const redirectUri = getRedirectUri('meta');
  const params = new URLSearchParams({
    client_id: env.metaAppId,
    client_secret: env.metaAppSecret,
    redirect_uri: redirectUri,
    code
  });

  const response = await axios.get(`https://graph.facebook.com/v19.0/oauth/access_token?${params.toString()}`);
  const accessToken = response.data.access_token;
  let accountName = 'Meta Page / Account';
  let externalAccountId = '';
  let pageAccessToken = accessToken;

  try {
    const pagesRes = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
      params: {
        access_token: accessToken,
        fields: 'id,name,access_token,instagram_business_account'
      }
    });
    const page = pagesRes.data && Array.isArray(pagesRes.data.data) ? pagesRes.data.data[0] : null;
    if (page) {
      accountName = page.name || 'Meta Page';
      externalAccountId = page.id || '';
      pageAccessToken = page.access_token || accessToken;
    } else {
      const meRes = await axios.get('https://graph.facebook.com/v19.0/me', {
        params: { access_token: accessToken }
      });
      if (meRes.data) {
        accountName = meRes.data.name || 'Meta Account';
        externalAccountId = meRes.data.id || '';
      }
    }
  } catch (error) {
    accountName = 'Meta Account';
  }

  return {
    platform: 'facebook',
    accountName,
    externalAccountId,
    accessToken: pageAccessToken,
    refreshToken: '',
    expiresInSeconds: response.data.expires_in || 5184000
  };
}

module.exports = {
  buildLinkedInAuthUrl,
  exchangeLinkedInCode,
  buildTwitterAuthUrl,
  exchangeTwitterCode,
  generateTwitterPkcePair,
  buildMetaAuthUrl,
  exchangeMetaCode
};
