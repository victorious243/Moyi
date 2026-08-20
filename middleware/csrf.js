const crypto = require('crypto');
const env = require('../config/env');

function csrfSecret() {
  return env.tokenEncryptionSecret || env.jwtSecret || 'moyi-csrf-development-secret';
}

function signCsrfNonce(nonce) {
  return crypto.createHmac('sha256', csrfSecret()).update(nonce).digest('hex');
}

function createCsrfToken() {
  const nonce = crypto.randomBytes(32).toString('hex');
  return `${nonce}.${signCsrfNonce(nonce)}`;
}

function isSignedCsrfToken(value) {
  const token = String(value || '');
  const [nonce, signature] = token.split('.');
  if (!nonce || !signature || !/^[a-f0-9]{64}$/i.test(nonce) || !/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }

  const expected = signCsrfNonce(nonce);
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function csrfCookieOptions() {
  const cookieOptions = {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: env.isProduction
  };

  if (env.cookieDomain) {
    cookieOptions.domain = env.cookieDomain;
  }

  return cookieOptions;
}

function firstTokenValue(value, cookieToken = '') {
  if (Array.isArray(value)) {
    return value.find((item) => item && item === cookieToken)
      || value.find((item) => item && isSignedCsrfToken(item))
      || value.find((item) => typeof item === 'string' && item)
      || value[0];
  }
  return value;
}

function csrfProtection(req, res, next) {
  // Early exit for external tracking script and events
  if (req.path === '/api/track' || req.path === '/tracker.js' || req.path === '/healthz' || req.path === '/readyz') {
    return next();
  }

  // 1. Generate CSRF token if not exists in cookies
  let token = req.cookies.csrf_token;
  const clientToken = firstTokenValue((req.body && req.body._csrf)
    || (req.query && req.query._csrf)
    || (req.headers && req.headers['x-csrf-token']), token);
  let shouldSetCookie = false;

  const clientTokenIsSigned = clientToken && isSignedCsrfToken(clientToken);

  if (clientTokenIsSigned && clientToken !== token) {
    token = clientToken;
    shouldSetCookie = true;
  }

  if (!token) {
    token = createCsrfToken();
    shouldSetCookie = true;
  }

  if (shouldSetCookie) {
    res.cookie('csrf_token', token, csrfCookieOptions());
  }

  // 2. Make token available to templates
  res.locals.csrfToken = token;

  // 3. Override res.render to inject CSRF hidden input into POST forms dynamically
  const originalRender = res.render;
  res.render = function (view, options, callback) {
    let done = callback;
    let opts = options;
    if (typeof options === 'function') {
      done = options;
      opts = {};
    }

    originalRender.call(this, view, opts, (err, html) => {
      if (err) {
        if (done) return done(err);
        return next(err);
      }

      const csrfInput = `<input type="hidden" name="_csrf" value="${res.locals.csrfToken || ''}">`;
      // Matches any <form> tag that has method="post" (case-insensitive, single/double quotes)
      const modifiedHtml = html.replace(/(<form[^>]*method=["']post["'][^>]*>)/gi, `$1${csrfInput}`);

      if (done) {
        done(null, modifiedHtml);
      } else {
        res.send(modifiedHtml);
      }
    });
  };

  // 4. Skip check for safe methods (GET, HEAD, OPTIONS)
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  // 5. Bypass CSRF for specific endpoints like webhooks and tracking API
  const bypassUrls = ['/webhooks/stripe', '/api/track'];
  if (bypassUrls.includes(req.path)) {
    return next();
  }

  // 6. Verify token
  const tokenMatchesCookie = clientToken && clientToken === token;
  const tokenIsSignedFallback = clientTokenIsSigned;

  if (!tokenMatchesCookie && !tokenIsSignedFallback) {
    const error = new Error('Invalid or missing CSRF token.');
    error.status = 403;
    return next(error);
  }

  next();
}

module.exports = csrfProtection;
