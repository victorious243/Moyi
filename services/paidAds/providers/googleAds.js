const axios = require('axios');
const env = require('../../../config/env');
const PaidAdsProvider = require('../provider');
const { availableMetrics, calculateDerivedMetrics, roundMetrics } = require('../metrics');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/adwords';

class GoogleAdsProvider extends PaidAdsProvider {
  constructor(client = axios) {
    super('google_ads');
    this.client = client;
  }

  assertConfigured() {
    if (!env.googleAdsClientId || !env.googleAdsClientSecret || !env.googleAdsRedirectUri || !env.googleAdsDeveloperToken) {
      const error = new Error('Google Ads is not configured. Add its OAuth credentials, redirect URI, and developer token.');
      error.statusCode = 503;
      throw error;
    }
  }

  getAuthorizationRequest({ state }) {
    this.assertConfigured();
    const query = new URLSearchParams({
      client_id: env.googleAdsClientId,
      redirect_uri: env.googleAdsRedirectUri,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      state
    });
    return { url: `${AUTH_URL}?${query}`, scopes: [SCOPE] };
  }

  async exchangeCode(code) {
    this.assertConfigured();
    const response = await this.client.post(TOKEN_URL, new URLSearchParams({
      code,
      client_id: env.googleAdsClientId,
      client_secret: env.googleAdsClientSecret,
      redirect_uri: env.googleAdsRedirectUri,
      grant_type: 'authorization_code'
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    return this.normalizeTokens(response.data);
  }

  async refreshToken(refreshToken) {
    const response = await this.client.post(TOKEN_URL, new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.googleAdsClientId,
      client_secret: env.googleAdsClientSecret,
      grant_type: 'refresh_token'
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    return this.normalizeTokens({ ...response.data, refresh_token: refreshToken });
  }

  normalizeTokens(payload = {}) {
    return {
      accessToken: payload.access_token || '',
      refreshToken: payload.refresh_token || '',
      expiresAt: payload.expires_in ? new Date(Date.now() + (Number(payload.expires_in) * 1000)) : null,
      scopes: String(payload.scope || SCOPE).split(/\s+/).filter(Boolean)
    };
  }

  headers(accessToken, loginCustomerId = '') {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': env.googleAdsDeveloperToken,
      'Content-Type': 'application/json'
    };
    if (loginCustomerId) headers['login-customer-id'] = String(loginCustomerId).replace(/\D/g, '');
    return headers;
  }

  api(path) {
    return `https://googleads.googleapis.com/${env.googleAdsApiVersion}${path}`;
  }

  async search(customerId, accessToken, query, loginCustomerId = '') {
    const cleanId = String(customerId).replace(/\D/g, '');
    const response = await this.client.post(
      this.api(`/customers/${cleanId}/googleAds:searchStream`),
      { query },
      { headers: this.headers(accessToken, loginCustomerId) }
    );
    return (Array.isArray(response.data) ? response.data : [response.data])
      .flatMap((batch) => batch.results || []);
  }

  async listAccounts(tokens) {
    const response = await this.client.get(this.api('/customers:listAccessibleCustomers'), {
      headers: this.headers(tokens.accessToken)
    });
    const ids = (response.data.resourceNames || []).map((name) => String(name).split('/').pop());
    const accounts = [];
    for (const id of ids) {
      let details = {};
      try {
        const rows = await this.search(id, tokens.accessToken, [
          'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager',
          'FROM customer LIMIT 1'
        ].join(' '));
        details = rows[0] && rows[0].customer ? rows[0].customer : {};
      } catch (error) {
        details = {};
      }
      accounts.push({
        externalAccountId: String(details.id || id),
        accountName: details.descriptiveName || `Google Ads ${id}`,
        currency: details.currencyCode || '',
        timezone: details.timeZone || 'UTC',
        metadata: { manager: Boolean(details.manager) }
      });
    }
    return accounts;
  }

  queryFor(level, startDate, endDate) {
    const dateWhere = `segments.date BETWEEN '${startDate}' AND '${endDate}'`;
    const metrics = [
      'segments.date', 'metrics.cost_micros', 'metrics.impressions', 'metrics.clicks',
      'metrics.ctr', 'metrics.average_cpc', 'metrics.average_cpm', 'metrics.conversions',
      'metrics.conversions_value'
    ];
    if (level === 'ad_group') {
      return `SELECT campaign.id, ad_group.id, ad_group.name, ad_group.status, ${metrics.join(', ')} FROM ad_group WHERE ${dateWhere}`;
    }
    if (level === 'creative') {
      return `SELECT campaign.id, ad_group.id, ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status, ${metrics.join(', ')} FROM ad_group_ad WHERE ${dateWhere}`;
    }
    return `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros, ${metrics.join(', ')} FROM campaign WHERE ${dateWhere}`;
  }

  normalizeRow(row, level, currency) {
    const campaign = row.campaign || {};
    const adGroup = row.adGroup || {};
    const ad = (row.adGroupAd && row.adGroupAd.ad) || {};
    const entity = level === 'creative' ? ad : (level === 'ad_group' ? adGroup : campaign);
    const raw = row.metrics || {};
    const metrics = roundMetrics(calculateDerivedMetrics({
      spend: raw.costMicros === undefined ? null : Number(raw.costMicros) / 1000000,
      budget: level === 'campaign' && row.campaignBudget && row.campaignBudget.amountMicros !== undefined
        ? Number(row.campaignBudget.amountMicros) / 1000000
        : null,
      impressions: raw.impressions,
      clicks: raw.clicks,
      ctr: raw.ctr,
      cpc: raw.averageCpc === undefined ? null : Number(raw.averageCpc) / 1000000,
      cpm: raw.averageCpm === undefined ? null : Number(raw.averageCpm) / 1000000,
      conversions: raw.conversions,
      conversionValue: raw.conversionsValue
    }));
    return {
      level,
      externalId: String(entity.id || ''),
      parentExternalId: level === 'creative' ? String(adGroup.id || '') : '',
      campaignExternalId: String(campaign.id || entity.id || ''),
      name: entity.name || `${level.replace('_', ' ')} ${entity.id || ''}`.trim(),
      status: entity.status || '',
      objective: campaign.advertisingChannelType || '',
      date: row.segments && row.segments.date,
      currency,
      metrics,
      availableMetrics: availableMetrics(metrics),
      providerData: row
    };
  }

  async fetchInsights({ account, accessToken, startDate, endDate }) {
    const levels = ['campaign', 'ad_group', 'creative'];
    const output = [];
    for (const level of levels) {
      const rows = await this.search(
        account.externalAccountId,
        accessToken,
        this.queryFor(level, startDate, endDate),
        account.metadata && account.metadata.loginCustomerId
      );
      output.push(...rows.map((row) => this.normalizeRow(row, level, account.currency)));
    }
    return output.filter((row) => row.externalId && row.date);
  }
}

module.exports = GoogleAdsProvider;
module.exports.GOOGLE_ADS_SCOPE = SCOPE;

