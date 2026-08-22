const PaidAdsProvider = require('../provider');

class ApprovalGatedProvider extends PaidAdsProvider {
  constructor(name, setupMessage, scopes = []) {
    super(name);
    this.setupMessage = setupMessage;
    this.scopes = scopes;
  }

  getAuthorizationRequest() {
    const error = new Error(this.setupMessage);
    error.statusCode = 503;
    throw error;
  }
}

module.exports = ApprovalGatedProvider;

