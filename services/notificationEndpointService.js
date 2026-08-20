const dns = require('dns').promises;
const net = require('net');
const NotificationEndpoint = require('../models/NotificationEndpoint');
const { decrypt, encrypt } = require('../utils/crypto');

function isPrivateIp(address) {
  const value = String(address || '').toLowerCase();
  if (!value) return true;
  if (net.isIPv4(value)) {
    const parts = value.split('.').map(Number);
    return parts[0] === 10
      || parts[0] === 127
      || parts[0] === 0
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
  }
  if (net.isIPv6(value)) {
    return value === '::1'
      || value === '::'
      || value.startsWith('fc')
      || value.startsWith('fd')
      || value.startsWith('fe8')
      || value.startsWith('fe9')
      || value.startsWith('fea')
      || value.startsWith('feb');
  }
  return false;
}

function hostMatches(hostname, domains) {
  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function parseNotificationEndpointUrl(value, channel = 'webhook') {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch (error) {
    const validationError = new Error('Enter a valid HTTPS webhook URL.');
    validationError.statusCode = 422;
    throw validationError;
  }
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !hostname) {
    const error = new Error('Notification webhooks must use HTTPS and cannot contain credentials.');
    error.statusCode = 422;
    throw error;
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || isPrivateIp(hostname)) {
    const error = new Error('Notification webhooks must use a public internet host.');
    error.statusCode = 422;
    throw error;
  }
  if (channel === 'slack' && !hostMatches(hostname, ['hooks.slack.com', 'hooks.slack-gov.com'])) {
    const error = new Error('Use an incoming webhook URL created by Slack.');
    error.statusCode = 422;
    throw error;
  }
  if (channel === 'discord' && (!hostMatches(hostname, ['discord.com', 'discordapp.com']) || !parsed.pathname.startsWith('/api/webhooks/'))) {
    const error = new Error('Use an incoming webhook URL created by Discord.');
    error.statusCode = 422;
    throw error;
  }
  return parsed;
}

async function resolvePublicNotificationEndpoint(value, channel = 'webhook', resolver = dns.lookup) {
  const parsed = parseNotificationEndpointUrl(value, channel);
  let addresses;
  try {
    addresses = await resolver(parsed.hostname, { all: true, verbatim: true });
  } catch (error) {
    const lookupError = new Error('The notification webhook host could not be resolved.');
    lookupError.statusCode = 422;
    throw lookupError;
  }
  const resolved = Array.isArray(addresses) ? addresses : [addresses];
  if (!resolved.length || resolved.some((item) => isPrivateIp(item && item.address ? item.address : item))) {
    const error = new Error('The notification webhook resolved to a private or unsafe address.');
    error.statusCode = 422;
    throw error;
  }
  const selected = resolved[0] && resolved[0].address ? resolved[0] : { address: resolved[0], family: net.isIPv6(resolved[0]) ? 6 : 4 };
  return {
    url: parsed.toString(),
    hostname: parsed.hostname,
    address: selected.address,
    family: selected.family || (net.isIPv6(selected.address) ? 6 : 4)
  };
}

async function assertPublicNotificationEndpoint(value, channel = 'webhook', resolver = dns.lookup) {
  const resolved = await resolvePublicNotificationEndpoint(value, channel, resolver);
  return resolved.url;
}

function endpointUrlHint(value) {
  const parsed = parseNotificationEndpointUrl(value);
  return `${parsed.hostname}/...`;
}

async function createNotificationEndpoint({ projectId, userId, name, channel, url, signingSecret = '', resolver }) {
  const normalizedUrl = await assertPublicNotificationEndpoint(url, channel, resolver || dns.lookup);
  return NotificationEndpoint.create({
    projectId,
    createdBy: userId,
    name,
    channel,
    encryptedUrl: encrypt(normalizedUrl),
    urlHint: endpointUrlHint(normalizedUrl),
    encryptedSigningSecret: signingSecret ? encrypt(signingSecret) : '',
    status: 'active'
  });
}

async function getNotificationEndpointCredentials({ endpointId, projectId }) {
  const endpoint = await NotificationEndpoint.findOne({ _id: endpointId, projectId })
    .select('+encryptedUrl +encryptedSigningSecret');
  if (!endpoint) return null;
  return {
    endpoint,
    url: decrypt(endpoint.encryptedUrl),
    signingSecret: endpoint.encryptedSigningSecret ? decrypt(endpoint.encryptedSigningSecret) : ''
  };
}

module.exports = {
  assertPublicNotificationEndpoint,
  createNotificationEndpoint,
  endpointUrlHint,
  getNotificationEndpointCredentials,
  isPrivateIp,
  parseNotificationEndpointUrl,
  resolvePublicNotificationEndpoint
};
