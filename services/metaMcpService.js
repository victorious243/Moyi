const axios = require('axios');
const { recordAppLog } = require('./appLogger');

const GRAPH_API_VERSION = 'v19.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

function logInfo(message, metadata = {}) {
  recordAppLog({ level: 'info', message, metadata }).catch(() => {});
}

/**
 * Publishes a text, link, or image post directly to a Facebook Page via Graph API.
 */
async function publishFacebookPagePost({ accessToken, pageId, message, link = '', imageUrl = '' }) {
  if (!accessToken || accessToken.startsWith('sandbox_')) {
    const mockId = `fb_post_sandbox_${Date.now()}`;
    logInfo('[MetaMCP] Simulated Facebook Page post in sandbox mode', { pageId, mockId });
    return { externalId: mockId, status: 'published', platform: 'facebook' };
  }

  const targetPageId = pageId || 'me';
  let endpoint = `${GRAPH_BASE_URL}/${targetPageId}/feed`;
  let params = {
    access_token: accessToken,
    message
  };

  if (imageUrl) {
    endpoint = `${GRAPH_BASE_URL}/${targetPageId}/photos`;
    params.url = imageUrl;
    params.caption = message;
  } else if (link) {
    params.link = link;
  }

  const response = await axios.post(endpoint, null, { params });
  const externalId = response.data.id || response.data.post_id || `fb_${Date.now()}`;

  logInfo('[MetaMCP] Direct Facebook Page post published', { pageId: targetPageId, externalId });
  return { externalId, status: 'published', platform: 'facebook', raw: response.data };
}

/**
 * Publishes an image post to an Instagram Business account via Graph API two-step container flow.
 */
async function publishInstagramBusinessPost({ accessToken, instagramAccountId, imageUrl, caption = '' }) {
  if (!accessToken || accessToken.startsWith('sandbox_')) {
    const mockId = `ig_post_sandbox_${Date.now()}`;
    logInfo('[MetaMCP] Simulated Instagram post in sandbox mode', { instagramAccountId, mockId });
    return { externalId: mockId, status: 'published', platform: 'instagram' };
  }

  if (!imageUrl) {
    throw new Error('Instagram Graph API requires an image URL for feed posts.');
  }

  const targetIgId = instagramAccountId || 'me';

  // Step 1: Create media container
  const containerRes = await axios.post(`${GRAPH_BASE_URL}/${targetIgId}/media`, null, {
    params: {
      access_token: accessToken,
      image_url: imageUrl,
      caption
    }
  });

  const creationId = containerRes.data.id;
  if (!creationId) {
    throw new Error('Failed to create Instagram media container.');
  }

  // Step 2: Publish media container
  const publishRes = await axios.post(`${GRAPH_BASE_URL}/${targetIgId}/media_publish`, null, {
    params: {
      access_token: accessToken,
      creation_id: creationId
    }
  });

  const externalId = publishRes.data.id || `ig_${Date.now()}`;
  logInfo('[MetaMCP] Direct Instagram Business post published', { instagramAccountId: targetIgId, externalId });

  return { externalId, status: 'published', platform: 'instagram', raw: publishRes.data };
}

/**
 * Inspects a Meta token and returns app/user health status via Meta DevTools MCP / Graph API.
 */
async function inspectMetaToken({ accessToken }) {
  if (!accessToken || accessToken.startsWith('sandbox_')) {
    return {
      isValid: true,
      appId: 'moyi_meta_sandbox_app',
      scopes: ['pages_manage_posts', 'instagram_content_publish'],
      expiresAt: new Date(Date.now() + 5184000000)
    };
  }

  try {
    const res = await axios.get(`${GRAPH_BASE_URL}/debug_token`, {
      params: { input_token: accessToken, access_token: accessToken }
    });
    return {
      isValid: res.data.data.is_valid,
      appId: res.data.data.app_id,
      scopes: res.data.data.scopes || [],
      expiresAt: new Date(res.data.data.expires_at * 1000)
    };
  } catch (error) {
    return { isValid: false, error: error.message };
  }
}

module.exports = {
  publishFacebookPagePost,
  publishInstagramBusinessPost,
  inspectMetaToken
};
