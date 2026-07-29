# Moyi CMO Alignment Direction

## North Star

Moyi should behave like an excellent SMB growth CMO:

- Understand the company's offer, audience, and market context.
- Diagnose what is blocking growth right now.
- Prioritize the smallest set of actions most likely to create pipeline, revenue, or qualified demand.
- Turn those actions into reviewed execution assets.
- Measure what changed and explain what to do next.

If a feature does not strengthen that loop, it should not be a priority.

## What Moyi Should Be

Moyi should become a **marketing decision engine** with light execution support.

The core product loop should be:

1. Discover the business:
   Capture the company's positioning, audience, offer, proof, and likely competitors.
2. Audit the growth system:
   Crawl the website, inspect search visibility, review tracking quality, and identify conversion friction.
3. Prioritize growth moves:
   Produce a ranked weekly plan tied to impact, confidence, and effort.
4. Generate execution briefs:
   Draft content, messaging, metadata, or page improvements for human review.
5. Measure outcomes:
   Report what changed in visibility, traffic quality, conversions, and revenue-linked signals.

## What Moyi Should Stop Trying To Be Right Now

These areas are diluting the product and should be deprioritized until the core loop is excellent:

- Broad social media planning as a major product pillar.
- Calendar-heavy workflow features that do not improve decision quality.
- Multiple CMS integrations beyond the minimum needed for approved publishing.
- Fake or inferred revenue attribution without a real source of truth.
- Competitive intelligence that depends on brittle scraping and weak confidence.
- Feature sprawl that turns the project page into a dumping ground.

## Product Principles

### 1. Trust First

Moyi must never invent revenue, conversions, competitive facts, or performance outcomes.

Rules:

- If data is missing, say it is missing.
- If attribution is incomplete, expose readiness instead of fake confidence.
- If AI does not have enough evidence, fall back to a narrower recommendation.

### 2. CMO Thinking, Not Feature Theater

Every major screen should answer one of these executive questions:

- What is blocking growth?
- What should we do this week?
- Why does it matter?
- How confident are we?
- What changed after we acted?

If a screen cannot answer one of those questions, it is likely not core.

### 3. Fewer, Better Actions

A good CMO does not give 50 ideas. Moyi should usually surface:

- 3 top priorities
- 3 quick wins
- 1 strategic bet
- 1 measurement warning

### 4. Evidence Over Hype

Recommendations should always be attached to:

- observed page issues
- GSC evidence
- tracking gaps
- conversion friction
- competitor comparisons with explicit confidence levels

## What To Double Down On

These are the strongest foundations already in the app:

- Website scan and audit pipeline
- Search Console sync and opportunity detection
- Approval-based draft generation
- Project calibration and brand profile discovery
- Weekly/monthly reporting pattern
- Usage gating and SaaS structure

## The Next Build Sequence

### Phase 1: Trust Reset

Goal: remove every feature behavior that can mislead users.

- Keep attribution factual and show readiness when revenue data is not connected.
- Fail fast on unsafe production configuration.
- Mark speculative competitor insights with confidence and evidence.
- Remove demo-like behaviors from live routes and dashboards.

### Phase 2: CMO Workspace

Goal: turn the project overview into a clear executive command center.

The project home should show:

- Growth scorecard
- Top 3 priorities
- This week's plan
- Open execution items
- Measurement gaps
- Latest business risks

This should replace the current feeling of many disconnected feature links.

### Phase 3: Decision Engine

Goal: make Moyi feel like a real strategic operator.

Build a prioritization layer that scores opportunities by:

- impact
- confidence
- effort
- time to value
- dependency risk

Output should be a weekly action brief, not just raw recommendations.

### Phase 4: Closed-Loop Measurement

Goal: prove whether recommendations worked.

Add real linkage between:

- content actions
- GSC changes
- tracking conversions
- revenue events when available

Until revenue data is real, keep language at the conversion and pipeline level.

## Architecture Direction

The code should gradually move toward these modules:

- `domain/discovery`
- `domain/audit`
- `domain/prioritization`
- `domain/execution`
- `domain/measurement`
- `integrations/search-console`
- `integrations/publishing`
- `workspaces/project-overview`

The biggest immediate refactor target is `routes/projects.js`, which currently mixes too many product concerns.

## Success Criteria

Moyi is aligned as a CMO product when a user can:

1. connect a site and understand their business context quickly
2. see the 3 highest-value growth actions for the week
3. generate reviewed execution assets from those actions
4. measure whether visibility, traffic quality, and conversions improved
5. trust that every metric and claim in the app is real

## Immediate Rule For New Features

Before adding any new feature, ask:

- Does this improve diagnosis?
- Does this improve prioritization?
- Does this improve execution quality?
- Does this improve measurement credibility?

If the answer is no to all four, the feature should wait.
