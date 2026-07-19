# AI CMO — The System That Actually Unloads CMO-Level Work for SMEs

This project exists to build the AI CMO described in the research report at `/home/brandon/SME_CMO_Problems_and_AI_Solution_Report.txt`.

## The Problem We Refuse to Paper Over
Most SMEs cannot afford a real CMO ($250k–$500k+ total comp).  
Fractional CMOs still cost $3k–$15k/month.  
Agencies and freelancers frequently deliver packages, vanity metrics, generic work, and high coordination overhead — with owners cycling through multiple providers and still seeing weak or unprovable ROI.  
Current AI marketing tools are mostly point solutions for content, basic optimization, or generation. They reduce some friction but leave the ownership, prioritization, revenue linkage, and continuity burden on the already-overloaded owner.

Result (documented): 78% of failing small businesses lack a marketing/business plan, up to 40-60% of digital budgets wasted, 18% of SMBs "very confident" their marketing is working, massive time poverty.

## What "Best" Means Here (Non-Negotiable)
We are building to the exact 7 requirements in `.grok/skills/ai-cmo/references/REQUIREMENTS.md` (and the local copy in `references/`).

The product must deliver:
1. True system ownership (living plan tied to revenue outcomes, ruthless prioritization, consistency).
2. Minimal owner input + automatic rich business context (voice notes + deep data pull + persistent internal model).
3. End-to-end orchestration with full auditability and human escalation boundaries.
4. Revenue-linked measurement and optimization as the primary loop (not vanity).
5. Economics that work for businesses whose total marketing spend is measured in hundreds to low thousands per month.
6. Compounding continuity (memory that actually gets better over time).
7. Honest scoping: force multiplier and partial unload, never "full replacement" vaporware on day one.

It must also respect the honest limitations listed in the spec.

## How This Project Is Guarded
- The `ai-cmo` skill in `/home/brandon/.grok/skills/ai-cmo/SKILL.md` is the law for any agent (human or AI) working on this.
- Every task starts by reading the REQUIREMENTS.
- Every decision must map explicitly to the 7 requirements.
- Anti-patterns (building another content engine, black-box decisions, high fixed pricing that recreates the barrier, shallow integrations, memory loss, etc.) are rejected.
- Validation is against hard SME outcomes from the research, not demos or feature checklists.

## Current State (as of creation)
- Research report complete (serious, no-sugarcoating data + founder patterns).
- `ai-cmo` skill + references live and registered.
- This project skeleton + initial ARCHITECTURE.md and PHASED-ROADMAP.md created under the spec.
- Ready for Phase 0 detailed design and implementation of the core (Memory + Connectors + Attribution + Living Plan + basic Orchestration + audit).

## Getting the Coding Agent to Work on It
Simply use the skill:

`/ai-cmo design the persistent memory model and context ingestion layer, following the architecture`

Or for any subtask.

The agent will (by design of the skill):
- Read the requirements first.
- State AI-CMO SPEC COMPLIANCE mapping.
- Stay inside the 7 non-negotiables and development process.
- Prioritize integration depth + attribution + ruthless scope + measurable pilot outcomes.

## Directory Layout (Initial)
- `docs/` — ARCHITECTURE.md, PHASED-ROADMAP.md, future specs
- `references/` — REQUIREMENTS.md (project copy), other constraints
- `src/` — future code (will be added only after Phase 0 data models and core loop design)
- `pilots/` — pilot customer artifacts, measurement frameworks, results (never commit real PII)
- `AGENTS.md` — instructions for any coding agent

## Success Definition (From the Report)
We will consider the core thesis validated only when real SMEs using the system show:
- Measurable reduction in owner time spent on marketing coordination/execution
- Reduction in wasted marketing spend
- Clear, attributable movement in pipeline / closed revenue / CAC that the business trusts and acts on
- Consistent positioning and execution without constant founder intervention
- Low ongoing input burden
- The system is making real prioritization and kill/scale decisions with data
- The economics (their total cost to get effective marketing) are better than the old way

Until then, we are still building toward the goal, not shipping another disappointment.

---

This is a serious project for a serious, painful, expensive problem. The skills and this structure exist to keep us honest.

Start any work with `/ai-cmo ...` or by explicitly following the skill.