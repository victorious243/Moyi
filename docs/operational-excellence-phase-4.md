# Phase 4: Operational Excellence

Phase 4 makes project intelligence accountable and routable. It adds project notification policies, stakeholder routes, external delivery destinations, marketing goals, forecasts, and goal-aware executive briefings.

## Project Settings

Open a project and select **Notifications & Briefings** in the project sidebar.

The page controls:

- Daily Growth Intelligence and Daily Content Intelligence delivery times.
- Project timezone.
- Weekly CMO Brief day and time.
- Monthly Strategy Review day and time.
- Alert sensitivity: All, Important, High+, or Critical only.
- Available in-app, email, Slack, Microsoft Teams, Discord, and generic webhook channels.

Scheduled delivery is evaluated in the project timezone. The scheduler runs every 15 minutes and sends a configured report once per local delivery period. Duplicate keys prevent the same daily, weekly, monthly, or goal event from being dispatched twice.

## Stakeholder Routing

Routes are configured by alert category:

- General growth
- Revenue and critical
- Content approvals
- Tracking failures
- Executive briefings
- Goals and KPIs

Each route can include the project owner, selected project or organization members, up to 20 external email addresses, and project-owned webhook endpoints. Member and endpoint IDs are validated against the project on every update.

If no category route exists, Moyi defaults to the project owner through enabled in-app and email channels. Existing weekly briefing recipient emails remain supported as a compatibility fallback.

## Delivery Endpoints

Supported incoming webhook adapters:

- Slack incoming webhooks with Block Kit payloads.
- Microsoft Teams incoming webhooks with Adaptive Cards.
- Discord webhooks with embeds.
- Generic HTTPS webhooks with Moyi's structured JSON payload.

Webhook URLs must use HTTPS, resolve to public IP addresses, and cannot contain credentials. Localhost, private, loopback, link-local, and carrier-grade NAT destinations are rejected. Redirects are disabled during delivery. Slack and Discord endpoints are additionally restricted to their official webhook hosts and paths.

Endpoint URLs and optional generic-webhook signing secrets are encrypted with the existing `TOKEN_ENCRYPTION_SECRET` configuration. Generic webhook requests include `X-Moyi-Signature: sha256=<digest>` when a signing secret is configured.

Failed webhooks are attempted three times. Each attempt and terminal failure is recorded in `NotificationDelivery`; endpoint health and the latest safe error message appear in Notification Settings. URLs and secrets are never returned to the browser or written to delivery logs.

## Generic Webhook Payload

```json
{
  "source": "Moyi-CMO",
  "version": "1.0",
  "project": {
    "name": "Example",
    "website": "https://example.com"
  },
  "alert": {
    "title": "Qualified leads at risk",
    "severity": "warning",
    "category": "goals",
    "summary": "Qualified leads are projected to reach 176 against a monthly target of 200.",
    "urgency": "high",
    "confidence": 80,
    "businessImpact": "The current pace is unlikely to meet the agreed marketing outcome.",
    "evidence": {},
    "recommendedAction": "Review the strongest acquisition source and the weakest funnel step.",
    "action": {
      "label": "Review Goals",
      "url": "https://moyi-cmo.com/projects/.../goals"
    },
    "occurredAt": "2026-08-20T12:00:00.000Z"
  }
}
```

Evidence is sanitized before external delivery. Credential-like keys are omitted and deep links are restricted to the configured Moyi application origin.

## Goals And KPI Management

Open **Goals & KPIs** from a project sidebar. Project administrators can define revenue, attributed revenue, qualified lead, signup, conversion, organic traffic, paid traffic, CAC, CPA, ROAS, follower, engagement, or custom targets.

Each goal records its target, current value, period, owner, source, warning threshold, unit, notes, progress, forecast, and status. CAC and CPA use a decrease direction; the other standard metrics use an increase direction.

Updating a goal recalculates its forecast and can create:

- `goal_ahead_of_plan`
- `goal_at_risk`
- `goal_achieved`
- `goal_missed`
- `forecast_below_target`
- `forecast_above_target`

Goal events use the same routing, channel, retry, read-state, and resolution architecture as other Growth Alerts.

## Executive Briefings

Weekly and monthly executive reports now include:

- Goal pace and forecast versus target.
- Whether accountable outcomes are on track.
- The largest current risk.
- The strongest available opportunity.
- The next decision or action.
- Search, competitor, content, and recommendation evidence.

The Daily Growth Intelligence view also displays active goal pace. Moyi does not infer missing KPI values; manual goals must be updated by an authorized project administrator until their selected data source is automated.

## Database Migration

Run once after deploying Phase 4:

```bash
npm run migrate:operational
```

This backfills project notification defaults and creates indexes for:

- `GrowthAlert`
- `MarketingGoal`
- `NotificationDelivery`
- `NotificationEndpoint`
- `NotificationRoute`

MongoDB remains the application's persistence layer; no new Postgres migration is required.

## Environment And Operations

Phase 4 adds no required environment variables. It reuses:

- `APP_URL` for safe deep links.
- `TOKEN_ENCRYPTION_SECRET` for endpoint secret encryption.
- Existing SMTP variables for email delivery.

The web process starts the operational scheduler through `services/cmoBriefingScheduler.js`. Run only one web scheduler process unless schedule locking is moved to the queue. External channel delivery currently uses incoming webhooks; Slack and Teams OAuth applications are not required.

## Current Limitations

- Goal values marked as manual are not synchronized automatically.
- Search Console, tracking, social, ads, and CRM are recorded as goal data-source choices, but automatic KPI ingestion is a later integration step.
- Delivery retries happen in the web scheduler process. A queue-backed retry worker is recommended before high-volume enterprise use.
- Monthly reviews currently use the executive briefing renderer with a monthly subject and dedupe period.

## Recommended Next Step

Move external notification delivery and scheduled briefing leases into BullMQ, then add trusted KPI connectors for Search Console, first-party tracking, social analytics, ads, and CRM data. That gives Moyi durable retries across deployments and replaces manual KPI updates with evidence-backed progress while preserving human control over targets.
