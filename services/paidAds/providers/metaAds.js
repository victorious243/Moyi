const axios = require('axios');
const env = require('../../../config/env');
const PaidAdsProvider = require('../provider');
const { availableMetrics, calculateDerivedMetrics, roundMetrics } = require('../metrics');

const SCOPES = ['ads_read', 'business_management'];

function actionValue(actions, types) {
  if (!Array.isArray(actions)) return null;
  const matches = actions.filter((item) => types.includes(item.action_type));
  if (!matches.length) return null;
  return matches.reduce((sum, item) => sum + Number(item.value || 0), 0);
}

class MetaAdsProvider extends PaidAdsProvider {
  constructor(client = axios) {
    super('meta_ads');
    this.client = client;
  }

  assertConfigured() {
    if (!env.metaAdsAppId || !env.metaAdsAppSecret || !env.metaAdsRedirectUri) {
      const error = new Error('Meta Ads is not configured. Add META_ADS_APP_ID, META_ADS_APP_SECRET, and META_ADS_REDIRECT_URI.');
      error.statusCode = 503;
      throw error;
    }
  }

  graph(path) {
    return `https://graph.facebook.com/${env.metaGraphVersion}${path}`;
  }

  getAuthorizationRequest({ state }) {
    this.assertConfigured();
    const query = new URLSearchParams({
      client_id: env.metaAdsAppId,
      redirect_uri: env.metaAdsRedirectUri,
      response_type: 'code',
      scope: SCOPES.join(','),
      state
    });
    return { url: `https://www.facebook.com/${env.metaGraphVersion}/dialog/oauth?${query}`, scopes: SCOPES };
  }

  async exchangeCode(code) {
    this.assertConfigured();
    const shortResponse = await this.client.get(this.graph('/oauth/access_token'), {
      params: {
        client_id: env.metaAdsAppId,
        client_secret: env.metaAdsAppSecret,
        redirect_uri: env.metaAdsRedirectUri,
        code
      }
    });
    const longResponse = await this.client.get(this.graph('/oauth/access_token'), {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: env.metaAdsAppId,
        client_secret: env.metaAdsAppSecret,
        fb_exchange_token: shortResponse.data.access_token
      }
    });
    const payload = longResponse.data || shortResponse.data;
    return {
      accessToken: payload.access_token,
      refreshToken: '',
      expiresAt: payload.expires_in ? new Date(Date.now() + (Number(payload.expires_in) * 1000)) : null,
      scopes: SCOPES
    };
  }

  async refreshToken(accessToken) {
    const response = await this.client.get(this.graph('/oauth/access_token'), {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: env.metaAdsAppId,
        client_secret: env.metaAdsAppSecret,
        fb_exchange_token: accessToken
      }
    });
    return {
      accessToken: response.data.access_token,
      refreshToken: '',
      expiresAt: response.data.expires_in ? new Date(Date.now() + (Number(response.data.expires_in) * 1000)) : null,
      scopes: SCOPES
    };
  }

  async pagedGet(path, params) {
    const rows = [];
    let url = this.graph(path);
    let nextParams = params;
    while (url) {
      const response = await this.client.get(url, { params: nextParams });
      rows.push(...(response.data.data || []));
      url = response.data.paging && response.data.paging.next ? response.data.paging.next : '';
      nextParams = undefined;
    }
    return rows;
  }

  async listAccounts(tokens) {
    const rows = await this.pagedGet('/me/adaccounts', {
      access_token: tokens.accessToken,
      fields: 'id,name,currency,timezone_name,account_status,business',
      limit: 100
    });
    return rows.map((row) => ({
      externalAccountId: row.id,
      accountName: row.name || row.id,
      currency: row.currency || '',
      timezone: row.timezone_name || 'UTC',
      metadata: { accountStatus: row.account_status, business: row.business || null }
    }));
  }

  normalizeRow(row, level, currency) {
    const levelFields = {
      campaign: ['campaign_id', 'campaign_name'],
      ad_set: ['adset_id', 'adset_name'],
      creative: ['ad_id', 'ad_name']
    }[level];
    const leads = actionValue(row.actions, ['lead', 'onsite_conversion.lead_grouped']);
    const purchases = actionValue(row.actions, ['purchase', 'omni_purchase']);
    const conversions = actionValue(row.actions, [
      'offsite_conversion', 'purchase', 'omni_purchase', 'lead', 'onsite_conversion.lead_grouped'
    ]);
    const conversionValue = actionValue(row.action_values, ['purchase', 'omni_purchase']);
    const metrics = roundMetrics(calculateDerivedMetrics({
      spend: row.spend,
      impressions: row.impressions,
      reach: row.reach,
      clicks: row.clicks,
      ctr: row.ctr === undefined ? null : Number(row.ctr) / 100,
      cpc: row.cpc,
      cpm: row.cpm,
      frequency: row.frequency,
      conversions,
      conversionValue,
      leads,
      purchases
    }));
    return {
      level,
      externalId: String(row[levelFields[0]] || ''),
      parentExternalId: level === 'creative' ? String(row.adset_id || '') : '',
      campaignExternalId: String(row.campaign_id || ''),
      name: row[levelFields[1]] || row[levelFields[0]] || '',
      status: '',
      objective: '',
      date: row.date_start,
      currency,
      metrics,
      availableMetrics: availableMetrics(metrics),
      providerData: row
    };
  }

  normalizeBreakdownRow(row, level, currency) {
    const parts = level === 'placement'
      ? [row.publisher_platform, row.platform_position]
      : [row.age, row.gender];
    const label = parts.filter(Boolean).join(' / ') || 'Unknown';
    const base = this.normalizeRow({ ...row, campaign_id: row.campaign_id, campaign_name: label }, 'campaign', currency);
    return {
      ...base,
      level,
      externalId: `${row.campaign_id}:${level}:${label}`,
      parentExternalId: String(row.campaign_id || ''),
      campaignExternalId: String(row.campaign_id || ''),
      name: label,
      metadata: level === 'placement'
        ? { publisherPlatform: row.publisher_platform || '', platformPosition: row.platform_position || '' }
        : { age: row.age || '', gender: row.gender || '' }
    };
  }

  async fetchInsights({ account, accessToken, startDate, endDate }) {
    const output = [];
    for (const level of ['campaign', 'adset', 'ad']) {
      const internalLevel = level === 'adset' ? 'ad_set' : (level === 'ad' ? 'creative' : 'campaign');
      const identityFields = level === 'campaign'
        ? ['campaign_id', 'campaign_name']
        : level === 'adset'
          ? ['campaign_id', 'campaign_name', 'adset_id', 'adset_name']
          : ['campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name'];
      const fields = [
        ...identityFields,
        'spend', 'impressions', 'reach', 'clicks', 'ctr', 'cpc', 'cpm', 'frequency',
        'actions', 'action_values', 'date_start', 'date_stop'
      ].join(',');
      const rows = await this.pagedGet(`/${account.externalAccountId}/insights`, {
        access_token: accessToken,
        level,
        fields,
        time_increment: 1,
        time_range: JSON.stringify({ since: startDate, until: endDate }),
        limit: 100
      });
      output.push(...rows.map((row) => this.normalizeRow(row, internalLevel, account.currency)));
    }
    for (const breakdown of [
      { level: 'placement', breakdowns: 'publisher_platform,platform_position' },
      { level: 'audience', breakdowns: 'age,gender' }
    ]) {
      const rows = await this.pagedGet(`/${account.externalAccountId}/insights`, {
        access_token: accessToken,
        level: 'campaign',
        fields: 'campaign_id,campaign_name,spend,impressions,reach,clicks,ctr,cpc,cpm,frequency,actions,action_values,date_start,date_stop',
        breakdowns: breakdown.breakdowns,
        time_increment: 1,
        time_range: JSON.stringify({ since: startDate, until: endDate }),
        limit: 100
      });
      output.push(...rows.map((row) => this.normalizeBreakdownRow(row, breakdown.level, account.currency)));
    }
    return output.filter((row) => row.externalId && row.date);
  }
}

module.exports = MetaAdsProvider;
module.exports.META_ADS_SCOPES = SCOPES;
