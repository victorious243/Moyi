# Phase 6: Experimentation and Optimization

Moyi experiments connect recommendations to real tracker, social, or paid-media
records. The engine does not create synthetic traffic, conversions, or winners.

## Decision flow

`detect -> recommend -> test -> measure -> learn -> apply`

Every experiment has one control, one or more variants, a primary metric,
minimum sample per variant, minimum duration, and required confidence. A winner
must clear every gate. A test that reaches its end date without clearing the
gates becomes inconclusive.

## Supported types

- Social caption, CTA, hook, creative, and posting time
- Email subject and landing page
- Campaign audience and paid creative
- Offer and messaging angle
- Custom future experiment types through the shared model and service boundary

## Measurement sources

### First-party tracker

Add assignment parameters to each destination URL:

```text
?moyi_experiment=EXPERIMENT_ID&moyi_variant=control
?moyi_experiment=EXPERIMENT_ID&moyi_variant=variant_b
```

`moyi-tracker.js` keeps the assignment in local storage and attaches it to page,
custom, and conversion events. Use real events such as:

```js
window.moyiTrack('custom', 'form_start');
window.moyiTrack('conversion', 'form_submit', {
  funnelStage: 'qualified_lead'
});
```

### Social performance

Bind each variant to its actual `PublishJob` identifiers. Moyi reads the latest
provider engagement snapshot for each bound post and never counts multiple
snapshots of the same post as separate samples.

### Paid performance

Bind each variant to normalized paid entity identifiers. Moyi reads daily
`PaidMetricSnapshot` records. Rate metrics use their real numerator and
denominator; continuous metrics use observed daily values and variance.

Draft and paused experiments expose a measurement configuration editor. Social
and paid experiments cannot start until every variant has at least one bound
source record. Changing evidence bindings clears prior observations so records
from different measurement definitions are never combined.

## Statistical rules

- Rate metrics use a two-proportion z comparison.
- Continuous metrics use observed means, sample variance, and standard error.
- Confidence alone is insufficient: sample and duration gates must also pass.
- Zero or missing measurements remain zero-sample or unavailable evidence.
- Multi-variant tests compare every variant with the declared control.
- Moyi does not perform irreversible website or campaign changes.

## CRO signals

Signals are calculated from tracker records only and require minimum traffic:

- High traffic with low conversion
- Landing-page underperformance
- Form abandonment
- CTA underperformance
- Mobile conversion gap
- Checkout drop-off
- Week-over-week website conversion decline

## Project learning

A supported winner creates one `ExperimentLearning` record containing the
hypothesis, result, confidence, decision, metric, channel, and evidence. Active
learnings are copied into the project's rolling Growth Brain baseline. An
inconclusive experiment does not create a learning.

Running experiments are reevaluated by the existing social-maintenance worker
cadence and can also be refreshed manually from the experiment detail page.
Each refresh replaces the cumulative source observation instead of adding it,
which prevents repeated snapshots from inflating the sample.

## Migration and verification

```bash
npm run migrate:experimentation
node --test tests/experimentation_engine.test.js
npm test
npm run typecheck
```

## Current limitations

- Moyi records assignments but does not modify website templates to split
  traffic automatically. The customer's testing layer controls allocation.
- Email tests require real open, click, or conversion events through the tracker
  or a future email-provider adapter.
- Social tests compare separately published posts and can still be affected by
  audience and timing differences.
- Statistical confidence is not a guarantee of causality. Stable allocation and
  clean instrumentation remain necessary.
