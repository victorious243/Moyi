# Phase 5: Performance Marketing Intelligence

Moyi's performance marketing layer connects paid-media delivery to first-party
website outcomes. It is designed around the funnel:

`spend -> impression -> click -> visit -> lead -> qualified lead -> conversion -> revenue`

The system does not treat clicks or platform-reported conversions as revenue by
default. Provider metrics, first-party sessions, conversion goals, and revenue
events remain distinct until Moyi has enough evidence to join them.

## Supported providers

| Provider | Status | Required scopes | Notes |
| --- | --- | --- | --- |
| Google Ads | Available | `https://www.googleapis.com/auth/adwords` | Requires a Google Ads developer token and customer access. |
| Meta Ads | Available | `ads_read`, `business_management` | Reads connected ad accounts and insights. App review may be required for external users. |
| LinkedIn Ads | Approval gated | `r_ads`, `r_ads_reporting` | Adapter boundary is registered, but live reporting requires LinkedIn Marketing API approval. |
| TikTok Ads | Approval gated | Advertiser/account and reporting read permissions | Adapter boundary is registered, but live reporting requires TikTok API for Business approval. |

Google Ads authorization is intentionally separate from the Google Search
Console connection. A Search Console read-only grant does not authorize Google
Ads reporting.

## Environment variables

```dotenv
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_REDIRECT_URI=https://moyi-cmo.com/projects/paid-ads/google_ads/callback
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_API_VERSION=v25

META_ADS_APP_ID=
META_ADS_APP_SECRET=
META_ADS_REDIRECT_URI=https://moyi-cmo.com/projects/paid-ads/meta_ads/callback
```

The redirect URIs must match the provider console exactly. Tokens are encrypted
with Moyi's existing encrypted-secret service, excluded from normal model
queries, and never rendered in the frontend.

## Installation and migration

```bash
npm ci
npm run migrate:paid-performance
npm run build:distribution
npm test
```

Restart the web and worker processes after adding the environment variables.
The project worker executes account synchronization and intelligence generation
outside the request path.

## Data model

- `PaidAdAccount`: project-scoped provider connection and encrypted credentials.
- `PaidAdEntity`: normalized campaign, ad group/ad set, creative, audience, and placement hierarchy.
- `PaidMetricSnapshot`: daily provider metrics with unavailable values stored as `null`, not invented zeroes.
- `PaidAttribution`: first-party funnel events linked to UTMs or hashed click identifiers.
- `PaidBudgetRecommendation`: evidence, confidence, impact, proposed change, risk, expected outcome, and approval state.

Provider-native response fragments may be retained for debugging, but access
tokens are never copied into metric records.

## Attribution

`moyi-tracker.js` preserves UTMs and supported click identifiers across the
session. It supports `gclid`, `gbraid`, `wbraid`, `fbclid`, `li_fat_id`, and
`ttclid`. Click identifiers are hashed before storage.

Applications can send funnel events with:

```js
window.moyiTrack('conversion', 'qualified_lead', {
  funnelStage: 'qualified_lead',
  value: 120,
  currency: 'EUR'
});
```

Confidence is explicit:

- `100`: provider click identifier is present.
- `90`: source, medium, and campaign UTMs are present.
- `75`: campaign-level paid UTM evidence is present.
- `50`: only a weaker paid-source signal is available.

Moyi does not claim deterministic attribution when browsers, consent choices,
cross-device journeys, or provider aggregation prevent it.

## Metric rules

Derived metrics are calculated only when their required inputs exist:

- `CTR = clicks / impressions`
- `CPC = spend / clicks`
- `CPM = spend / impressions * 1000`
- `CPA = spend / conversions`
- `CAC = spend / acquired customers`
- `ROAS = conversion value / spend`
- `CPL = spend / leads`
- `Frequency = impressions / reach`

Mixed currencies are not combined into one executive spend or revenue total.
Unavailable provider metrics remain unavailable in the UI.

## Recommendations and approval

Budget recommendations compare channels and campaigns only when there is enough
evidence. Each recommendation includes evidence, confidence, business impact,
the proposed percentage shift, risk, and expected outcome. Approval records the
human decision; it never changes a provider budget automatically.

## Operational limitations

- Google Ads reporting depends on developer-token access level and API quota.
- Meta insight fields vary by campaign objective, attribution window, level, and account permissions.
- Provider-reported conversions can differ from Moyi first-party conversions because attribution models and consent boundaries differ.
- Reach, audience, placement, and revenue are not exposed uniformly by every provider.
- LinkedIn Ads and TikTok Ads remain disabled until the respective app reviews are complete.
- Newly connected accounts may need one completed asynchronous sync before the dashboard has comparable periods.

## Troubleshooting

- `reconnect_required`: reconnect the account so Moyi can obtain current scopes.
- `rate_limited`: allow the queued retry to run; do not repeatedly reconnect.
- `permission_denied`: verify account access, app review, and requested scopes.
- No attributed visits: verify the tracker installation, consent state, UTMs, and conversion goal names.
- No executive total: check whether the connected accounts use different currencies.

## Verification

```bash
node --test tests/performance_marketing_intelligence.test.js
node --test tests/software_smoke.test.js
npm test
npm run typecheck
```
