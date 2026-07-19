# AI CMO — Phased Implementation Roadmap (Spec-Compliant)

**AI-CMO SPEC COMPLIANCE:** This roadmap is derived by mapping the 7 requirements + "anchor on integration + attribution first + ruthless scope + hard pilot metrics + progressive autonomy" recommendations directly from REQUIREMENTS.md.

Goal: Deliver a system that demonstrably reduces the documented SME pain (no living plan, 40-60% waste, high coordination tax, low confidence, expensive failed experiments with agencies/fractionals) for real businesses spending small absolute marketing dollars.

## Phase 0: Foundations & Core Loop Skeleton (Do Not Skip or Parallelize Heavily)

Duration target: Short and focused. Everything here is prerequisite for any credible pilot.

Key Deliverables (each mapped to requirements):
- Complete, reviewed data models for:
  - Business Context Memory (Req 2, 6)
  - Living Marketing Plan + constraints/goals (Req 1)
  - Decision / Audit Events (Req 3)
  - Attribution Facts + Outcome Records (Req 4)
- Connector framework + first 2-3 production-quality connectors (ads + CRM + basic analytics/revenue) with quality scoring and reconciliation (Req 2).
- Attribution engine MVP that can credibly link spend → opportunity/revenue with confidence bands and explicit limitations surfaced (Req 4 — this is the highest leverage single piece).
- Voice / low-friction input pipeline that updates Memory (Req 2).
- Minimal but real "Brain": can ingest updated Memory + performance, produce a diff to a previous plan, with rationale.
- Orchestrator stub + Action representation that can output an auditable set of proposed actions (briefs) for the chosen MVP channels.
- Decision logging for every material output.
- Onboarding Auto-Discovery & Calibration: Setup crawls the client's website, auto-discovers competitors, active ads, positioning and customer personas, and displays them on a "Verify & Edit" dashboard to prevent manual entry fatigue.
- Pilot instrumentation: the exact metrics we will track (owner time on marketing, attributed pipeline/revenue movement, spend waste indicators, input events per week, founder confidence proxy, etc.).

Success Gate to Phase 1:
- We can take a real (or very realistic synthetic) SME's connected accounts + a few voice notes, produce a coherent current-state assessment, a proposed short plan, and an auditable set of actions.
- Attribution can answer "what pipeline/revenue do we think this channel created last 30 days?" with numbers + caveats that a founder would find usable.
- All of the above is reviewable and explainable per the spec.

## Phase 1: First Closed Loop + Real SME Pilots (The Make-or-Break)

Scope (ruthless):
- 1 primary vertical (e.g. B2B services / agencies / consultants $1-8M revenue).
- 2-3 channels max (Google paid + Meta paid + email as the owned channel).
- Full loop: Plan → Brief/Generate/Prepare → (human review where required) → Execute/Monitor → Attribute Outcomes → Reallocate or Kill → Update Memory + Plan → repeat.
- Founder experience: voice input, daily/weekly summary of "what moved and why", review queue, "explain this decision" , easy overrides.

Activities:
- Recruit 3-6 real pilot SMEs (pay them in discounted or free access + direct support; their time and data are gold).
- Instrument everything for the hard metrics.
- Run the loop for 6-12 weeks per pilot.
- Weekly internal reviews against the validation questions:
  - Did owner marketing coordination time drop measurably?
  - Did we cut or reallocate away from clear waste?
  - Did we produce attributable positive movement in pipeline or closed revenue that the founder trusts more than before?
  - Was positioning/message reasonably consistent without founder rewriting everything?
  - Was daily/weekly input burden low (target: owner spends <15-20 min/week on "steering" after onboarding)?
  - Did the system actually make kill/scale decisions with data?

Pricing experiments:
- During pilots, test value-based or low-fixed + performance share models with the pilot customers. Collect willingness-to-pay and ROI perception data.

Success Gate to Phase 2:
- At least 2-3 pilots show clear positive movement on at least 3 of the primary hard metrics (time saved, waste reduced, revenue/pipeline attribution that changes behavior, founder would pay real money to continue).
- The system is observably acting as "system ownership" rather than "helpful content tool".
- No major spec violations discovered in practice (or they are fixed before scaling).

## Phase 2: Progressive Autonomy, More Verticals/Channels, Stronger Economics

- Expand the set of actions the system can take with lower human review (after proving patterns in Phase 1).
- Add 1-2 more verticals or channel types (only after the core loop is solid).
- Improve attribution (more models, better incrementality hooks, better handling of offline-influenced revenue where possible).
- Production-grade consistency enforcement (voice, offer, positioning) across generated artifacts.
- Founder/team collaboration features (multiple voices, approval workflows).
- Pricing model finalized and rolled out based on pilot data (goal: positive ROI even for customers whose total prior marketing spend was low).
- Self-serve onboarding improvements + better calibration experience (directly addresses the "initial setup effort is real" limitation).
- Public case studies with real numbers (time saved, waste cut, revenue impact) — only where the data genuinely supports the claim.

## Phase 3+: Scale, Advanced Capabilities, Defensibility

Only after Phase 1+2 prove the thesis:
- More connectors and deeper platform integrations.
- Advanced experiment framework (true holdouts, multi-armed bandit style within guardrails).
- Sophisticated memory (long-term customer story graph, competitive move tracking).
- Team + agency partner modes (with clear boundaries so it doesn't become "another tool agencies use to serve more clients badly").
- Compliance / vertical-specific modules (with human oversight baked in where required).
- Potential self-hosted or private instance options for sensitive data.
- Continuous learning from aggregate (anonymized) patterns across the customer base while preserving per-customer privacy and data ownership.

## Cross-Cutting Workstreams (Run Throughout)

- **Transparency & Trust**: Decision logs, "why" explorer, confidence visualization, easy overrides. This is a product feature, not a nice-to-have.
- **Measurement & Validation Discipline**: The pilot measurement framework becomes the permanent telemetry + customer dashboard capability. We eat our own dogfood on revenue-linked results.
- **Pricing & Packaging R&D**: Continuous small experiments. Never default to "high fixed retainer that recreates the problem".
- **Limitations & Marketing Honesty**: Every public claim, onboarding screen, and limitation disclosure is reviewed against the "Honest Limitations" section.
- **Anti-Regressions**: Any time we add generation power or autonomy, we add corresponding tests/guardrails for consistency, auditability, and owner time burden.

## Risk Mitigation (Tied to Known Failure Modes)

- Risk: We build another fragmented point tool.  
  Mitigation: Ruthless scoping + mandatory "does this advance system ownership and the closed revenue loop?" test for every feature.

- Risk: Attribution is too weak or misleading, eroding trust.  
  Mitigation: Explicit limitations always shown. Start conservative. Pilot customers see raw data alongside modeled numbers.

- Risk: Onboarding and data quality is too painful; users churn before seeing value.  
  Mitigation: Phase 0 invests heavily in connectors and reconciliation + guided voice seeding. Calibration is a first-class product experience.

- Risk: We over-claim autonomy and customers feel burned.  
  Mitigation: Explicit boundaries in product, progressive autonomy, clear "this still needs you" signals.

- Risk: Economics don't work for the actual target customer.  
  Mitigation: Pricing experiments with real low-spend SMEs from the beginning. Total cost of ownership (their old way vs new) is a tracked pilot metric.

## How to Work on This Roadmap

Use the /ai-cmo skill for every piece of work.

Before starting a new phase or major component:
- Re-read REQUIREMENTS.md.
- Update this roadmap and ARCHITECTURE.md with the explicit mapping.
- Define the validation criteria for that slice before writing code.

This is not a typical "build fast and iterate on marketing claims" project. It is a deliberate attempt to solve a durable, expensive, well-documented problem for a segment that has been repeatedly disappointed. The discipline in this document and the ai-cmo skill exists to keep us honest to that goal.

---

Status: Phase 0 planning and detailed design can begin immediately under the skill.