class PaidAdsProvider {
  constructor(name) {
    this.name = name;
  }

  getAuthorizationRequest() {
    throw new Error(`${this.name} paid ads OAuth is not implemented.`);
  }

  async exchangeCode() {
    throw new Error(`${this.name} paid ads token exchange is not implemented.`);
  }

  async refreshToken() {
    throw new Error(`${this.name} paid ads token refresh is not implemented.`);
  }

  async listAccounts() {
    throw new Error(`${this.name} paid ads account discovery is not implemented.`);
  }

  async fetchInsights() {
    throw new Error(`${this.name} paid ads reporting is not implemented.`);
  }

  classifyError(error) {
    const status = Number(error && error.response && error.response.status);
    if (status === 401) return { code: 'token_expired', reconnectRequired: true, retryable: false };
    if (status === 403) return { code: 'scope_or_permission_denied', reconnectRequired: true, retryable: false };
    if (status === 429) return { code: 'rate_limited', reconnectRequired: false, retryable: true };
    return { code: 'provider_failure', reconnectRequired: false, retryable: status >= 500 || !status };
  }
}

module.exports = PaidAdsProvider;
