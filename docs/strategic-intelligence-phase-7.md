# Phase 7: Strategic Intelligence

## Purpose

Strategy Intelligence turns Moyi's stored first-party evidence into directional forecasts, material-change alerts, accountable opportunities, and monthly executive reviews. It never changes budgets, campaigns, positioning, or websites automatically.

## Evidence sources

- `TrackingEvent`: sessions, funnel stages, conversions, and revenue events received by `moyi-tracker.js`.
- `SearchMetric`: query-level Google Search Console clicks, impressions, and average position.
- `PaidMetricSnapshot`: normalized campaign-level paid spend and attributed outcomes. Campaign-level rows are used to avoid double counting ad-group and creative rollups.
- `CompetitorPage`: public pages collected by bounded, robots-aware competitor crawls.
- `MarketingGoal`: project targets and measurement periods.

Missing evidence remains unavailable. Moyi does not replace unavailable values with invented benchmarks or scores.

## Forecast method

Additive KPIs use a transparent daily linear trend plus the actual value already accumulated in the target period. Ratio KPIs use a weighted recent mean. Forecasting requires at least seven observed days.

Moyi applies a five-percent uncertainty floor so perfectly flat or linear history is not presented as certainty. Each forecast stores:

- point estimate and lower/upper range;
- observed-day count and date coverage;
- residual stability and R-squared where applicable;
- confidence score and band;
- goal achievement probability when a target exists;
- a plain-language reason when evidence is insufficient.

Forecasts are directional estimates, not guarantees.

## Change detection

### Search demand

Moyi labels an impression movement as demand change only when average position remains within two positions. When rank changes materially, the signal is classified as ranking movement. This distinction reduces false market-demand claims. Search Console describes demand visible to the connected property, not the total market.

### Audience

Audience shifts require at least 30 sessions in both 28-day windows. Channel/geography share must move at least ten percentage points. Conversion behavior and pages per session have separate materiality thresholds. No unavailable demographic trait is inferred.

### Competitors

Each successful public competitor crawl can create a historical fingerprint snapshot. Moyi compares snapshots for new or removed pages and public messaging, pricing, offer, campaign, and positioning changes. It does not access private dashboards, restricted APIs, or private competitor data.

Share of voice is intentionally unavailable until a lawful, representative search-market dataset is connected. Current Search Console data is not sufficient to calculate total-market share of voice.

## Strategic lifecycle

1. Refresh normalizes evidence and creates forecasts.
2. Material shifts create deduplicated alerts and growth opportunities.
3. A project manager accepts or dismisses an opportunity.
4. Accepted opportunities become retained strategic decisions.
5. Humans mark execution started and completed.
6. Outcomes remain pending until comparable post-decision evidence exists.

The daily Growth Intelligence scheduler performs an isolated Strategy Intelligence refresh. A failure is logged but cannot block the morning briefing. Heavy manual refresh and monthly review work runs through the existing project job queue.

## Routes

- `GET /projects/:id/strategy-intelligence`
- `POST /projects/:id/strategy-intelligence/refresh`
- `POST /projects/:id/strategy-intelligence/monthly-review`
- `POST /projects/:id/strategy-intelligence/opportunities/:opportunityId`
- `POST /projects/:id/strategy-intelligence/decisions/:decisionId`

## Setup

No new OAuth scope or environment variable is required. Existing tracker, Search Console, paid-ad, and social integrations supply the evidence.

```bash
npm run migrate:strategic-intelligence
npm test
```

## Current limitations

- Forecasts cannot compensate for missing tracker events, offline revenue, or unconnected ad accounts.
- Search demand is property-visible demand, not an industry-wide panel.
- Competitor detection is limited to public pages reached by the bounded crawler.
- Share of voice and private competitor campaign spend are not claimed without an appropriate external source.
- Strategy recommendations require human approval and do not modify external systems.
