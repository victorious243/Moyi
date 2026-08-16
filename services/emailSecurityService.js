const dns = require('dns').promises;

// In-memory cache for validated MX domains to avoid redundant DNS lookups (1 hour TTL)
const mxDomainCache = new Map();
const MX_CACHE_TTL_MS = 60 * 60 * 1000;

// Top disposable & temporary throwaway email domains
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com', 'tempmail.com', '10minutemail.com', 'guerrillamail.com',
  'yopmail.com', 'trashmail.com', 'sharklasers.com', 'getairmail.com',
  'dispostable.com', 'throwawaymail.com', 'temp-mail.org', 'temp-mail.io',
  'fakeinbox.com', 'mohmal.com', 'inboxbear.com', 'burnermail.io',
  'crazymailing.com', 'mytemp.email', 'tempail.com', 'generator.email',
  'emailondeck.com', 'throwawayemailaddress.com', 'disposablemail.com',
  'tempinbox.com', 'nada.ltd', 'inboxkitten.com', 'getnada.com',
  'abcvg.com', 'armyspy.com', 'cuvox.de', 'dayrep.com', 'einrot.com',
  'fleckens.hu', 'gustr.com', 'jourrapide.com', 'rhyta.com', 'superrito.com',
  'teleworm.us', 'trbvm.com', 'chacuo.net', 'dropmail.me', '10mail.org',
  'minuteinbox.com', 'mailcatch.com', 'yopmail.fr', 'yopmail.net',
  'cool.fr.nf', 'jetable.fr.nf', 'nospam.ze.tc', 'nomail.xl.cx',
  'mega.zik.dj', 'speed.1s.fr', 'courriel.fr.nf', 'moncourrier.fr.nf',
  'monemail.fr.nf', 'monmail.fr.nf', 'testmail.com', 'fakeemail.com',
  'immenseignite.info'
]);

// IP submission tracker for rate limiting (max 5 submissions per hour per IP)
const ipRateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const MAX_SUBMISSIONS_PER_HOUR = 5;

/**
 * Checks whether an email address uses a known disposable/temporary email provider.
 */
function isDisposableEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return false;
  }
  const domain = email.split('@').pop().toLowerCase().trim();
  return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}

/**
 * Validates domain MX (Mail Exchange) DNS records to verify the domain has active mail servers.
 */
async function verifyEmailDomainMx(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return { valid: false, reason: 'Invalid email syntax.' };
  }

  const domain = email.split('@').pop().toLowerCase().trim();

  // Basic TLD syntax check
  if (!domain || !domain.includes('.') || domain.endsWith('.') || domain.length < 4) {
    return { valid: false, reason: 'Invalid email domain.' };
  }

  // Fast-path known valid major email providers
  const trustedMajorDomains = new Set([
    'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com',
    'yahoo.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com',
    'aol.com', 'zoho.com', 'mail.com', 'gmx.com', 'yandex.com'
  ]);
  if (trustedMajorDomains.has(domain)) {
    return { valid: true };
  }

  // Check in-memory cache
  const cached = mxDomainCache.get(domain);
  if (cached && (Date.now() - cached.timestamp < MX_CACHE_TTL_MS)) {
    return { valid: cached.valid, reason: cached.reason };
  }

  try {
    const mxRecords = await dns.resolveMx(domain);
    if (Array.isArray(mxRecords) && mxRecords.length > 0) {
      mxDomainCache.set(domain, { valid: true, timestamp: Date.now() });
      return { valid: true };
    }
  } catch (error) {
    // If MX lookup fails (e.g. ENOTFOUND, ENODATA), check if domain has an A record as mail fallback
    if (error.code === 'ENODATA' || error.code === 'ESERVFAIL') {
      try {
        const aRecords = await dns.resolve4(domain);
        if (Array.isArray(aRecords) && aRecords.length > 0) {
          mxDomainCache.set(domain, { valid: true, timestamp: Date.now() });
          return { valid: true };
        }
      } catch (aError) {
        // Fall through to invalid
      }
    }
  }

  const reason = 'The email domain does not have valid mail servers (MX records). Please provide an active email address.';
  mxDomainCache.set(domain, { valid: false, reason, timestamp: Date.now() });
  return { valid: false, reason };
}

/**
 * Checks and records rate limit for contact submissions per IP address.
 */
function checkContactRateLimit(clientIp) {
  const ip = clientIp || '127.0.0.1';
  const now = Date.now();
  const history = ipRateLimitStore.get(ip) || [];

  // Filter timestamps within the rolling window
  const recentHistory = history.filter((timestamp) => (now - timestamp) < RATE_LIMIT_WINDOW_MS);

  if (recentHistory.length >= MAX_SUBMISSIONS_PER_HOUR) {
    return {
      allowed: false,
      reason: 'Too many contact requests from your IP. Please wait a while before sending another message.'
    };
  }

  recentHistory.push(now);
  ipRateLimitStore.set(ip, recentHistory);
  return { allowed: true };
}

/**
 * Comprehensive contact security check combining Honeypot, Disposable blocking, MX verification, and Rate Limiting.
 */
async function validateContactSubmission({ email, name, message, website, honeypotField, clientIp }) {
  // 1. Honeypot check (hidden fields filled by automated spam bots)
  if (website || honeypotField) {
    return { valid: false, reason: 'Unable to submit this message.' };
  }

  // 2. IP Rate Limit check
  const rateLimit = checkContactRateLimit(clientIp);
  if (!rateLimit.allowed) {
    return { valid: false, reason: rateLimit.reason };
  }

  // 3. Disposable / Throwaway email check
  if (isDisposableEmail(email)) {
    return {
      valid: false,
      reason: 'Disposable and temporary email addresses are not accepted. Please use your business or personal email address.'
    };
  }

  // 4. Live DNS MX Record verification
  const mxCheck = await verifyEmailDomainMx(email);
  if (!mxCheck.valid) {
    return { valid: false, reason: mxCheck.reason };
  }

  return { valid: true };
}

module.exports = {
  isDisposableEmail,
  verifyEmailDomainMx,
  checkContactRateLimit,
  validateContactSubmission,
  DISPOSABLE_EMAIL_DOMAINS
};
