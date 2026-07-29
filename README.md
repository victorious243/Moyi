# Moyi AI CMO

Phase 12 foundation for an AI Chief Marketing Officer SaaS platform.

This phase includes authentication, a protected dashboard, owner-scoped business/project profile management, factual website crawling, SEO issue storage, an AI CMO Engine, SEO content draft generation from accepted recommendations, Google Search Console performance syncing, weekly/monthly AI CMO reporting, basic ethical competitor tracking, a safe WordPress draft workflow, Stripe SaaS billing with plan limits, first-party traffic/conversion tracking, and ethical content calendar/campaign planning. Social integrations, Shopify/Webflow, ad automation, and auto-publishing are intentionally left for later phases.

## Stack

- Node.js and Express
- MongoDB with Mongoose
- EJS views
- JWT cookie authentication
- bcrypt password hashing
- dotenv environment variables
- express-validator validation
- Basic in-memory auth rate limiting
- Axios and Cheerio for factual website crawling
- OpenAI for AI CMO report and recommendation generation
- Approval-queue content drafts with manual review states
- Google Search Console OAuth and readonly performance syncing
- Weekly and monthly AI CMO reports with period-over-period metrics
- Manual competitor website tracking and public SEO comparison
- WordPress REST API integration for approved draft posts
- Stripe Checkout, customer portal, webhooks, plan limits, and monthly usage tracking
- Privacy-friendly first-party analytics and conversion tracking
- Content calendar, campaign planning, and manual social/email draft workflow

## Quick Start

```bash
cp .env.example .env
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

You need MongoDB running locally or a MongoDB Atlas connection string in `.env`.

## Environment

Required values:

```env
APP_NAME="Moyi AI CMO"
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017/moyi
JWT_SECRET=replace-with-a-long-random-secret
TOKEN_ENCRYPTION_SECRET=replace-with-a-long-random-secret
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/integrations/google/callback
APP_URL=http://localhost:3000
TRUST_PROXY_HOPS=0
COOKIE_DOMAIN=
RELEASE_SHA=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_STARTER_PRICE_ID=
STRIPE_PRO_PRICE_ID=
STRIPE_AGENCY_PRICE_ID=
```

For MongoDB Atlas, set `MONGODB_URI` to your Atlas URI. If your password has special characters, you can instead use:

```env
MONGODB_HOST=cluster0.xxxxx.mongodb.net
MONGODB_USER=moyi_user
MONGODB_PASSWORD=raw-password-here
MONGODB_DB=moyi
```

## Phase 1 Features

- Register at `/register`
- Log in at `/login`
- Log out with `POST /logout`
- Protected dashboard at `/dashboard`
- Project CRUD:
  - `GET /projects`
  - `GET /projects/new`
  - `POST /projects`
  - `GET /projects/:id`
  - `GET /projects/:id/edit`
  - `POST /projects/:id`
  - `POST /projects/:id/delete`

Each user only sees and edits their own projects.

## Phase 2 Website Scans

Authenticated users can run a factual website scan from a project page.

Routes:

- `POST /projects/:id/scans`
- `GET /projects/:id/scans`
- `GET /projects/:id/scans/:scanId`
- `GET /projects/:id/pages`

The crawler:

- Starts from `project.websiteUrl`
- Crawls same-domain pages only
- Normalizes URLs and avoids duplicates
- Ignores `mailto:`, `tel:`, `javascript:`, anchors, file downloads, and external domains
- Crawls up to the user's plan page limit
- Stores each page as a MongoDB `Page` document
- Handles broken/unreachable pages without crashing the app

Collected page facts include status code, title, meta description, H1, H2 headings, canonical URL, robots meta, word count, internal/external links, image alt coverage, Open Graph fields, JSON-LD schema types, and crawl timestamp.

## Phase 4 AI CMO Engine

After a project has a completed scan and stored audit issues, users can generate an AI CMO plan.

Routes:

- `POST /projects/:id/ai-report`
- `GET /projects/:id/ai-report/latest`
- `GET /projects/:id/recommendations`
- `POST /recommendations/:id/status`

Prompt templates live in:

- `src/prompts/seo-report.prompt.js`
- `src/prompts/recommendation.prompt.js`

The AI service is constrained to the supplied project profile, crawled pages, scan summary, and stored issues. It instructs the model not to invent crawl data, fake URLs, guaranteed ranking outcomes, or unsupported technical problems. Recommendation target URLs and related issue IDs are filtered against stored page and issue records before saving.

If `OPENAI_API_KEY` is not configured, report generation stores a failed report state with a clear message instead of crashing.

## Phase 5 Content Drafts

Accepted recommendations can generate content drafts. Drafts are stored in an approval queue and are never auto-published.

Routes:

- `POST /recommendations/:id/generate-content`
- `GET /projects/:id/content`
- `GET /content/:id`
- `POST /content/:id/update`
- `POST /content/:id/approve`
- `POST /content/:id/reject`
- `POST /content/:id/mark-published`

Supported draft types:

- `meta_title`
- `meta_description`
- `h1`
- `faq_section`
- `blog_outline`
- `blog_article`
- `service_page_section`
- `internal_linking_plan`
- `schema_jsonld`

Content prompt templates live in `src/prompts/`:

- `meta-title.prompt.js`
- `meta-description.prompt.js`
- `blog-outline.prompt.js`
- `blog-draft.prompt.js`
- `faq.prompt.js`
- `schema-jsonld.prompt.js`
- `internal-links.prompt.js`

Content generation follows these boundaries: no keyword stuffing, no false claims, no guaranteed rankings, no invented testimonials/reviews/awards/prices/addresses/certifications, and no CMS publishing. If no AI key is configured, the app creates conservative local template drafts marked with `local-template-no-api-key`.

## Phase 6 Search Console

Users can connect a Google account with Search Console readonly scope, select one verified property per project, sync search analytics data, and view a project-level performance dashboard.

Routes:

- `GET /integrations`
- `GET /integrations/google/connect`
- `GET /integrations/google/callback`
- `GET /projects/:id/search-console/connect`
- `POST /projects/:id/search-console/property`
- `POST /projects/:id/search-console/sync`
- `GET /projects/:id/search-console/performance`

Synced fields include clicks, impressions, CTR, average position, query, page, country, device, and date. The default sync window is 28 days, with 7, 28, and 90 day dashboard views. OAuth tokens are encrypted before storage and never rendered to the frontend. Expired access tokens are refreshed with the stored refresh token when possible.

## Phase 7 AI CMO Reports

Users can manually generate weekly updates and monthly executive reports from available audit, recommendation, content draft, and Search Console data.

Routes:

- `POST /projects/:id/reports/weekly`
- `POST /projects/:id/reports/monthly`
- `GET /projects/:id/reports`
- `GET /projects/:id/reports/:reportId`

Reports include:

- Executive summary
- Organic search performance
- Click, impression, CTR, and average position comparison
- Top gaining and losing pages
- Top gaining queries
- Low CTR opportunities
- Completed content actions
- Open recommendations
- Next 7 day and next 30 day action plans
- Warnings and limitations

Prompt templates live in:

- `src/prompts/weekly-cmo-report.prompt.js`
- `src/prompts/monthly-cmo-report.prompt.js`

The report engine only uses available metrics and project records. If Search Console is missing or empty, the report clearly says performance data is missing. If `OPENAI_API_KEY` is not configured, the app creates an honest system-generated report instead of crashing.

## Health Endpoints

- `GET /healthz` returns a liveness payload with uptime, environment, and release metadata.
- `GET /readyz` returns a readiness payload with MongoDB state, queue state, configuration problems, and optional integration warnings.

In production, treat `503 /readyz` as a failed deployment signal.

## Phase 8 Competitor Tracking

Users can manually add competitor websites, run a shallow competitor crawl, store public SEO page facts, and generate ethical opportunity suggestions.

Routes:

- `POST /projects/:id/competitors`
- `GET /projects/:id/competitors`
- `POST /projects/:id/competitors/:competitorId/scan`
- `GET /projects/:id/competitors/:competitorId`
- `POST /projects/:id/competitors/report`
- `GET /projects/:id/competitors/insights`

Competitor scans:

- Only crawl websites manually added by the user
- Respect basic `robots.txt` disallow rules
- Stay on the competitor domain
- Avoid search result pages and private data
- Store public SEO facts such as title, meta description, H1, headings, word count, internal/external links, and schema types
- Cap scans at a small number of pages for homepage, service/product pages, and blog/article pages that are easily discoverable

Competitor opportunity reports compare crawled project pages against crawled competitor pages. They do not claim private competitor performance, traffic, conversions, or rankings, and they do not suggest copying competitor content.

## Phase 9 WordPress CMS Workflow

Users can connect one WordPress site per project using REST API credentials or a WordPress application password. Approved blog article drafts can be sent to WordPress as draft posts only.

Routes:

- `GET /projects/:id/integrations/wordpress`
- `POST /projects/:id/integrations/wordpress/connect`
- `POST /projects/:id/integrations/wordpress/test`
- `GET /projects/:id/integrations/wordpress/pages`
- `POST /content/:id/publish/wordpress-draft`

Publishing rules:

- Content must be approved before it can be sent to WordPress.
- Blog articles are created as WordPress `draft` posts.
- FAQ sections, service page sections, metadata updates, schema drafts, and internal-linking plans are export-only in this MVP.
- No existing WordPress page is overwritten automatically.
- Application passwords are encrypted before storage and are never shown after saving.
- Every publish/export attempt is stored as a `PublishAction`.

## Phase 10 Billing & Launch Readiness

Stripe billing is available with Free, Starter, Pro, and Agency plans. Users start on the Free plan by default.

Routes:

- `GET /pricing`
- `GET /billing`
- `POST /billing/create-checkout-session`
- `POST /billing/create-portal-session`
- `POST /webhooks/stripe`
- `GET /account`
- `GET /terms`
- `GET /privacy`
- `GET /cookies`

Plan limits are enforced server-side for:

- Project creation
- Monthly scan count
- Pages per scan
- AI report generation
- Content draft generation
- Search Console sync
- Competitor tracking
- WordPress publishing

Stripe webhook events update `plan`, `subscriptionStatus`, `stripeCustomerId`, `stripeSubscriptionId`, and `currentPeriodEnd`. Webhook signatures are verified using `STRIPE_WEBHOOK_SECRET`.

## Phase 11 Traffic & Conversion Tracking

Each project has a public tracking key and installable first-party tracking script:

```html
<script src="https://your-domain.com/tracker.js" data-project="PROJECT_PUBLIC_KEY" async></script>
```

Routes:

- `GET /tracker.js`
- `POST /api/track`
- `GET /projects/:id/tracking/setup`
- `GET /projects/:id/analytics`
- `POST /projects/:id/conversion-goals`

Tracked fields include page views, custom events, conversions, session ID, URL, referrer, UTM source/medium/campaign, device type, browser, country headers when available, and timestamp. Raw IP addresses are not stored; IPs are hashed with the server encryption secret.

Privacy boundaries:

- Respects browser Do Not Track where available.
- Does not collect form contents.
- Does not use invasive fingerprinting.
- Does not store raw IP addresses.
- Provides setup-page guidance for a site privacy notice.
- Custom events should never include personal, payment, health, or sensitive data.

## Phase 12 Content Calendar & Campaign Planning

Projects include a manual content calendar and campaign planner for ethical content distribution. This phase does not auto-post to social platforms or send messages.

Routes:

- `GET /projects/:id/calendar`
- `POST /projects/:id/campaigns`
- `GET /projects/:id/campaigns`
- `POST /content/:id/create-social-drafts`
- `POST /social-drafts/:id/approve`
- `POST /social-drafts/:id/mark-published`

Workflow:

- Create a campaign for a project.
- Approve a content draft.
- Generate social/email drafts from the approved draft.
- Review, copy, export, approve, and manually mark posts as published.

AI and fallback draft rules:

- No fake engagement.
- No fake reviews, testimonials, awards, or claims.
- No spam DMs.
- No misleading promises.
- Posts should be useful, honest, and brand-consistent.
- Nothing auto-posts without a future explicit integration and approval flow.

### Production Deployment Guide

Before production launch:

- Set `NODE_ENV=production`.
- Set strong `JWT_SECRET` and `TOKEN_ENCRYPTION_SECRET` values.
- Use a production MongoDB database and restrict network access.
- Configure `APP_URL` to the public HTTPS app URL.
- Set `TRUST_PROXY_HOPS=1` or higher when running behind a load balancer or reverse proxy.
- Set `COOKIE_DOMAIN` if auth cookies must be shared across subdomains.
- Set `RELEASE_SHA` so health responses identify the deployed version.
- Configure Stripe live keys and live price IDs.
- Add the Stripe webhook endpoint: `https://your-domain.com/webhooks/stripe`.
- Set `STRIPE_WEBHOOK_SECRET` from the Stripe webhook endpoint.
- Configure Google OAuth redirect URI if Search Console is enabled.
- Add first-party analytics language to your production privacy/cookie notice.
- Review and replace placeholder Terms, Privacy, and Cookie pages.
- Run `npm install` so the Stripe package from `package.json` is installed.
- Run the app behind HTTPS with secure cookies enabled by `NODE_ENV=production`.
- Use a process manager or platform health checks for the web app and scan worker.
- Keep `DISABLE_QUEUE=false` with Redis/BullMQ for production workloads. The app now rejects `DISABLE_QUEUE=true` in production.
- Run both `npm start` and `npm run worker` in production, and wire platform health checks to `GET /readyz`.

## Project Fields

- `name`
- `websiteUrl`
- `industry`
- `targetAudience`
- `targetCountry`
- `mainGoal`
- `mainOffer`
- `brandTone`
- `competitors`
- `owner`
- `createdAt`
- `updatedAt`

## Future Placeholders

Project pages include empty placeholders for:

- SEO Audit
- AI CMO Plan
- Content Drafts
- Reports

These sections do not run Shopify/Webflow publishing, social posting, search result scraping, fake traffic, or automatic ads features in Phase 12.

## Useful Scripts

```bash
npm start       # run the Express app
npm run dev     # run the app with nodemon
npm run worker  # optional BullMQ scan worker when DISABLE_QUEUE=false
```
