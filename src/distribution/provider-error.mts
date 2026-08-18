import axios from 'axios';

const SECRET_PATTERN = /(?:access_token|refresh_token|client_secret|authorization|x-amz-signature|x-amz-credential|x-amz-security-token)["'\s:=]+[^\s,"'}&]+/gi;
const X_BILLING_LIMIT_PATTERN = /\b(?:credits?\s+depleted|insufficient\s+credits?|usage\s+cap(?:ped)?|usage-capped|credit\s+balance|billing)\b/i;
const X_ACCOUNT_WRITE_RESTRICTION_PATTERN = /\b(?:you are not permitted to perform this action|account (?:is|has been) (?:locked|limited|restricted))\b/i;

function clean(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"'<>]*\/social-media\/public\/[^\s"'<>]+/gi, '[signed media URL redacted]')
    .replace(/([?&](?:access_token|code|client_secret|refresh_token|sig|signature|x-amz-credential|x-amz-security-token|x-amz-signature)=)[^&#\s]*/gi, '$1[credential redacted]')
    .replace(SECRET_PATTERN, '[credential redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [credential redacted]')
    .slice(0, 1200);
}

export function providerError(platform: string, error: unknown): Error & {
  code?: string;
  providerCode?: string;
  statusCode?: number;
  retryable?: boolean;
} {
  let detail = 'The provider rejected the request.';
  let statusCode: number | undefined;
  let providerCode = '';
  if (axios.isAxiosError(error)) {
    statusCode = error.response?.status;
    const data = error.response?.data as Record<string, unknown> | string | undefined;
    if (typeof data === 'string') detail = data;
    else if (data) {
      const errors = Array.isArray(data.errors)
        ? data.errors.map((item) => {
          if (item && typeof item === 'object') {
            const entry = item as Record<string, unknown>;
            return String(entry.detail || entry.message || entry.title || '');
          }
          return String(item || '');
        }).filter(Boolean).join('; ')
        : '';
      detail = String(data.detail || data.message || data.error_description || data.title || errors || detail);
      providerCode = String(data.type || data.code || data.error || '');
    } else if (error.message) detail = error.message;
  } else if (error instanceof Error) {
    detail = error.message;
    statusCode = (error as Error & { statusCode?: number }).statusCode;
  }

  const billingLimited = platform.toLowerCase() === 'x' && X_BILLING_LIMIT_PATTERN.test(`${providerCode} ${detail}`);
  const accountWriteRestricted = platform.toLowerCase() === 'x' && statusCode === 403 &&
    X_ACCOUNT_WRITE_RESTRICTION_PATTERN.test(`${providerCode} ${detail}`);
  const message = billingLimited
    ? 'X request failed: API credits are depleted. Add X API credits or increase the spending limit in the X Developer Console, then retry this post.'
    : accountWriteRestricted
      ? 'X rejected this account\'s write access. New or limited accounts may need verification: sign in to X directly, complete any email, phone, CAPTCHA, or account-limitation check, publish one manual post, then retry in Moyi.'
      : `${platform} request failed: ${clean(detail)}`;
  const wrapped = new Error(message) as Error & {
    code?: string;
    providerCode?: string;
    statusCode?: number;
    retryable?: boolean;
  };
  wrapped.code = billingLimited
    ? 'x_api_credits_depleted'
    : accountWriteRestricted
      ? 'x_account_write_restricted'
      : `${platform.toLowerCase()}_request_failed`;
  wrapped.providerCode = providerCode;
  wrapped.statusCode = statusCode;
  wrapped.retryable = Boolean(
    !billingLimited && ((error as Error & { retryable?: boolean })?.retryable ||
    statusCode === 408 || statusCode === 425 || statusCode === 429 || (statusCode && statusCode >= 500)
    )
  );
  return wrapped;
}

export function requireValue(value: string, message: string): string {
  if (value) return value;
  const error = new Error(message) as Error & { code?: string; statusCode?: number };
  error.code = 'provider_not_configured';
  error.statusCode = 503;
  throw error;
}
