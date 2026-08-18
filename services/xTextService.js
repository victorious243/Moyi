const twitterText = require('twitter-text');

const X_STANDARD_MAX_WEIGHTED_LENGTH = 280;

function xPostMetrics(value) {
  const text = String(value || '').trim();
  const parsed = twitterText.parseTweet(text);
  return {
    text,
    weightedLength: Number(parsed.weightedLength || 0),
    valid: Boolean(text && parsed.valid && parsed.weightedLength <= X_STANDARD_MAX_WEIGHTED_LENGTH)
  };
}

function xPostLimitMessage(weightedLength) {
  return `X posts for standard accounts must be ${X_STANDARD_MAX_WEIGHTED_LENGTH} weighted characters or fewer. This post is ${weightedLength}. Shorten it before publishing.`;
}

function assertStandardXPost(value) {
  const metrics = xPostMetrics(value);
  if (metrics.valid) return metrics;

  const error = new Error(metrics.weightedLength > X_STANDARD_MAX_WEIGHTED_LENGTH
    ? xPostLimitMessage(metrics.weightedLength)
    : 'X post copy contains invalid text. Remove unsupported control characters and try again.');
  error.code = metrics.weightedLength > X_STANDARD_MAX_WEIGHTED_LENGTH
    ? 'content_too_long'
    : 'invalid_post_text';
  error.statusCode = 422;
  throw error;
}

function trailingUrl(value) {
  const text = String(value || '');
  const urls = twitterText.extractUrlsWithIndices(text);
  const candidate = urls[urls.length - 1];
  if (!candidate || text.slice(candidate.indices[1]).trim()) return null;
  return candidate;
}

function graphemes(value) {
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
    return [...segmenter.segment(value)].map((item) => item.segment);
  }
  return Array.from(value);
}

function fitStandardXPost(value) {
  const original = String(value || '').trim();
  if (!original) return '';
  if (xPostMetrics(original).valid) return original;

  const url = trailingUrl(original);
  const source = (url ? original.slice(0, url.indices[0]) : original).trim();
  const suffix = url ? `...\n${url.url}` : '...';
  const segments = graphemes(source);
  let low = 0;
  let high = segments.length;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = `${segments.slice(0, middle).join('').trimEnd()}${suffix}`;
    if (xPostMetrics(candidate).valid) low = middle;
    else high = middle - 1;
  }

  let prefix = segments.slice(0, low).join('').trimEnd();
  const boundary = Math.max(prefix.lastIndexOf(' '), prefix.lastIndexOf('\n'));
  if (boundary >= Math.floor(prefix.length * 0.7)) prefix = prefix.slice(0, boundary).trimEnd();
  prefix = prefix.replace(/[,:;\-]+$/, '').trimEnd();

  const fitted = `${prefix}${suffix}`;
  assertStandardXPost(fitted);
  return fitted;
}

module.exports = {
  X_STANDARD_MAX_WEIGHTED_LENGTH,
  assertStandardXPost,
  fitStandardXPost,
  xPostLimitMessage,
  xPostMetrics
};
