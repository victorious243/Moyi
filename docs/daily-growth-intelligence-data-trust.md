# Daily Growth Intelligence Data Trust

Daily Growth Intelligence (DGI) follows this pipeline:

```text
provider APIs + Moyi tracker
  -> provider sync runs
  -> normalized metric observations
  -> daily snapshots
  -> data quality gate
  -> comparable baselines
  -> diagnoses and recommendations
  -> executive brief
```

## Metric states

Unknown is not zero. A metric is displayed as `0` only when a provider or the first-party tracker successfully measured the window and returned zero.

Supported states are `verified`, `pending`, `not_connected`, `unsupported`, `permission_denied`, `stale`, `provider_error`, and `not_applicable`. Every normalized observation stores its source, provider-native metric name, entity, reporting window, observed/fetched time, freshness, and sync run identifier.

## Collection and reconciliation

The `marketing-analytics` BullMQ queue runs `collect-provider-analytics` every five minutes. Fresh posts are checked frequently, then progressively less often through T+90 days. Every attempt creates a `ProviderSyncRun`; successful counters create append-only `MetricObservation` and `EngagementSnapshot` records. `DailySocialSnapshot` is reconciled from the newest successful post snapshots.

Provider failures remain failures. They do not create zero counters. Token and scope failures appear in Data Health and use the existing reconnect flow.

## Scoring and confidence

Growth Score and Data Confidence are separate:

- A Growth Score requires fresh verified metrics, at least seven prior verified baseline days, and at least three comparable scoring dimensions.
- Data Confidence reflects metric coverage and freshness. A low confidence report can still show individual verified facts, but cannot assign unsupported champions or performance recommendations.
- A new project displays `Building baseline`; a project without verified evidence displays `Not scored`.

Content patterns require at least three comparable measured posts. Samples of three or four are labelled emerging signals; stronger labels require larger samples. Every optimization opportunity stores evidence, evidence IDs, a hypothesis, an expected outcome, and a measurement plan.

## Attribution

Generated social links include UTMs plus `moyi_post_id` and `moyi_content_id`. `tracker.js` retains these identifiers with the project, session, visitor, landing page, referrer, click IDs, funnel stage, conversion value, and currency. Revenue remains `null` until a purchase/revenue goal is configured and the reporting window is measured.

## Production migration

After deploying the code, run:

```bash
npm run migrate:dgi-data-quality
```

The migration marks existing unversioned reports as legacy, creates the new indexes, and lets legacy reports regenerate on first read. Then restart both the web and worker processes.

## Provider limitations

Metric availability still depends on each provider's API product and granted scopes. Personal LinkedIn analytics, some Meta insights, X metrics, TikTok research/insight fields, and account-level audience counters may be unavailable without provider approval or paid access. Moyi records these as unsupported, permission denied, or pending instead of fabricating values.

The DGI page reads database snapshots and does not call every provider during ordinary page rendering. Manual refresh and the daily scheduler collect due evidence before generating a new report.
