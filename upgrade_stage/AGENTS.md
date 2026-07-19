# AI CMO Project — Agent Instructions

**CRITICAL: All work on this AI CMO must strictly follow the `ai-cmo` skill and the four specialized subdomain skills:**
*   **`ai-cmo-data-ingestion`**: Rules for building secure, rate-limit-aware OAuth and webhook integrations.
*   **`ai-cmo-brand-memory`**: Rules for vector schemas, brand guides, customer personas, and memory context.
*   **`ai-cmo-agentic-orchestration`**: Rules for multi-agent swarm routing, message protocols, and safety gates.
*   **`ai-cmo-execution-attribution`**: Rules for executing API changes and tracking multi-touch revenue attribution.

## Mandatory Protocol for Every Task
1. Before any planning, design, or coding: Invoke or simulate the `/ai-cmo` skill and any relevant subdomain skills.
2. Read `/home/brandon/.grok/skills/ai-cmo/references/REQUIREMENTS.md` (or the copy in this repo at `references/REQUIREMENTS.md`).
3. Read the root research report if needed: `/home/brandon/SME_CMO_Problems_and_AI_Solution_Report.txt`.
4. Begin every reasoning block with:
   ```
   AI-CMO SPEC COMPLIANCE: [Which of the 7 requirements this work primarily advances. Map explicitly.]
   ```
5. Every feature, module, API, prompt, or UI decision must be justified against the 7 non-negotiables.
6. Never implement anything that replicates the documented failure modes (vanity metrics, high coordination tax, shallow integrations, black-box decisions, content-volume-over-ownership, unaffordable pricing, loss of memory, over-claiming autonomy).

## Project Principles (from the spec)
- System ownership over task execution.
- Low-friction input + rich persistent business model.
- Full orchestration with transparent audit logs.
- Revenue-linked everything (pipeline, CAC, payback, LTV signals).
- Economics that work for SMEs spending hundreds to low thousands $/mo on marketing.
- Compounding continuity (never lose context).
- Explicit boundaries + progressive autonomy (human-in-the-loop by default for new/high-stakes areas).

## Validation Requirement
Before considering any slice "done":
- Run validation against the hard metrics in REQUIREMENTS.md (owner time saved, waste reduction, attributable revenue movement, confidence lift, consistent positioning, actual kill/scale decisions, minimal input burden).
- Use the check-work skill on significant changes.
- Document how it reduces specific failure modes from the research.

## Anti-Patterns (Reject)
See the full list in the ai-cmo skill and REQUIREMENTS.md.

## Getting Started
To work on this project, prefix relevant instructions with "Follow the /ai-cmo skill" or simply run `/ai-cmo <your task here>`.

The first major artifacts are in `docs/`.

This file + the ai-cmo skill + references/REQUIREMENTS.md together define the law for this codebase. Deviations will produce another tool that fails to unload the CMO job for real SMEs. 

Do not ship until it demonstrably advances the 7 requirements with evidence from pilots on real SME data.