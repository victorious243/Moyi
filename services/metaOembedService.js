const axios = require('axios');
const env = require('../config/env');

const GRAPH_API_VERSION = 'v19.0';
const DEFAULT_TEST_URL = 'https://www.facebook.com/facebook';
const ALLOWED_HOSTS = new Set([
  'facebook.com',
  'www.facebook.com',
  'instagram.com',
  'www.instagram.com'
]);

function normalizeOembedUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_TEST_URL;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    const invalidError = new Error('Enter a valid public Facebook or Instagram URL.');
    invalidError.statusCode = 400;
    throw invalidError;
  }

  if (!['https:', 'http:'].includes(parsed.protocol) || !ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
    const invalidError = new Error('Only public Facebook or Instagram URLs can be tested on this review page.');
    invalidError.statusCode = 400;
    throw invalidError;
  }

  parsed.hash = '';
  return parsed.toString();
}

function endpointForUrl(targetUrl) {
  const host = new URL(targetUrl).hostname.toLowerCase();
  if (host.includes('instagram.com')) return `https://graph.facebook.com/${GRAPH_API_VERSION}/instagram_oembed`;
  return `https://graph.facebook.com/${GRAPH_API_VERSION}/oembed_page`;
}

function missingMetaOembedKeys() {
  return ['META_APP_ID', 'META_APP_SECRET'].filter((key) => {
    if (key === 'META_APP_ID') return !env.metaAppId;
    return !env.metaAppSecret;
  });
}

async function fetchMetaOembed(targetUrl) {
  const normalizedUrl = normalizeOembedUrl(targetUrl);
  const missingKeys = missingMetaOembedKeys();
  if (missingKeys.length) {
    const configError = new Error(`Meta oEmbed test is not configured. Missing ${missingKeys.join(', ')}.`);
    configError.statusCode = 503;
    throw configError;
  }

  const response = await axios.get(endpointForUrl(normalizedUrl), {
    params: {
      url: normalizedUrl,
      access_token: `${env.metaAppId}|${env.metaAppSecret}`,
      maxwidth: 720,
      omitscript: false
    },
    timeout: 12000
  });

  return {
    sourceUrl: normalizedUrl,
    html: response.data && response.data.html ? response.data.html : '',
    providerName: response.data && response.data.provider_name ? response.data.provider_name : 'Meta',
    authorName: response.data && response.data.author_name ? response.data.author_name : '',
    title: response.data && response.data.title ? response.data.title : '',
    raw: response.data
  };
}

module.exports = {
  DEFAULT_TEST_URL,
  fetchMetaOembed,
  missingMetaOembedKeys,
  normalizeOembedUrl
};
