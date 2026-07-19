# AI CMO — Spec-Compliant Architecture (v0.1)

**AI-CMO SPEC COMPLIANCE:**  
This architecture primarily advances:
- Requirement 1 (System Ownership): Central "Marketing Brain" owns the living plan, prioritization, and consistency.
- Requirement 2 (Low-Friction, High-Context Input): Context Engine + Memory + Connectors.
- Requirement 3 (End-to-End Orchestration with Auditability): Orchestrator + Decision Log + Action Executor.
- Requirement 4 (Revenue-Linked Measurement): Attribution Core + Outcome Tracker + Optimizer.
- Requirement 5 (Economics): Designed for thin absolute budgets; pricing layer supports low base + performance.
- Requirement 6 (Continuity): Persistent Memory + Learning Loop is foundational.
- Requirement 7 (Scope & Boundaries): Every component has explicit autonomy levels and escalation rules.

All components were designed by first reading the full REQUIREMENTS.md and mapping back to the 7 non-negotiables and the failure modes (no living plan, vanity metrics, high coordination tax, shallow integrations, black box, memory loss, unaffordable cost, over-claim).

**Honest Limitations Acknowledged in This Design:**
- Depends on reasonable data hygiene in target SMEs (will have onboarding/calibration wizard + graceful degradation).
- Will not magically fix broken offers or delivery.
- Attribution will be "good enough" for the segment with explicit confidence bands and limitations surfaced (no over-claiming multi-touch perfection).
- High-trust B2B relationship sales will have clear "human owns the relationship" boundaries.
- Initial versions scoped to 2-3 channels + core loop for one or two verticals (B2B services and/or DTC ecom as recommended).

## High-Level System Overview

The AI CMO is a **persistent, stateful, revenue-accountable autonomous agent system** (with progressive human oversight) that owns marketing as a closed business function for an SME.

Core metaphor (internal only, not marketed this way): "The always-on junior-to-mid CMO who never forgets context, always measures to the P&L, and only bothers the founder for the decisions that matter."

### Major Subsystems (Mapped to Requirements)

1. **Marketing Brain / Living Plan Engine** (Req 1 primary)
   - Maintains the current "Marketing Strategy State": goals (revenue targets, CAC targets, payback windows, cash constraints), channel mix policy, positioning/messaging hierarchy, offer architecture, experiment backlog with kill/scale criteria, calendar/sequencing.
   - Evolves the plan based on new owner input + performance data + external signals.
   - Produces the "weekly" (or event-driven) plan diff that the Orchestrator executes against.
   - Enforces consistency rules (messaging, brand voice, offer) across all generated artifacts.

2. **Context & Memory Layer** (Req 2 + 6 primary)
   - **Auto-Heavy-Lifting Diagnostic & Discovery Engine** (core to Requirement 2): The application must do the heavy work. It proactively gathers and diagnoses as much as possible instead of asking the customer to provide it manually.

     Capabilities include:
     - Website + public web scanning and analysis of the client's own presence.
     - Automated competitor discovery and diagnosis (see dedicated section below).
     - Inference of ICP, objections, value propositions, and brand voice from public signals + first-party data.
     - Reconciliation of first-party data (ads + CRM + revenue) to derive real unit economics, performance baselines, and constraints.
     - Continuous background re-scanning and diagnosis (with user notification on material changes).

     Principle: **Auto-gather and diagnose first. Present for lightweight review/edit/voice correction second.** Never default to long forms or manual lists for things the system can reasonably discover or infer.
   - **Business Model Memory**: Structured + vector + graph representation of:
     - Unit economics (CAC targets, LTV, margins, payback tolerance) — primarily derived from connected revenue + ad + CRM data, with user overrides.
     - ICP evolution and segments — initially auto-inferred from site language, reviews, and competitor analysis; refined by user voice corrections over time.
     - Core objections, proof points, customer stories — auto-extracted where possible from public reviews, support signals, and site content + owner voice notes.
     - Seasonality, constraints (budget, team capacity, legal) — auto-detected from data patterns where possible.
     - Competitive positioning deltas — auto-generated from competitor scans and diagnosis (see below).
   - **Owner Input Ingestion**: Voice note transcription + structured short updates. Low-friction (WhatsApp/Slack/email/voice upload). Immediate embedding + structured extraction into Memory.
   - **Persistent History**: Every decision, result, owner note, and performance observation is stored with timestamps and links for compounding learning.
   - **Reconciliation Engine**: Pulls raw data, normalizes, resolves conflicts, maintains "source of truth" views for the Brain.

3. **Data Connectors & Reconciliation** (Req 2 + 4 foundation)
   - Deep, reliable, event-driven or scheduled connectors (preferred over batch CSV):
     - Ad platforms: Meta, Google Ads (spend, impressions, clicks, conversions, ROAS where available)
     - Analytics: GA4 / server-side or equivalent (sessions, conversions, attribution hints)
     - CRM / Opportunities: HubSpot, Pipedrive, Zoho, Salesforce (or common open), pipeline stage movement, closed revenue, source tagging
     - Email / SMS / Marketing automation platforms
     - Revenue / Accounting signals (Stripe, basic accounting exports or API for actual cash)
     - Customer feedback (reviews, support tickets, NPS where available)
   - Idempotent sync + quality scoring. Bad data surfaces as "confidence penalty" rather than silent failure.
   - Initial MVP connectors prioritized for the pilot vertical(s).

4. **Attribution & Outcome Engine** (Req 4 — the heart)
   - Multi-model attribution: last-touch + data-driven (where volume allows) + declared UTM + CRM opportunity source + holdout/incrementality hooks.
   - Explicitly models and surfaces limitations (e.g. "offline-influenced revenue not captured", "brand lift not measured here").
   - Primary computed objects:
     - Channel / campaign / creative level: pipeline created, revenue attributed (with confidence), CAC, payback.
     - Experiment results with statistical notes.
   - Waste detector: flags high-spend/low-outcome activity with concrete "recommend cut X or reallocate to Y" proposals.
   - Feeds the Optimizer and the Brain's plan evolution.

5. **Orchestrator + Action Executor** (Req 3 primary)
   - Consumes the current Living Plan + latest performance + new context.
   - Produces a prioritized action queue for the period (content calendar, ad campaign briefs + budgets + targeting + creative direction, email sequences, landing page tests, etc.).
   - **Briefs** high-quality instructions (including current positioning, voice, offer, success criteria, constraints) to generators or external tools.
   - **Generation / Direction layer**: Can call internal LLMs, fine-tunes, or approved external tools (with brand voice guardrails enforced by the Brain).
   - Deploys or prepares for one-click human deploy (for ads, posts, emails, pages).
   - Monitors live performance against the plan's criteria.
   - Reallocates (budget moves, pause/scale campaigns, creative refresh) within pre-approved bounds; larger moves go to human escalation.
   - **Decision Log / Audit Trail**: Every significant action and reallocation produces a human-readable, queryable record: "Why", data snapshot at decision time, expected vs actual outcome later linked.

6. **Human Interface & Escalation Layer** (Req 3 + 7)
   - **Founder / Owner View**: 
     - "What's happening" summary (plan status, key wins/losses, money moved, next 3 decisions).
     - Low-friction input (voice + quick text).
     - Review/approve queue for flagged items.
     - "Why did we do X?" explorer (full audit).
   - **Escalation Rules** (configurable per business but with strong defaults):
     - Always escalate: brand repositioning, >20-30% budget shift in a period, new channel launch, high legal/compliance risk creative, anything outside policy bounds.
     - Default to human review for first N executions of a new pattern.
   - **Override & Rollback**: Easy one-click or voice "stop that / do the opposite".
   - **Reporting**: Revenue-linked dashboards first. Vanity available on demand but de-emphasized.

7. **Optimizer / Learning Loop** (Req 1 + 4 + 6)
   - Uses attribution outcomes + owner feedback + Memory to propose plan updates to the Brain.
   - Runs lightweight experiments (creative variants, budget micro-allocations, channel tests) within guardrails.
   - Updates Memory (e.g. "this objection angle converted 1.8x better in segment B").
   - Feeds the continuity and rapid adaptation.

8. **Pricing & Value Delivery Layer** (Req 5)
   - (Later) Usage / outcome instrumentation to support low-base + share-of-savings or share-of-uplift pricing.
   - Internal cost accounting so the product itself demonstrates the economics it sells (reduces total marketing cost for the customer).

## Data Flow (Simplified Happy Path — Daily/Continuous)

Owner voice note or business event → Context Ingestion → Memory Update → Brain re-evaluates Living Plan (or incremental diff) → Orchestrator builds action queue → Generation/Briefs → (Human review if flagged) → Deploy/Execute → Live monitoring + Attribution collection → Outcome recorded in Memory + Decision Log updated with actuals → Optimizer proposes adjustments → Brain incorporates → repeat.

All steps produce auditable events.

## Core Design Principle: The Application Does the Heavy Work (Req 2 Enforcement)

This is non-negotiable and directly derived from the research: owners are time-poor (56% have ≤1 hour/day for marketing) and already suffer high coordination tax from tools and agencies. The AI CMO must own the research, scanning, diagnosis, and synthesis work.

**Universal Pattern for All Contextual Data:**
1. The system **auto-gathers and auto-diagnoses** using available signals (connected platforms + public web scanning + inference).
2. It presents a synthesized view with clear provenance ("This competitor was found via Meta Ad Library + their website + reviews mentioning them alongside you").
3. The owner provides **lightweight correction** only (voice note is preferred: "remove CompetitorX — they're not in our space", "our real ICP is X not Y", or simple UI edits).
4. The system incorporates the correction into Memory and improves future scans/diagnoses.

Manual entry forms for competitors, ICP, positioning, objections, or economics are considered a failure mode and must be minimized or eliminated.

## MVP Scope (Ruthless — Per Recommendations)

**Verticals (start with 1, add second after validation):**
- B2B services / professional services ($1M–$8M revenue typical)
- Optional early: DTC e-commerce with paid social/search

**Channels (exactly 2-3 for MVP):**
- Google Search + Performance Max (or equivalent)
- Meta/Instagram paid + organic
- Email (owned list nurture + acquisition)

**Core Features for First Pilot-Ready Version:**
- Onboarding Diagnostic & Auto-Heavy-Lifting Calibration: Extremely low-friction setup. The customer provides only their website URL (or business name + niche) + connects their primary ad platforms, CRM, and revenue sources via OAuth. 

  The system does the heavy work:
  - Crawls and deeply analyzes the client's own website for current positioning, value propositions, brand voice signals, features, and customer language.
  - Automatically discovers and diagnoses competitors (via public web search, SERP signals, Meta Ad Library scanning for similar advertisers, review sites, industry directories, and cross-referencing with the client's own site).
  - Extracts and infers ICP characteristics, common objections, and messaging patterns from the client's site + competitor data + public reviews.
  - Pulls first-party performance data from connected platforms to compute (or estimate with confidence bands) real historical CAC, LTV, payback, and channel performance.
  - Builds initial "Business Model Memory" draft including unit economics targets, constraints, seasonality signals, and competitive positioning deltas.

  All auto-discovered and auto-diagnosed information is presented in a clean "Review & Edit" dashboard (or voice-driven correction flow). The founder is **not asked to enter** lists of competitors, ICP descriptions, current positioning, or economics from scratch. They only correct, confirm, or add nuance to what the app has already gathered and diagnosed. Voice notes are the preferred way to provide corrections ("that competitor isn't relevant — our real competitors are X and Y because...").

  The goal is that the heavy diagnostic and research work is done by the application, not the time-poor customer. Manual entry is the exception and last resort.
- Persistent Memory + Context Engine (voice + connectors).
- Living Plan representation (simple at first: goals + channel priorities + positioning statements + current experiments).
- Basic Orchestration: Weekly plan generation, ad creative briefs + variations, email content, posting guidance.
- Attribution Core: At minimum solid UTM + CRM source + ad platform reported conversions + declared pipeline/revenue linking. Confidence scores. Waste flagging.
- Decision Audit: Every reallocation or major creative change has a log entry.
- Founder Dashboard: "Current plan", "Money & results this period", "Review queue", "Quick voice input".
- Escalation: Clear "needs your input" items with one-click actions.
- Kill/Scale: At least one automated or semi-automated rule (e.g. pause campaign if payback > X after Y spend with low confidence).

**Explicitly Out of MVP Scope (to avoid violating ruthless scoping and over-claim):**
- Full social organic management for 5+ platforms.
- Advanced video generation or high-production creative.
- Enterprise ABM or long sales cycle B2B with heavy offline attribution.
- "Full autonomous replacement" marketing — heavy marketing language will be avoided.

**Competitor Intelligence & Diagnosis Module (High Priority for Heavy Lifting)**

The app must automatically discover and diagnose competitors instead of asking the user to list them.

How it works (auto-first):
- Input seed: Client website URL (or business name + industry/niche).
- Discovery methods:
  - Analyze client's own site for implied competitive set (mentions, comparisons, "alternative to" language).
  - Public web research / SERP-style queries for "competitors to [business/niche]".
  - Scan public ad libraries (Meta Ad Library, Google Ads transparency) for advertisers running similar creative or targeting similar keywords/audiences.
  - Review and directory sites (G2, Capterra, Trustpilot, Google reviews) — extract companies frequently mentioned in the same context.
  - Cross-reference with first-party signals (if customers mention alternatives in reviews, support tickets, or lost deal reasons when available).
- Diagnosis (the "heavy work"):
  - Scrape and summarize each competitor's positioning, value props, pricing signals (if public), target language, and ad creative patterns.
  - Identify differentiation opportunities, common messaging in the category, and potential weaknesses/gaps.
  - Track ad creative evolution and spend signals where possible (public data).
  - Maintain "Competitive Positioning Map" in Memory (how the client currently stacks up vs. discovered set).
- Output: Structured Competitor Profiles + synthesized diagnosis report + recommended positioning angles or gaps to exploit.
- Ongoing: Periodic re-scans (e.g., new ad creatives, pricing changes, new entrants). Material changes surface for user review.
- User control: Easy removal of false positives, addition of "stealth" competitors the system missed, and voice corrections that update the model permanently ("X is our main threat because they target the exact same ICP with lower price").

This directly reduces the manual research burden that owners currently carry or outsource expensively to agencies.

All competitor data carries provenance and confidence so the Brain and user can treat it appropriately.

## Technology Considerations (High Level — Subject to Later Detailed Design Under the Skill)

- Backend: Language/runtime that supports good async, strong typing for the attribution and memory logic (Python/FastAPI or TypeScript/Node or Go — decided later with data).
- LLM layer: Mix of strong models for reasoning (plan, prioritization, brief quality) + cheaper/faster for generation. Guardrails and output validation against the current Memory/positioning.
- Memory store: Combination of relational (structured economics, decisions, performance facts) + vector (semantic search over notes, stories, past results) + possibly lightweight graph for relationships (ICP → objections → proof).
- Connectors: Prefer official APIs + webhooks. Robust retry, rate limit handling, and data quality scoring. Start with the 3-4 most common for the pilot vertical.
- Audit / Logs: Immutable event log or append-only with query capability. Exportable for the customer.
- Deployment: SaaS multi-tenant with strong per-customer isolation. Self-host option considered later for compliance-heavy verticals.
- Human interface: Web app + email digests + preferably lightweight integrations (Slack, WhatsApp, email) for input and alerts.

**Critical Non-Functional (tied to requirements):**
- Transparency and explainability must be excellent (Req 3).
- Data privacy and consent management strong from day one (limitations + compliance).
- Graceful degradation when connectors are missing or data is poor.
- Low latency for owner input processing; background for heavy analysis.

## Phased Roadmap Sketch (High Level)

**Phase 0 — Foundations (under this spec)**
- Full requirements, architecture, data models, pilot success criteria locked.
- Core Memory + Context ingestion (voice + 1-2 connectors).
- Minimal Attribution engine that can link ad spend → CRM opportunity → revenue with confidence.
- Living Plan data model + simple Brain.
- Basic Orchestrator stub + decision logging.
- Onboarding flow + Auto-Discovery Engine for 2 pilot customers (heavy emphasis on the system doing competitor scanning, context extraction, and initial diagnosis so the customer only edits).

**Phase 1 — First Closed Loop (Pilot)**
- End-to-end for the 2-3 channels in one vertical.
- Generation of briefs + basic creative variants.
- Weekly (or continuous) plan → actions → monitoring → reallocation within bounds.
- Founder dashboard with audit explorer.
- 3-5 real SME pilots with hard metric tracking (time saved, waste cut, pipeline/revenue attribution, confidence).

**Phase 2 — Progressive Autonomy + Polish**
- Expand autonomous execution in proven areas.
- Better Optimizer + experiment framework.
- Additional vertical or channels.
- Pricing model experiments with pilot customers.
- Stronger consistency enforcement and voice learning.

**Phase 3+**
- Scale connectors, more verticals, advanced attribution (incrementality tests), multi-user (team) support, etc.
- Only after Phase 1 pilots prove the core loop reduces the actual documented pains.

## Next Immediate Work Items (Prioritized by Spec Leverage)

1. Detailed data models for Memory, Decision Log, Living Plan, and Attribution facts (directly enables 2, 3, 4, 6).
2. Connector abstraction + first two deep connectors (Meta + a CRM) + reconciliation logic.
3. Attribution engine core (the make-or-break for Req 4).
4. Voice input ingestion + extraction to structured Memory updates.
5. Minimal Brain + Plan representation + basic Orchestrator that can produce an auditable action set.
6. Pilot customer success measurement framework (instrumented from the start).

All of the above will be done under active /ai-cmo discipline.

---

This architecture exists to ensure we do not build "another AI marketing tool." It exists to build the system that actually unloads CMO-level ownership for SMEs at a price and effort level that finally makes the math work.

Any deviation must be called out and justified against the REQUIREMENTS.md before implementation.