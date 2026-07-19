# AI CMO Developer Prompts: Phased Codebase Upgrades for Moyi

This file contains copy-pasteable developer/agent prompts divided into **4 implementation phases** to upgrade the **Moyi AI CMO** project into a spec-compliant system. 

---

## 🗂️ PHASE 1: Search-Based Competitor Auto-Discovery

### Copy-Paste Prompt:
```markdown
AI-CMO SPEC COMPLIANCE:
*   Requirement 2 (Low-Friction Input): Automate competitor discovery from a target URL scan.
*   Requirement 7 (Scope & Boundaries): Competitors must be discovered and crawler-analyzed before showing the project dashboard.

CONTEXT FILES:
*   /home/brandon/Moyi/services/discoveryService.js (inferCompetitorsFromPages & scanProjectForDiscovery)
*   /home/brandon/Moyi/routes/projects.js (line 258: project creation / discovery scan flow)

BRUTAL PROBLEM STATEMENT:
Moyi's competitor "discovery" currently guesses competitors by filtering external links parsed from the scraped home page. This is a weak proxy that returns social links, news articles, or completely unrelated resources, rather than direct business competitors. Furthermore, deeper competitive intelligence reports still require the user to manually input competitors. We need this automated.

UPGRADE INSTRUCTIONS:
1. Refactor `services/discoveryService.js`:
   - Replace the link-filtering logic in `inferCompetitorsFromPages` with a Search-Based Discovery Engine.
   - Use the client's crawled homepage text to call OpenAI (or the local fallback model) and extract 3-5 core search terms representing the client's business.
   - Query the DuckDuckGo Search utility (`langchain_community.tools.DuckDuckGoSearchRun` or equivalent HTTP requests) using those search terms.
   - Parse search result domains. Filter out common false-positives (directories, Wikipedia, news sites, blogs, and social platforms like YouTube/Facebook).
   - Identify the top 3 direct competitor domains.
   - Run a shallow crawl on the discovered competitor homepages using `crawlerService.js`.
   - Feed competitor homepage text to the LLM to extract their core value proposition and set a `confidence` score.
2. Update `routes/projects.js` (creation flow):
   - In the project creation route (`/projects/new`), when the discovery scan completes, automatically populate the `competitors` field in the database `Project` model with the discovered list.
   - Eliminate the requirement for the user to manually trigger a competitor crawler or type URLs to build the initial comparison grid.

VERIFICATION STEPS:
1. Run a scan for a test website (e.g., https://moyi.co).
2. Check the MongoDB `projects` collection to verify that the `competitors` array contains domains that represent actual business competitors rather than external link domains.
```

---

## 🗂️ PHASE 2: True No-Touch Onboarding & High-Fidelity Persona Calibration

### Copy-Paste Prompt:
```markdown
AI-CMO SPEC COMPLIANCE:
*   Requirement 2 (Low-Friction, High-Context Input): Auto-populate target customer profiles, voice, and Objections.
*   Requirement 1 (System Ownership): Enforce clear, consistent positioning profiles from day one.

CONTEXT FILES:
*   /home/brandon/Moyi/services/aiReportService.js (or crawlerService.js brand extraction functions)
*   /home/brandon/Moyi/views/projects/new.ejs (onboarding URL submission view)
*   /home/brandon/Moyi/views/projects/calibration.ejs (founder review page)

BRUTAL PROBLEM STATEMENT:
Moyi's onboarding creates a basic project profile but forces the user to manually edit and type tone keywords, value propositions, and personas in text boxes during the calibration step. This creates cognitive friction and manual data entry tax for the founder during setup. We must switch this to an "Approve & Go" model.

UPGRADE INSTRUCTIONS:
1. Refactor AI Brand Profile Generation:
   - Modify the brand/persona extraction prompt in `services/aiReportService.js` (or `services/crawlerService.js`) to generate high-fidelity, complete target customer profiles.
   - The LLM must output 3 distinct target personas, including their demographics, core objections (e.g., "setup is too slow", "integration pricing is high"), and suggested copywriting hooks.
2. Refactor Onboarding & Calibration Interface:
   - Update `views/projects/calibration.ejs` (and the projects route handler) to render these personas, tone adjectives, and value propositions as fully complete card elements rather than blank or raw inputs.
   - Replace manual text boxes with simple "Approve" checkboxes and "Edit" modals.
   - The founder should be able to click a single "Verify & Activate" button without typing anything, shifting the workflow from data entry to confirmation.

VERIFICATION STEPS:
1. Submit a target URL during onboarding.
2. Verify that the Calibration page loads with detailed customer personas and value props already written, and that clicking "Confirm" takes the user directly to the active CMO dashboard with status = 'approved'.
```

---

## 🗂️ PHASE 3: Revenue-Linked Stripe/Payment Attribution

### Copy-Paste Prompt:
```markdown
AI-CMO SPEC COMPLIANCE:
*   Requirement 4 (Revenue-Linked Measurement): Map touchpoints to actual invoice revenue instead of clicks/impressions.
*   Requirement 5 (SME Economics): Track and display ROI based on net cash flow.

CONTEXT FILES:
*   /home/brandon/Moyi/routes/projects.js (line 646: /projects/:id/attribution route)
*   /home/brandon/Moyi/services/attributionService.js (buildAttributionDashboard)
*   /home/brandon/Moyi/views/projects/attribution_dashboard.ejs (render engine)

BRUTAL PROBLEM STATEMENT:
Moyi's revenue attribution dashboard is a complete shell. The route handler passes an empty array `[]` as the second argument to `buildAttributionDashboard`, causing the dashboard to show zero revenue, zero conversions, and zero attribution. The tracking system is recording UTM events, but they are not linked to actual user payments.

UPGRADE INSTRUCTIONS:
1. Refactor Route Handler:
   - In `routes/projects.js`, edit the `GET /:id/attribution` route.
   - Query the MongoDB database for Stripe subscriptions, payment events, or invoice records linked to the project's user (e.g., matching the owner's billing details).
   - If mock payment data is needed for local development, generate a list of mock payments (specifying amounts, timestamps, and customer emails) instead of passing `[]`.
2. Update Attribution Logic:
   - In `services/attributionService.js`, verify that the `buildAttributionDashboard` function queries `models/TrackingEvent` for logs matching `payment.customerId`, `payment.stripeCustomerId`, or `payment.email` prior to the payment timestamp.
   - Distribute the payment value across touchpoints using the W-Shaped model (30% first touch, 30% lead conversion touch, 30% last touch, 10% middle distribution).
   - Calculate and display the **Attribution Confidence Score (ACS)** based on matching precision (100% for server-side direct UTM to Stripe, lower for session correlation).
3. Update EJS View:
   - In `views/projects/attribution_dashboard.ejs`, render actual revenue totals, conversion rates, and the ACS confidence score.

VERIFICATION STEPS:
1. Run a test where you simulate a pageview with `?utm_source=meta` and a customer email, then write a Stripe payment log to the database with that email.
2. View the attribution dashboard and verify the Meta channel shows the correct revenue share and attribution weights.
```

---

## 🗂️ PHASE 4: Deep Telemetry Auditing & Verification

### Copy-Paste Prompt:
```markdown
AI-CMO SPEC COMPLIANCE:
*   Requirement 3 (End-to-End Orchestration): Verify the measurement loop is live before running campaigns.
*   Requirement 2 (Low-Friction Input): Automate verification checks to save manual diagnostic time.

CONTEXT FILES:
*   /home/brandon/Moyi/services/telemetryAuditor.js (auditTelemetry)
*   /home/brandon/Moyi/views/projects/show.ejs (telemetry health widget)

BRUTAL PROBLEM STATEMENT:
Moyi's telemetry auditor checks if GSC properties exist and if we have received events, but it runs lightweight database counts rather than verifying actual code integration. It does not check if the script is active on the user's live pages, if Stripe hooks are active, or if CRM syncs are operational.

UPGRADE INSTRUCTIONS:
1. Refactor `services/telemetryAuditor.js`:
   - Add an active **On-Page Script Checker**: Fetch the client's homepage HTML and parse it to verify that `<script src="..." data-project="...">` is physically present.
   - Add a **Stripe Webhook Connection Check**: Query stripe logs or verify database webhook logs to confirm a successful handshake occurred in the last 7 days.
   - Add a **GSC API Permissions Check**: Verify that Google OAuth tokens are active and can execute a test metric query.
   - Add a **CRM Connection Check**: Verify CRM API credentials can reach the target endpoint (e.g. HubSpot API).
2. Update Telemetry UI:
   - In `views/projects/show.ejs`, break down the telemetry health widget. Instead of showing a generic score, list the checklist items ("Tracking Script: ACTIVE", "Stripe Webhooks: ACTIVE", "Search Console OAuth: VERIFIED", "CRM Sync: VERIFIED").
   - If any core check fails, disable the automated execution toggles.

VERIFICATION STEPS:
1. Run a telemetry audit on a test project.
2. Verify that removing the script tag from the homepage results in the Telemetry Score dropping and autonomous toggles locking.
```
