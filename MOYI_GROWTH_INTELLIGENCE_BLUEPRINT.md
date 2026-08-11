# Moyi-CMO Growth Intelligence Blueprint

Status: Proposed implementation contract for review  
Date: 2026-08-11  
Scope: Growth intelligence, human-controlled execution, measurement, learning, and future read-only Meta data  

## 1. Product Decision

Moyi-CMO is a growth decision system, not a collection of marketing dashboards.

The product must continuously answer:

> Based on the reliable data available now, what is the best marketing opportunity this business should pursue next to grow?

The core operating loop is:

```text
Collect -> Normalize -> Detect -> Prioritize -> Approve -> Execute -> Measure -> Learn
```

Every surfaced opportunity must explain:

1. What Moyi observed.
2. Which evidence supports the observation.
3. Why the observation matters to business growth.
4. What action is recommended.
5. What outcome is expected, without inventing certainty.
6. How confident Moyi is and why.
7. What effort, cost, risk, and time are involved.
8. Which KPI will determine success.
9. When the outcome should be reviewed.

The user remains the final decision maker. No budget, public publishing, pricing, customer communication, or major website change may happen without the required approval.

## 2. Decisions For This Stage

### Build now

- A precise growth signal specification.
- A precise growth opportunity specification.
- Transparent opportunity and confidence scoring.
- Adapters over Moyi's existing crawl, Search Console, tracking, competitor, execution, and reporting data.
- A migration path from current `Recommendation` records into the growth intelligence model.
- Business memory and experiment specifications.
- A read-only Meta connector architecture for a later phase.
- A phased implementation plan with acceptance criteria.

### Do not build yet

- Meta campaign creation or budget modification.
- Autonomous social publishing.
- Automated pricing changes.
- Cross-customer model training.
- Unverified revenue attribution.
- Broad CRM, ecommerce, email, review, and trend integrations before the existing-data intelligence loop works.
- A large frontend rewrite.

The current direct social publishing work is an execution capability, not the foundation of the Growth Engine. It must remain separately gated and must not drive growth recommendations until read-only performance ingestion and outcome measurement exist.

## 3. What Exists Today

Moyi already has a strong portion of the operating loop. The correct approach is to reuse it, not rebuild it.

| Capability | Current implementation | Reuse decision | Main limitation |
| --- | --- | --- | --- |
| Business context | `Project`, `brand_profile`, goals, offer, audience, tone, logo | Reuse and gradually type | `brand_profile` and competitors are mixed/unstructured; no durable business memory |
| Website evidence | `Scan`, `Page`, `SeoIssue`, `crawlerService`, `auditService` | Reuse as primary evidence | Findings become recommendations directly; no independent signal layer or recurring deduplication |
| Search demand | `SearchMetric`, `ProjectSearchProperty`, `searchConsoleService` | Reuse as primary evidence | Opportunities are calculated ephemerally and are not part of one ranked cross-channel queue |
| First-party behavior | `TrackingEvent`, `ConversionGoal`, `trackingService` | Reuse as primary evidence | Event taxonomy is narrow; revenue source is intentionally absent |
| Attribution readiness | `attributionService`, `measurementService` | Reuse | Payment input is not connected to a customer's business, so revenue attribution must stay locked |
| Competitor evidence | `Competitor`, `CompetitorPage`, `CompetitorInsight` | Reuse cautiously | Insights are isolated from prioritization and have no lifecycle or outcome loop |
| Strategy reports | `Report`, `CmoReport`, `aiReportService`, `cmoReportService` | Reuse as narrative outputs | Reports contain arrays and mixed snapshots, not canonical opportunity records |
| Recommendation approval | `Recommendation` and status routes | Reuse as execution work queue | It requires a scan `auditId`, has only priority 1-5, and lacks confidence, cost, risk, KPI, review date, and decision history |
| Content execution | `ContentDraft`, multi-agent drafting, images, publishing services | Reuse | Only some execution types can be measured and linked back to outcomes |
| Social execution | `Campaign`, `SocialDraft`, `SocialAccount`, `PublishAction` | Keep separate and gated | Current connector path is write-oriented and does not ingest performance intelligence |
| Background processing | BullMQ, Redis, `ProjectJob`, worker process | Reuse | Job types are a closed enum and there is no scheduled signal/evaluation workflow |
| Measurement reports | Weekly/monthly CMO reports and execution impact | Reuse | Evaluation currently focuses on manually published content and simple before/after movement |
| SaaS controls | Users, project roles, Stripe plans, usage limits, audit logs | Reuse | Growth Engine usage, access, and retention rules are not defined yet |

## 4. Current End-to-End Flows

### Website flow

```text
Scan request
  -> BullMQ website scan
  -> crawlWebsite
  -> Page records
  -> auditPages
  -> SeoIssue records
  -> buildEvidenceRecommendations
  -> Recommendation records
  -> user approval
  -> ContentDraft records
  -> publish or mark published
  -> before/after measurement report
```

This is the strongest current flow. Its weakness is that `SeoIssue` is converted directly into `Recommendation`, so Moyi cannot distinguish an observed fact from an inferred opportunity and an executable action.

### Search Console flow

```text
Google OAuth
  -> property selection
  -> SearchMetric rows
  -> calculateGscOpportunities
  -> temporary dashboard cards
  -> create Recommendation against latest completed scan
  -> generate ContentDraft
```

This is valuable and factual, but the temporary opportunity is lost unless the user creates a draft. Tying a GSC opportunity to the latest scan is also incorrect lineage.

### Tracking and reporting flow

```text
Moyi tracker
  -> TrackingEvent records
  -> ConversionGoal matching
  -> analytics and readiness summaries
  -> weekly/monthly CmoReport
  -> execution before/after comparisons
```

This correctly avoids invented revenue. The next architecture should preserve that honesty and let a real customer payment or CRM connector unlock revenue only when its records exist.

### Competitor flow

```text
discovery or manual competitor
  -> competitor page crawl
  -> CompetitorPage records
  -> system or AI CompetitorInsight
  -> competitor screens
```

The evidence and confidence fields are reusable. The insights currently do not enter the same signal, opportunity, approval, and learning lifecycle as first-party evidence.

## 5. Current Architectural Gaps

### 5.1 Facts, interpretations, and actions are mixed

A crawl issue is a fact. "Improve this page" is an action. "This can increase qualified organic traffic" is an opportunity hypothesis. They must not be stored as if they are the same object.

### 5.2 Cross-channel ranking is impossible

Moyi cannot fairly compare:

- a crawl indexability blocker,
- a low-CTR GSC query,
- a conversion-rate decline,
- an execution queue bottleneck, and
- a competitor content gap.

The records use different structures and scoring systems.

### 5.3 Current dashboard scores are operational heuristics

The project workspace computes evidence, strategy, measurement, and execution scores from record presence and counts. These are useful readiness indicators, but they are not growth impact scores. They must be labeled as readiness and must never be presented as evidence of business growth.

### 5.4 Opportunity lineage is incomplete

GSC opportunities are attached to a scan because `Recommendation.auditId` is required. Competitor insights and tracking gaps remain separate. A user cannot inspect one durable chain from source record to signal to decision to action to result.

### 5.5 Learning is not persisted

Moyi can describe before/after movement in a report, but it does not store a reusable conclusion such as:

> Metadata improvements on high-impression commercial pages have produced positive CTR movement twice for this project.

### 5.6 Missing business structure

Moyi has an offer, audience, goal, and discovered profile, but no typed products, segments, unit economics, channel objectives, target KPIs, constraints, seasonality, or verified strategy history.

### 5.7 Meta is currently execution-oriented

The in-progress social connector stores publishing credentials and requests publishing permissions. It does not normalize post, audience, or ad performance. It therefore cannot support evidence-led Meta opportunities yet.

## 6. Target Architecture

The Growth Engine is a set of independent domain services around a shared evidence contract.

```text
                    +----------------------+
                    | Connector / Data     |
                    | adapters             |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    | Normalized evidence  |
                    | and source lineage   |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    | Signal detectors     |
                    | facts and changes    |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    | Opportunity engine   |
                    | score and strategy   |
                    +----------+-----------+
                               |
                    human approval decision
                               |
                               v
                    +----------------------+
                    | Execution bridge     |
                    | existing workflows   |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    | Outcome evaluation   |
                    | and experiments      |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    | Business memory      |
                    | evidence-backed only |
                    +----------------------+
```

### Domain boundaries

`growth/data`

- Connector accounts and sync runs.
- Normalized observations for new integrations.
- Adapters over existing Moyi collections.
- Freshness and data-quality metadata.

`growth/signals`

- Deterministic detectors.
- Signal lifecycle and deduplication.
- Evidence references.
- No action recommendations.

`growth/opportunities`

- Converts one or more signals into a growth hypothesis.
- Applies scoring and ranking.
- Produces the complete strategy contract.
- Owns the human decision lifecycle.

`growth/execution`

- Maps an approved opportunity to existing recommendation, content, campaign, publishing, or manual action flows.
- Enforces approval and risk policy.

`growth/measurement`

- Captures baselines.
- Evaluates KPI and guardrail movement.
- Separates correlation from causal evidence.

`growth/memory`

- Stores durable, project-specific facts and learned patterns.
- Resolves conflicts and superseded beliefs.

`integrations/meta-read`

- Owns Meta OAuth, account discovery, read-only sync, normalization, rate limiting, and token health.
- Does not own opportunity logic.

## 7. Universal Evidence Contract

Every signal and opportunity must point to exact source evidence. Do not copy only a prose summary.

```js
{
  source: 'crawl|gsc|tracker|competitor|meta|manual|execution|payment|crm',
  model: 'SeoIssue|SearchMetric|TrackingEvent|...',
  recordId: ObjectId | null,
  externalId: String,
  metric: String,
  value: Number | String | Boolean,
  unit: String,
  dimensions: Object,
  observedAt: Date,
  periodStart: Date | null,
  periodEnd: Date | null,
  sourceUrl: String,
  freshnessAt: Date,
  qualityScore: Number,
  excerpt: String
}
```

Rules:

- `excerpt` is a short user-readable explanation, not the canonical value.
- `qualityScore` is data quality, not recommendation confidence.
- URLs and external identifiers must be sanitized before display.
- Evidence records must remain inspectable after the source sync completes.
- If underlying evidence is removed, the signal becomes `evidence_missing`; it is not silently retained as fact.

## 8. Growth Signal Specification

Add a canonical `GrowthSignal` model.

### Required fields

```js
{
  projectId: ObjectId,
  detectorKey: String,
  detectorVersion: String,
  signalType: String,
  source: String,
  entityType: String,
  entityKey: String,
  title: String,
  observation: String,
  metric: {
    name: String,
    current: Number,
    baseline: Number | null,
    delta: Number | null,
    deltaPercent: Number | null,
    unit: String,
    direction: 'up|down|flat|unknown'
  },
  evidence: [EvidenceReference],
  dataQualityScore: Number,
  sampleSize: Number | null,
  status: 'active|resolved|expired|invalid|evidence_missing',
  firstDetectedAt: Date,
  lastDetectedAt: Date,
  observedAt: Date,
  expiresAt: Date | null,
  fingerprint: String
}
```

### Signal rules

- A signal describes what happened. It does not prescribe an action.
- Detectors should be deterministic whenever the rule is deterministic.
- The same detector, project, entity, and comparison window must produce the same fingerprint.
- Repeated detection updates `lastDetectedAt` and the evidence snapshot instead of creating duplicates.
- A detector must state its minimum sample, comparison period, freshness window, and suppression rules.
- AI may summarize a signal but may not create the underlying metric or change.

### Initial signal catalogue

| Detector key | Current data | Minimum evidence | Expiry |
| --- | --- | --- | --- |
| `crawl.indexability_blocker` | critical `SeoIssue` types | one completed scan and exact issue | next completed scan |
| `crawl.metadata_gap` | title/meta issues | exact URL and issue | next completed scan |
| `crawl.content_depth_gap` | thin content and structure issues | exact URL and word/headings evidence | next completed scan |
| `gsc.page_one_low_ctr` | `SearchMetric` | at least 20 impressions, position 1-10, below project weighted CTR | 14 days without refresh |
| `gsc.page_two_demand` | `SearchMetric` | position 11-20 and high-impression threshold | 14 days without refresh |
| `gsc.visibility_gain` | current vs previous metrics | material positive change and sufficient impressions | 14 days |
| `gsc.visibility_loss` | current vs previous metrics | material negative change and sufficient impressions | 14 days |
| `tracker.conversion_decline` | `TrackingEvent` | comparable windows and minimum sessions | 14 days |
| `tracker.traffic_without_conversion` | events and goals | sessions above threshold, zero or weak conversions | 14 days |
| `measurement.instrumentation_gap` | telemetry audit and goals | failed factual check | until corrected |
| `execution.approval_bottleneck` | recommendations and drafts | aged queue item above threshold | when queue changes |
| `execution.post_publish_movement` | published draft, GSC, events | valid before/after window | retained as historical signal |
| `competitor.content_gap` | competitor and project pages | explicit compared pages and confidence floor | next competitor crawl |

The thresholds above are initial operating rules, not universal marketing truths. They must be versioned and tested against real project data.

## 9. Growth Opportunity Specification

Add a canonical `GrowthOpportunity` model. This is the main object shown in the Growth Opportunities dashboard.

### Required strategy structure

```js
{
  projectId: ObjectId,
  signalIds: [ObjectId],
  title: String,
  observation: String,
  evidenceSummary: String,
  opportunity: String,
  recommendedAction: String,
  growthLever: 'revenue|acquisition|conversion|retention|visibility|measurement',
  funnelStage: 'awareness|consideration|conversion|retention|measurement',
  targetEntity: {
    type: String,
    key: String,
    urls: [String]
  },
  expectedImpact: {
    mode: 'directional|estimated_range|historical_benchmark',
    metric: String,
    direction: 'increase|decrease|protect|learn',
    low: Number | null,
    high: Number | null,
    unit: String,
    rationale: String
  },
  primaryKpi: {
    name: String,
    baseline: Number | null,
    target: Number | null,
    unit: String,
    source: String
  },
  guardrailKpis: [{ name, threshold, unit, source }],
  confidence: { score, band, reasons },
  impactScore: Number,
  effortScore: Number,
  costScore: Number,
  riskScore: Number,
  urgencyScore: Number,
  timeToValueScore: Number,
  strategicFitScore: Number,
  evidenceFreshnessScore: Number,
  opportunityScore: Number,
  scoreVersion: String,
  cost: {
    known: Boolean,
    amount: Number | null,
    currency: String,
    description: String
  },
  review: {
    durationDays: Number,
    reviewAt: Date | null,
    minimumSample: Number | null
  },
  status: String,
  decision: {
    decidedBy: ObjectId | null,
    decidedAt: Date | null,
    reason: String,
    modifications: String
  },
  fingerprint: String,
  version: Number
}
```

### Opportunity states

```text
detected
  -> proposed
      -> approved -> in_progress -> completed -> evaluating -> validated|invalidated|inconclusive
      -> modified -> approved
      -> rejected
      -> deferred -> proposed
      -> archived
```

Rules:

- `modified` must preserve the original strategy and record the user's change.
- `deferred` requires `reviewAt`.
- Rejected opportunities remain available for learning and audit history.
- Completing an action does not mean the opportunity was successful.
- `validated`, `invalidated`, and `inconclusive` are assigned only by outcome evaluation or explicit human review.

## 10. Metric Priority Hierarchy

Moyi must rank outcomes by business value. The first KPI with reliable data should dominate lower-level vanity metrics.

| Tier | Metrics | Priority weight |
| --- | --- | ---: |
| 1 | profit, revenue, customers, customer lifetime value | 1.00 |
| 2 | purchases, qualified leads, trials, bookings | 0.90 |
| 3 | conversion rate, enquiries, product-page visits, qualified website visits, search clicks | 0.70 |
| 4 | shares, saves, meaningful comments, high-intent engagement | 0.45 |
| 5 | reach, impressions, followers, raw views | 0.20 |

Rules:

- A lower-tier metric may be a leading signal, but it must not be described as the final business result.
- When no Tier 1 or Tier 2 source is connected, Moyi must state that the opportunity is optimized for a proxy KPI.
- Moyi's own Stripe billing data must never be used as a customer's revenue source.

## 11. Opportunity Scoring Version 1

All component scores use a 0-100 scale.

```text
benefit =
  impact * 0.35
  + confidence * 0.25
  + urgency * 0.15
  + time_to_value * 0.10
  + strategic_fit * 0.10
  + evidence_freshness * 0.05

penalty =
  effort * 0.10
  + cost * 0.08
  + risk * 0.07

opportunity_score = clamp(round(benefit - penalty), 0, 100)
```

This formula is for prioritization, not a promise of ROI.

### Impact score

Impact combines:

- KPI tier weight.
- Size of the affected audience, traffic, spend, or customer group.
- Magnitude of the observed gap or movement.
- Relevance to the project's declared main goal.

Numeric uplift must not be invented. If Moyi lacks project history or a valid benchmark, `expectedImpact.mode` must be `directional` and numeric range fields remain null.

### Confidence score

```text
confidence =
  data_quality * 0.30
  + sample_strength * 0.25
  + consistency * 0.20
  + recency * 0.15
  + causal_strength * 0.10
```

Bands:

- Low: 0-44
- Medium: 45-74
- High: 75-100

Confidence caps:

- Generic best practice without project evidence: do not create an opportunity.
- One weak or stale source: maximum 35.
- One fresh primary source with adequate sample: maximum 65.
- Multiple consistent project sources: maximum 85.
- Repeated successful project experiments: up to 100.

### Cost and unknowns

- Known financial cost should use the project's currency.
- Unknown cost is not zero. It receives a neutral-high cost score of 60 until reviewed.
- Missing material fields reduce confidence and add an explicit limitation.

### Risk policy

Risk includes financial, brand, legal, privacy, reversibility, and operational risk.

- Low risk: content draft, metadata draft, internal analysis.
- Medium risk: public post, email campaign, material website change.
- High risk: ad budget, pricing, customer targeting, destructive or irreversible action.

High-risk opportunities always require explicit human approval and cannot be batch approved.

## 12. Opportunity Generation Rules

The Opportunity Engine consumes signals, project context, and active memory.

1. Group compatible signals by entity, metric, and growth lever.
2. Suppress contradictory or stale signals.
3. Check business relevance against the project's goal, offer, audience, and constraints.
4. Choose the highest reliable KPI available.
5. Generate a strategy contract.
6. Calculate transparent component scores.
7. Deduplicate using project, target, action family, and active signal fingerprints.
8. Rank active opportunities.
9. Surface at most three top opportunities, three quick wins, one strategic bet, and one measurement warning on the main workspace.

AI may help write the explanation and propose action details. Deterministic code owns source metrics, score calculation, evidence references, lifecycle transitions, and approval checks.

## 13. Recommendation Migration Strategy

Do not remove `Recommendation` in the first implementation.

### New relationship

Add optional fields to `Recommendation`:

```js
opportunityId: ObjectId | null
sourceType: 'scan|gsc|tracker|competitor|meta|manual|legacy'
```

Make `auditId` optional only after every scan-specific query explicitly filters `sourceType: 'scan'` or handles a null audit.

### Runtime behavior

- `GrowthOpportunity` owns evidence, scoring, approval, review period, and outcome.
- When an opportunity is approved, an execution bridge creates or links a `Recommendation`.
- Existing content generation continues to use `Recommendation` during migration.
- Existing recommendations are exposed as `legacy` opportunities through an adapter until backfill is complete.
- No historical recommendation is deleted during migration.

### Why this bridge is necessary

Content generation, recommendation routes, reports, project workspace summaries, and tests already depend on `Recommendation`. Replacing it in one release would create unnecessary product risk.

## 14. Human Approval Contract

Each decision record must contain:

- User ID and project role.
- Previous and next status.
- Timestamp.
- User reason or modification when provided.
- Opportunity version that was reviewed.
- Score and evidence snapshot at decision time.
- Whether the action requires a second approval.

Approval policy:

| Action class | Default policy |
| --- | --- |
| Internal analysis or draft creation | one project manager approval |
| Public content publishing | explicit approval of final asset |
| Customer email | explicit approval of recipient set and final content |
| Website update | explicit approval; preview and rollback information required |
| Advertising budget or targeting | explicit approval; second approval configurable |
| Pricing or irreversible action | always explicit; never autonomous in early phases |

## 15. Execution Bridge

The bridge translates an approved opportunity into an existing action type.

```text
Opportunity growth lever/action
  -> metadata/content/schema/page work -> Recommendation -> ContentDraft
  -> social content test             -> Campaign -> SocialDraft
  -> tracking repair                 -> manual task or setup route
  -> competitor research             -> competitor crawl/report job
  -> measurement action              -> conversion goal or integration setup
  -> later paid media action         -> guarded campaign change proposal
```

Every execution record must preserve `opportunityId`. Every publish record must preserve both the execution asset ID and `opportunityId` so measurement can close the loop.

## 16. Experiment Specification

Add a `GrowthExperiment` model for uncertain but valuable opportunities.

```js
{
  projectId: ObjectId,
  opportunityId: ObjectId,
  name: String,
  hypothesis: String,
  rationale: String,
  targetAudience: String,
  variants: [{ key, description, assetIds }],
  primaryKpi: { name, source, baseline, target, unit },
  guardrailKpis: [{ name, source, threshold, unit }],
  startAt: Date,
  endAt: Date,
  minimumSample: Number | null,
  status: 'draft|approved|running|paused|completed|cancelled',
  result: {
    observedValue: Number | null,
    delta: Number | null,
    sampleSize: Number | null,
    confidenceScore: Number,
    conclusion: 'won|lost|inconclusive|invalid',
    limitations: [String]
  },
  approvedBy: ObjectId,
  evaluatedAt: Date | null
}
```

Rules:

- Use an experiment when confidence is low or causality matters.
- Baseline and success criteria must be captured before status becomes `running`.
- Moyi must not call a result a win before minimum duration and sample requirements are met.
- External confounders and missing data produce `inconclusive` or `invalid`, not a fabricated conclusion.

## 17. Outcome Evaluation

Add a durable `GrowthOutcome` record or an equivalent append-only evaluation subdocument.

Each evaluation stores:

- Opportunity and experiment links.
- Exact KPI windows and source records.
- Baseline, observed result, delta, and sample.
- Guardrail movement.
- Correlation or causal classification.
- Outcome status.
- Confidence before and after.
- Human notes.

The current `measurementService` before/after comparison should be reused as the first evaluator. It must be generalized beyond manually published `ContentDraft` records by reading execution records linked through `opportunityId`.

Review scheduler behavior:

1. An approved opportunity captures its baseline.
2. Execution records the actual launch time.
3. A delayed job is scheduled for `reviewAt`.
4. The evaluator checks source freshness and minimum sample.
5. Moyi records `validated`, `invalidated`, or `inconclusive`.
6. The Learning Engine proposes memory changes.
7. High-impact learning changes are visible to a user and remain reversible.

## 18. Business Marketing Memory

Add a `BusinessMemoryFact` model instead of expanding `Project.brand_profile` indefinitely.

```js
{
  projectId: ObjectId,
  namespace: 'identity|product|audience|channel|content|conversion|economics|seasonality|constraint|strategy',
  key: String,
  entityKey: String,
  value: Mixed,
  unit: String,
  factType: 'declared|observed|inferred|learned',
  sourceRefs: [EvidenceReference],
  confidenceScore: Number,
  status: 'active|disputed|superseded|expired',
  validFrom: Date,
  validUntil: Date | null,
  learnedFromOpportunityId: ObjectId | null,
  learnedFromExperimentId: ObjectId | null,
  supersedesId: ObjectId | null,
  approvedBy: ObjectId | null
}
```

Memory rules:

- Declared facts come from the business and should not be overwritten by AI.
- Observed facts come from exact source data.
- Inferred facts require confidence and evidence and may expire.
- Learned facts require evaluated outcomes, not just generated recommendations.
- Conflicting facts are stored and resolved; they are not silently replaced.
- Project-specific memory is isolated by project and access role.
- Cross-customer learning is postponed until consent, anonymization, governance, and enough data exist.

Initial memory examples:

- Declared main business goal and target geography.
- Verified products and primary offer.
- Highest-converting landing page over a defined period.
- Search themes with repeated qualified conversion signals.
- Content actions that repeatedly improved the project's primary KPI.
- Experiments that failed and should not be repeated without a changed hypothesis.

## 19. Normalized Data Layer

Do not migrate current high-value collections immediately. Add adapters first.

### Existing adapters

```text
CrawlAdapter       -> Scan, Page, SeoIssue
GscAdapter         -> SearchMetric, ProjectSearchProperty
TrackerAdapter     -> TrackingEvent, ConversionGoal
CompetitorAdapter  -> Competitor, CompetitorPage, CompetitorInsight
ExecutionAdapter   -> Recommendation, ContentDraft, SocialDraft, PublishAction, Campaign
```

Each adapter returns normalized metric/evidence objects and reports:

- source connection state,
- last successful sync,
- freshness,
- data window,
- sample size,
- known limitations.

### New integrations

Add these generic records for future connectors:

`DataConnection`

- Project, provider, account type, external account ID, encrypted credentials, scopes, status, token health, consent metadata.

`DataSyncRun`

- Connection, source window, status, cursor, rows read/written, API version, rate-limit state, error summary, timestamps.

`MetricObservation`

- Project, provider, entity type/key, metric, date/time grain, value, unit, dimensions, sync run, quality and freshness.

Recommended unique index:

```text
projectId + provider + entityType + entityKey + metric + periodStart + periodEnd + dimensionsHash
```

Raw provider payloads should not become the domain API. Keep only what is required for traceability, debugging, and permitted retention.

## 20. Meta Read-Only Architecture

Meta is Phase 4, after the existing-data Growth Engine works.

### Account hierarchy

A user may have access to multiple:

- Meta Business accounts.
- Facebook Pages.
- Instagram Professional accounts.
- Ad accounts.

Moyi must let the user select which accounts belong to a project. It must not silently store only the first Page returned by Meta.

### Read-only connector responsibilities

- OAuth with least-privilege read scopes.
- Account discovery and project mapping.
- Token encryption and health checks.
- Incremental sync with cursors.
- Rate-limit handling and resumable jobs.
- API version recording.
- Normalization into `MetricObservation`.
- Source freshness and sync error display.

### Initial data domains

Organic Facebook and Instagram:

- Account and media identifiers.
- Publish time and media type.
- Reach, impressions, engagement, saves where available, profile actions, and link-related signals where available.
- Caption/topic metadata needed for project-specific comparisons.

Paid media:

- Campaign, ad set, ad, and creative hierarchy.
- Spend, impressions, reach, clicks, CTR, CPC, CPM, frequency, conversions, CPA, and reported value when the configured source provides them.
- Attribution setting and reporting window so values are not compared incorrectly.

### Explicit exclusions in read-only phase

- No `pages_manage_posts` or `instagram_content_publish` requirement for the intelligence connector.
- No campaign creation.
- No budget changes.
- No pausing.
- No automatic posting.

Existing publishing OAuth and `SocialAccount` should remain a separate execution integration. Read and write consent must be understandable and independently revocable.

### First Meta detectors

Only after normalized data has passed quality checks:

- Format performance difference with minimum comparable sample.
- Topic performance difference with a declared outcome metric.
- Engagement rising while qualified traffic or conversion falls.
- Creative fatigue based on frequency plus declining outcome rate.
- CPA improvement or deterioration with adequate conversions.
- Controlled scale candidate when CPA, volume, guardrails, and business constraints all support it.

A high-reach post without downstream business evidence remains an awareness signal, not a revenue claim.

## 21. Service Interfaces

Recommended modules:

```text
services/growth/evidenceRegistry.js
services/growth/signalDetectorRegistry.js
services/growth/signalService.js
services/growth/opportunityScoringService.js
services/growth/opportunityService.js
services/growth/approvalService.js
services/growth/executionBridgeService.js
services/growth/outcomeEvaluationService.js
services/growth/experimentService.js
services/growth/businessMemoryService.js
services/growth/adapters/crawlAdapter.js
services/growth/adapters/gscAdapter.js
services/growth/adapters/trackerAdapter.js
services/growth/adapters/competitorAdapter.js
services/growth/adapters/executionAdapter.js
```

Core interfaces:

```js
detectSignals({ projectId, source, window, now })
refreshOpportunity({ projectId, signalIds, now })
rankOpportunities({ projectId, statuses, limit })
recordDecision({ opportunityId, userId, decision, reason, modifications })
createExecution({ opportunityId, userId })
captureBaseline({ opportunityId })
evaluateOutcome({ opportunityId, now })
applyLearning({ outcomeId, userId })
```

Services receive dependencies for testing where practical. Models should not contain scoring or external API logic.

## 22. Queue And Scheduling Design

Reuse Redis and BullMQ. Add project job types or a dedicated growth queue for:

- `detect_growth_signals`
- `refresh_growth_opportunities`
- `evaluate_growth_outcome`
- `sync_meta_read`
- `expire_stale_signals`

Trigger rules:

- Completed website scan -> run crawl detectors.
- Completed GSC sync -> run GSC detectors.
- Daily tracker aggregation -> run tracking detectors.
- Completed execution -> schedule outcome evaluation.
- Completed competitor crawl -> run competitor detectors.
- Meta sync completion -> run Meta detectors later.

Operational rules:

- Every job has a stable fingerprint and idempotent handler.
- A retry must not duplicate signals, opportunities, decisions, or outcomes.
- Source API failure does not erase previous evidence; it marks freshness and sync health.
- Detector and scoring versions are stored on records.
- Worker concurrency must be configurable independently for crawl, external sync, AI, and evaluation workloads as volume grows.

## 23. Growth Opportunities Workspace

The main project experience should lead with decisions, not source dashboards.

### First viewport

- One literal business goal.
- One data-confidence/readiness statement.
- The highest-ranked opportunity.
- Why it matters.
- Evidence count and freshness.
- Opportunity score with visible components.
- Primary KPI and review period.
- Approve, modify, reject, and review-later controls.

### Supporting sections

- Top three opportunities.
- Three low-effort quick wins.
- One strategic experiment.
- One measurement blocker.
- Work awaiting approval.
- Outcomes due for review.
- Recent learning specific to this business.

Source dashboards such as scans, Search Console, analytics, competitor reports, and Meta remain available as evidence drill-downs.

### Trust requirements

- Every score opens to show its calculation.
- Every claim links to evidence.
- Missing data appears as missing, not zero.
- Stale data is visibly marked.
- Estimated impact is distinguished from measured impact.
- Correlation is distinguished from a controlled experiment.

## 24. Reporting Changes

Weekly and monthly reports should become projections of canonical growth records.

Reports should summarize:

- Business outcome and proxy KPI movement.
- New, resolved, and expired signals.
- Opportunities approved, rejected, deferred, and completed.
- Experiments started and evaluated.
- Actions that moved their KPI, moved backward, or remain inconclusive.
- Business memory changes.
- Source freshness and limitations.
- The next ranked action.

`CmoReport.metricsSnapshot` can continue storing a point-in-time report snapshot, but report prose must not become the source of truth for opportunities or learning.

## 25. Security, Privacy, And Governance

- Encrypt connector access and refresh tokens at rest using the existing encryption service.
- Request only the provider scopes needed for the selected connection.
- Record the granted scopes and consent time.
- Keep read and write integrations independently revocable.
- Enforce project role checks on evidence, opportunities, decisions, and exports.
- Never place secrets or raw tokens in job payloads, logs, views, or AI prompts.
- Minimize personal data in normalized observations.
- Do not send customer identifiers or unnecessary provider payloads to the AI model.
- Add retention policies before storing large raw social or ads payloads.
- Record high-risk decisions and executions in the existing audit log.
- Preserve human-readable limitations in every opportunity generated from incomplete attribution.

## 26. Observability And Quality Metrics

Track system health:

- Sync success rate and latency by provider.
- Evidence freshness by project and source.
- Detector runs, signals created, updated, suppressed, expired, and invalidated.
- Opportunity deduplication rate.
- Opportunity approval, modification, rejection, and deferral rates.
- Time from detection to decision.
- Time from approval to execution.
- Outcome evaluation completion and inconclusive rates.
- Confidence calibration: predicted confidence versus observed outcomes.
- AI fallback rate, parse failure rate, token cost, and model latency.
- Queue depth, retries, dead jobs, and worker availability.

These are product and reliability metrics. They must remain separate from the customer's marketing results.

## 27. Test Strategy

### Unit tests

- Each detector at threshold boundaries.
- Evidence normalization and freshness.
- Signal fingerprint stability.
- Every scoring component and formula version.
- Confidence caps.
- Metric tier selection.
- State transitions and forbidden transitions.
- Memory conflict and supersession behavior.

### Integration tests

- Completed scan creates signals and ranked opportunities without duplicates.
- GSC sync creates durable low-CTR and page-two opportunities with correct lineage.
- Approval creates the expected legacy recommendation/execution asset.
- Rejection and deferral persist decision history.
- Execution schedules evaluation.
- Evaluation creates an outcome and updates opportunity status.
- Inconclusive results do not create learned success facts.
- Meta read sync later resumes after pagination or rate limits.

### Trust tests

- No data produces no factual opportunity.
- Missing revenue source produces no revenue estimate.
- A stale source lowers confidence and is labeled.
- A vanity metric cannot outrank reliable revenue or conversion evidence solely because its raw number is larger.
- AI cannot overwrite deterministic metrics or scores.
- High-risk actions cannot execute without the correct approval.

## 28. Implementation Roadmap

### Phase 1A: Domain contracts and scoring

Deliver:

- `GrowthSignal` and `GrowthOpportunity` models.
- Evidence contract.
- Scoring service with versioned formula.
- State transition service.
- Unit tests.

Acceptance:

- A stored opportunity exposes all nine required CMO answers.
- Scores are deterministic and explainable.
- No current production flow changes yet.

### Phase 1B: Existing-data adapters and first detectors

Deliver:

- Crawl, GSC, tracker, competitor, and execution adapters.
- Initial detector catalogue.
- Idempotent detector jobs after scan and GSC sync.

Acceptance:

- Re-running the same source window creates no duplicates.
- Every signal links to exact source records and freshness.
- GSC opportunities are durable without requiring a draft.

### Phase 1C: Unified opportunity engine

Deliver:

- Signal grouping and suppression.
- Opportunity creation, deduplication, and ranking.
- Recommendation execution bridge.
- Approval audit history.

Acceptance:

- Crawl, GSC, tracking, and competitor opportunities can be ranked together.
- Approving an opportunity uses the existing content workflow.
- Reject, modify, and review-later actions work and are auditable.

### Phase 1D: Growth workspace

Deliver:

- Replace heuristic "top priorities" with ranked canonical opportunities.
- Explain score, evidence, KPI, effort, cost, risk, and review period.
- Add outcomes-due and measurement-blocker areas.

Acceptance:

- A user can identify, understand, and decide on the best next growth action from one screen.
- Missing and stale data cannot look like successful performance.

### Phase 2: Outcome and learning loop

Deliver:

- `GrowthExperiment`, outcome evaluation, and `BusinessMemoryFact`.
- Baseline capture and scheduled reviews.
- Generalize existing before/after measurement.

Acceptance:

- Moyi can prove which action was evaluated, against which KPI and window.
- Only evaluated evidence changes learned memory.
- Inconclusive evidence remains inconclusive.

### Phase 3: Business memory calibration

Deliver:

- Typed business profile facts.
- Products, segments, constraints, target KPIs, and verified channel objectives.
- Memory review and correction interface.

Acceptance:

- Two businesses with different goals and evidence receive materially different rankings.
- Users can correct disputed memory without deleting audit history.

### Phase 4: Meta read-only integration

Deliver:

- Separate read-only Meta connection.
- Multi-account selection.
- Organic and paid metric sync.
- Meta signal detectors and opportunities.

Acceptance:

- No Meta write permission is required.
- Values preserve attribution settings, windows, account hierarchy, and source freshness.
- Meta opportunities enter the same scoring and approval system as other channels.

### Phase 5: Cross-channel intelligence

Deliver:

- Identity-safe links from campaign/content touch to site session and conversion.
- Cross-channel opportunity rules.
- Channel-level outcome comparisons.

Acceptance:

- Moyi can distinguish content reach from qualified traffic and conversion.
- Claims state whether the relationship is attributed, correlated, or experimentally supported.

### Phase 6: Controlled Meta execution

Deliver only after read-only quality and approvals are proven:

- Approved post publishing.
- Campaign draft creation.
- Guarded change proposals.
- Budget and risk policy enforcement.

## 29. First Implementation Backlog

Build in this order:

1. Add scoring and evidence tests before models are connected to routes.
2. Add `GrowthSignal` and `GrowthOpportunity` schemas and indexes.
3. Implement the crawl adapter and three crawl detectors.
4. Implement the GSC adapter and migrate the two existing GSC opportunity rules.
5. Run detectors after completed scans and GSC syncs.
6. Build opportunity grouping, deduplication, and ranking.
7. Add approval decisions and the `Recommendation` bridge.
8. Replace project workspace priority heuristics with ranked opportunities.
9. Add baseline capture and scheduled outcome evaluation.
10. Add experiments and business memory.

## 30. Definition Of Done For The First Growth Engine Release

The first release is complete when:

- Website crawl, GSC, and first-party tracking data can produce versioned signals.
- Signals are separate from opportunities and actions.
- Opportunities are durable, deduplicated, cross-channel, and transparently scored.
- Each opportunity includes observation, evidence, business relevance, action, expected impact mode, confidence, effort, cost, risk, KPI, and review period.
- The user can approve, modify, reject, or defer an opportunity.
- Approved opportunities enter existing execution workflows.
- Executed opportunities capture a baseline and receive a scheduled outcome review.
- Missing data and unavailable revenue are stated honestly.
- The main workspace shows the best next growth action rather than a list of disconnected tools.
- All new state transitions, scores, detectors, and trust rules have automated tests.

## 31. Final Architecture Position

Moyi's competitive advantage should not be an AI prompt or the number of integrations.

It should be the durable project-specific chain:

```text
Verified evidence
  -> meaningful signal
  -> ranked opportunity
  -> human decision
  -> controlled execution
  -> measured outcome
  -> business-specific learning
```

That chain is the product. Integrations supply evidence and execution capability, but Moyi must own the intelligence, governance, and learning.
