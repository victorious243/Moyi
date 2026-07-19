function normalizeUrl(input) {
  const value = String(input || '').trim();
  if (!value) return '';

  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const parsed = new URL(withProtocol);
  parsed.hash = '';
  parsed.search = '';
  parsed.hostname = parsed.hostname.toLowerCase();

  if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) {
    parsed.port = '';
  }

  return parsed.toString().replace(/\/$/, '');
}

function sameHost(url, baseUrl) {
  const left = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  const right = new URL(baseUrl).hostname.replace(/^www\./i, '').toLowerCase();
  return left === right;
}

function isCrawlableUrl(url) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;

  const filePattern = /\.(7z|avi|css|csv|doc|docx|gif|gz|ico|jpeg|jpg|js|json|mov|mp3|mp4|pdf|png|ppt|pptx|rar|svg|tar|txt|webp|xls|xlsx|xml|zip)$/i;
  return !filePattern.test(parsed.pathname);
}

module.exports = {
  normalizeUrl,
  sameHost,
  isCrawlableUrl
};
