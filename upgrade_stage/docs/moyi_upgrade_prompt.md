# Master Instructions: Upgrading Moyi into a Real AI CMO Platform

You are tasked with upgrading the **Moyi AI CMO** project (located at `/home/brandon/Moyi`) to align with the canonical requirements for a "Real AI CMO". 

## 1. System Context & Architecture
Moyi is a Node.js, Express, MongoDB, and EJS-based SaaS application. Currently, it relies on manual user inputs for project configuration (industries, personas, competitor URLs) and operates as a basic point tool for SEO audits. 

You must refactor Moyi’s onboarding, strategy, data, and execution layers to replace manual inputs with **Auto-Discovery scanning**, integrate **Telemetry Auditing**, and close the loop with **Revenue-Linked Multi-Touch Attribution**.

---

## 2. The 4 Subsystems to Implement

### Subsystem A: Onboarding Auto-Discovery & Diagnostic Scraper
*   **Goal:** Replace the manual questionnaire in `routes/projects.js` and `views/` with a URL scan that auto-populates values for the user.
*   **Files to Modify/Create:**
    *   `models/Project.js`: Add fields for `status` ('draft' | 'approved'), `brand_profile` (JSON matching `DraftBrandProfile`), and `competitors` (Array of `DraftCompetitor`).
    *   `services/crawlerService.js` & `services/competitorInsightService.js`: Integrate the custom CrewAI scanning script located at `/home/brandon/Deep-Research-With-Web-Scraping-by-LLM-And-AI-Agent/src/AI-Agent/apps.py` (either via python shell spawn or rebuilding the scraping logic in Node using Cheerio + Search API).
    *   `routes/projects.js`: Add a `POST /projects/scan` route that triggers the auto-discovery async task, saves outputs as `'draft'`, and redirects to `views/projects/calibration.ejs`.
    *   `views/projects/calibration.ejs` (Create): Render the pre-populated findings. Allow the user to check/edit text boxes for tone adjectives, value props, personas, and competitors, then submit `POST /projects/approve` to toggle status to `'approved'`.

### Subsystem B: Onboarding Telemetry Auditor
*   **Goal:** Before executing marketing actions, verify the connected Google Search Console, Analytics (tracking scripts), Stripe, and CRMs are recording correct data.
*   **Files to Modify/Create:**
    *   `services/telemetryAuditor.js` (Create): Implement audits for GA4/Search Console connection checks, UTM validation (ensuring landing page parameters are detected), and conversion-to-click sanity checks (flagging anomalies like duplicate conversion tracking).
    *   `routes/projects.js` / Dashboard view: Display a **Telemetry Health Score** (0-100%). Block fully autonomous budget shifts or posting actions if score is <85%.

### Subsystem C: Closed-Loop Multi-Touch Attribution Core
*   **Goal:** Calculate campaign ROI using actual sales outcomes rather than clicks/impressions.
*   **Files to Modify/Create:**
    *   `models/TrackingEvent.js`: Add fields for resolved customer IDs (linking cookies to emails and Stripe customer IDs).
    *   `services/attributionService.js` (Create): Calculate **First-Touch, Last-Touch, Linear, and W-Shaped** revenue weights for customer payment logs in `models/User.js` (or via Stripe invoice webhooks).
    *   `services/attributionService.js`: Compute the **Attribution Confidence Score (ACS)**:
        *   *High (80-100%):* Explicit server-side UTM matched to Stripe charge.
        *   *Medium (40-79%):* Direct site visit matching ad click IP/window.
        *   *Low (<40%):* Modeled correlative conversion.
    *   `views/projects/attribution_dashboard.ejs` (Create): Render conversion stats showing revenue instead of clicks, with clear ACS confidence bands.

### Subsystem D: Timeout-Based Autonomy & Trust Gates
*   **Goal:** Enforce safety guardrails for autonomous budget allocation and creative execution.
*   **Files to Modify/Create:**
    *   `models/Campaign.js`: Add validation constraints on daily and monthly channel spends.
    *   `routes/recommendations.js`: Update the approval handler. If a low-stakes action (budget shift <15% or creative variation) sits in the review queue for >48 hours without owner feedback, auto-resolve with a safe default action.
    *   `services/usageService.js`: track and alert budget boundaries dynamically.

---

## 3. Step-by-Step Implementation Protocol
For every file modification or component creation:

1.  **Compliance Annotation:** State the `AI-CMO SPEC COMPLIANCE` mapping at the top of your files and PR/work updates.
2.  **Write Tests First (TDD):** Create mocha/jest unit and integration tests inside `tests/` verifying the data models, scrapers, and attribution calculators before writing implementation code.
3.  **Audit Data Quality:** Verify all integrations gracefully degrade and throw descriptive alerts if API limits or rates are breached.
4.  **Simulate Sandbox First:** Before connecting live credentials, verify the engine using mock databases and synthetic API responses inside a testing suite.
5.  **Telemetry Proving:** Do not declare any task complete without running the test runner and displaying the passing code outputs.
