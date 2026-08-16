# Moyi AI CMO

Moyi is an AI Chief Marketing Officer workspace for evidence-led SEO growth, content execution, campaign planning, safe publishing, and reporting.

It is designed to avoid generic or hallucinated marketing advice. The system starts from recorded business and website evidence, turns that evidence into recommendations, creates reviewed content assets, supports image/logo workflows, and keeps publishing under human control.

## Table of Contents

- [What Moyi Does](#what-moyi-does)
- [How The Product Workflow Works](#how-the-product-workflow-works)
- [Local Setup Tutorial](#local-setup-tutorial)
- [Environment Variables Explained](#environment-variables-explained)
- [Redis And Background Jobs](#redis-and-background-jobs)
- [First Project Tutorial](#first-project-tutorial)
- [Website Scans](#website-scans)
- [AI CMO Plans And Recommendations](#ai-cmo-plans-and-recommendations)
- [Content Workspace Tutorial](#content-workspace-tutorial)
- [Image And Logo Workflow](#image-and-logo-workflow)
- [Campaigns And Calendar](#campaigns-and-calendar)
- [Content Distribution Engine](#content-distribution-engine)
- [Measurement And Reports](#measurement-and-reports)
- [Integrations](#integrations)
- [Email Setup](#email-setup)
- [Billing](#billing)
- [Admin And Health Checks](#admin-and-health-checks)
- [Testing](#testing)
- [Production Deployment Checklist](#production-deployment-checklist)
- [Useful Scripts](#useful-scripts)
- [Safety Boundaries](#safety-boundaries)

## What Moyi Does

Moyi combines these product areas:

- Public quick website scan for lead capture.
- Project onboarding with brand calibration.
- Factual website crawl and SEO issue storage.
- Evidence-backed AI CMO plan.
- Recommendation queue with accept, reject, restore, and execution states.
- Multi-agent content draft generation.
- High-intent SaaS templates such as comparison, alternatives, and product-led guides.
- Content image generation and manual image uploads.
- Project-level official logo storage for branded visuals.
- Human-approved native social publishing, scheduling, and engagement analytics.
- Agency workspaces for publishing across separated client projects.
- Google Search Console query/page opportunity analysis.
- WordPress, Webflow, Shopify draft publishing.
- Outgoing approved-content webhooks.
- SMTP email for account and customer communication.
- Stripe billing with monthly and yearly plan options.
- Production health/readiness checks.

Moyi does not publish unapproved content, take live action without an explicit publish command or schedule, scrape private competitor data, guarantee rankings, or invent missing metrics.

## How The Product Workflow Works

The main workflow is:

1. Create a project for a real business.
2. Run a website scan.
3. Review and approve the discovered brand profile.
4. Upload the official transparent PNG logo.
5. Generate the AI CMO plan.
6. Review recommendations.
7. Accept recommendations worth doing.
8. Generate content or pipeline assets.
9. Review copy in the Write step.
10. Generate or upload visuals in the Visual step.
11. Approve, request changes, or reject in the Review step.
12. Export, create CMS drafts, or publish an approved social draft now or on a schedule.
13. Use social performance, the calendar, and reports to feed observed results into the next planning cycle.

## Local Setup Tutorial

### 1. Install Requirements

You need:

- Node.js 20 or newer.
- MongoDB local or Atlas.
- Redis for production-style background jobs.
- OpenAI API key for AI generation.
- SMTP provider for password reset and customer emails.
- Stripe keys for billing.
- Google OAuth credentials for Search Console.

### 2. Install Dependencies

```bash
npm install
```

### 3. Create Your Environment File

```bash
cp .env.example .env
```

Edit `.env` and fill the values explained below.

### 4. Run Locally

For simple local development without Redis jobs:

```bash
npm run dev
```

For production-like local behavior with web app plus worker:

```bash
npm start
```

Open:

```text
http://localhost:3000
```

Do not change the port unless your deployment requires it. Moyi defaults to `3000`.

## Environment Variables Explained

### Core App

```env
APP_NAME="Moyi AI CMO"
NODE_ENV=development
PORT=3000
APP_URL=http://localhost:3000
TRUST_PROXY_HOPS=0
COOKIE_DOMAIN=
RELEASE_SHA=
```

- `APP_NAME`: Display name used in emails and pages.
- `NODE_ENV`: Use `production` only in deployment.
- `PORT`: Express server port.
- `APP_URL`: Public base URL. In production this must be HTTPS.
- `TRUST_PROXY_HOPS`: Set to `1` or higher behind a proxy/load balancer.
- `COOKIE_DOMAIN`: Optional shared cookie domain for subdomains.
- `RELEASE_SHA`: Optional deployment identifier shown in health checks.

### MongoDB

```env
MONGODB_URI=mongodb://127.0.0.1:27017/moyi
MONGODB_DB=moyi
```

Atlas alternative:

```env
MONGODB_HOST=cluster0.xxxxx.mongodb.net
MONGODB_USER=moyi_user
MONGODB_PASSWORD=raw-password-here
MONGODB_QUERY=retryWrites=true&w=majority&appName=Cluster0
MONGODB_DB=moyi
```

Use the Atlas split variables when your password contains special characters and you want Moyi to encode them safely.

### Security

```env
JWT_SECRET=replace-with-a-long-random-secret
TOKEN_ENCRYPTION_SECRET=replace-with-a-long-random-secret
```

- `JWT_SECRET`: Signs authentication cookies.
- `TOKEN_ENCRYPTION_SECRET`: Encrypts third-party tokens and credentials.

In production, both must be long random values with at least 32 characters.

### OpenAI

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
OPENAI_SEARCH_MODEL=gpt-5.4-nano
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_QUALITY=medium
OPENAI_IMAGE_SIZE=1536x1024
CONTENT_AI_TIMEOUT_MS=60000
CONTENT_PIPELINE_CONCURRENCY=3
MAX_AI_OPERATIONS_PER_MONTH=500
```

- `OPENAI_API_KEY`: Required for AI CMO plans, content generation, and images.
- `OPENAI_MODEL`: Text model used by planning and content flows.
- `OPENAI_SEARCH_MODEL`: Responses API model used for web-backed competitor candidate discovery. Candidates are still verified against public crawled-page evidence before reports are created.
- `OPENAI_IMAGE_MODEL`: Image model used for generated visuals.
- `OPENAI_IMAGE_QUALITY`: `low`, `medium`, `high`, or `auto`.
- `OPENAI_IMAGE_SIZE`: Example `1536x1024`, `1024x1024`, or `auto`.
- `CONTENT_AI_TIMEOUT_MS`: Timeout for content pipeline calls.
- `CONTENT_PIPELINE_CONCURRENCY`: Parallel content pipeline limit, between 1 and 5.
- `MAX_AI_OPERATIONS_PER_MONTH`: Global safety ceiling per user.

### Image Storage

```env
CONTENT_IMAGE_STORAGE_PROVIDER=machine
CONTENT_IMAGE_STORAGE_PATH=/var/lib/moyi/content-images
```

Moyi does not save image binaries in MongoDB. Generated images, uploaded images, and project logos are saved as private files. MongoDB stores metadata and storage keys only.

In production this path must point to a persistent writable volume.

To store new images and logos in an S3-compatible bucket instead:

```env
CONTENT_IMAGE_STORAGE_PROVIDER=s3
S3_BUCKET=your-bucket-name
S3_REGION=eu-west-1
S3_ENDPOINT=
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
S3_FORCE_PATH_STYLE=true
```

Leave `S3_ENDPOINT` empty for AWS S3. Set it for S3-compatible providers such as Cloudflare R2, DigitalOcean Spaces, or Backblaze B2. Moyi stores private objects under `content-images/` and serves them through authenticated application routes.

### Redis And Queues

```env
DISABLE_QUEUE=false
REDIS_URL=redis://default:password@host:port
WORKER_CONCURRENCY=2
```

- `DISABLE_QUEUE=true`: Development-only shortcut. Jobs run inline where supported.
- `DISABLE_QUEUE=false`: Required for production.
- `REDIS_URL`: Redis connection string.
- `WORKER_CONCURRENCY`: Number of background jobs handled by one worker process.

### Crawling

```env
CRAWL_TIMEOUT_MS=12000
CRAWL_DELAY_MS=150
MAX_PAGES_PER_SCAN=50
```

- `CRAWL_TIMEOUT_MS`: Per-request crawl timeout.
- `CRAWL_DELAY_MS`: Delay between crawl requests.
- `MAX_PAGES_PER_SCAN`: Hard page cap per scan.

### Google Search Console

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/integrations/google/callback
```

Configure the same redirect URI in Google Cloud OAuth settings.

### One-Click Social Publishing

```env
APP_URL=http://localhost:3000
TOKEN_ENCRYPTION_SECRET=replace-with-at-least-32-random-characters
BLUESKY_REDIRECT_URI=http://localhost:3000/integrations/social/bluesky/callback
BLUESKY_PRIVATE_JWK=
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_REDIRECT_URI=http://localhost:3000/integrations/social/linkedin/callback
LINKEDIN_API_VERSION=202607
LINKEDIN_SCOPES=openid profile email w_member_social
TWITTER_CLIENT_ID=
TWITTER_CLIENT_SECRET=
TWITTER_REDIRECT_URI=http://localhost:3000/integrations/social/x/callback
META_APP_ID=
META_APP_SECRET=
META_REDIRECT_URI=http://localhost:3000/integrations/social/meta/callback
META_WEBHOOK_VERIFY_TOKEN=
SOCIAL_ENABLE_META=false
THREADS_APP_ID=
THREADS_APP_SECRET=
THREADS_REDIRECT_URI=http://localhost:3000/integrations/social/threads/callback
SOCIAL_ENABLE_THREADS=false
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
TIKTOK_REDIRECT_URI=http://localhost:3000/integrations/social/tiktok/callback
SOCIAL_ENABLE_TIKTOK=false
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REDIRECT_URI=http://localhost:3000/integrations/social/youtube/callback
SOCIAL_ENABLE_YOUTUBE=false
MEDIA_STORAGE_PROVIDER=machine
MEDIA_STORAGE_PATH=./storage/social-media
MEDIA_UPLOAD_TEMP_PATH=./storage/media-uploads
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
REDIS_URL=redis://127.0.0.1:6379
DISABLE_QUEUE=false
```

This is Moyi's own publishing layer. It does not use Postiz, Ayrshare, or a scheduler API key. MongoDB stores the account, batch, job, and media records; BullMQ and Redis execute immediate and delayed work. OAuth access and refresh tokens are AES-GCM encrypted with `TOKEN_ENCRYPTION_SECRET` and are never sent to the browser.

Create the indexes, build the TypeScript adapters, and run the web and worker processes:

```bash
npm run migrate:distribution
npm run build:distribution
npm start
```

`npm start` supervises both processes when `DISABLE_QUEUE=false`. For separate local terminals, run `npm run web` and `npm run worker`. `npm run dev` deliberately disables Redis and executes due-now jobs inline; delayed schedules require the worker.

Run this before a live posting test:

```bash
npm run check:social
```

Provider setup checklist:

- Bluesky: localhost uses the [AT Protocol OAuth loopback client](https://atproto.com/guides/oauth-tutorial) automatically. For production, run `npm run generate:bluesky-key`, store the one-line JSON result as the secret `BLUESKY_PRIVATE_JWK`, and expose `/oauth-client-metadata.json` plus `/.well-known/jwks.json` on the public HTTPS domain. Users connect by entering their Bluesky handle.
- X: create an [OAuth 2.0 app](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code) with OAuth 2.0 enabled, app type set to Web App or Automated App, and app permissions set to Read and write. Register the exact X callback, including protocol and no trailing slash unless the env var also has it: `https://moyi-cmo.com/integrations/social/x/callback`. Set `TWITTER_CLIENT_ID` and `TWITTER_CLIENT_SECRET` from the OAuth 2.0 Client ID/Secret section for that same app, not the OAuth 1.0a API Key/Secret. Moyi requests `tweet.read`, `tweet.write`, `users.read`, `media.write`, and `offline.access`; connected X accounts must be reconnected after adding `media.write`.
- LinkedIn: add Sign In with LinkedIn using OpenID Connect and Share on LinkedIn. Personal publishing needs `w_member_social`. Organization discovery and publishing also need approved access to `rw_organization_admin` and `w_organization_social`. Publishing uses LinkedIn's versioned [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api) and [Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api). Some LinkedIn apps do not receive refresh tokens; those accounts are marked for reconnection before expiry instead of retaining an expired credential.
- Meta: one OAuth flow discovers manageable Facebook Pages and linked Instagram Business or Creator accounts. In the Meta app dashboard, add `moyi-cmo.com` to App Domains and add the exact Facebook Login redirect URI: `https://moyi-cmo.com/integrations/social/meta/callback`. Request Page and Instagram permissions for publishing, engagement, comments, and insights: `pages_show_list`, `pages_read_engagement`, `read_insights`, `pages_manage_posts`, `pages_manage_engagement`, `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, and `instagram_manage_insights`. Instagram publishing only works for professional accounts linked to a Facebook Page that the connecting user can manage. Keep `SOCIAL_ENABLE_META=false` until review and live tests are complete; set it to `true` when you are ready to connect real Facebook and Instagram accounts.
- Threads: configure the Threads API use case and its separate callback, request basic/content-publish/reply permissions, then enable `SOCIAL_ENABLE_THREADS` after review.
- TikTok: add Login Kit and Content Posting API with `user.info.basic` and `video.publish`. Moyi queries creator choices before each post and polls processing status. Unaudited apps are private-only.
- YouTube: enable YouTube Data API v3 and create a Web OAuth client with upload/read scopes. Moyi uses resumable video uploads; unaudited API projects may have uploads forced private.
- Production: use the public HTTPS domain in `APP_URL` and in every provider callback, for example `https://moyi-cmo.com/integrations/social/x/callback`.

Phase 2 requires Redis plus a running worker and FFmpeg/FFprobe on the media-worker host. Full OAuth permissions, S3/R2 setup, platform review notes, and per-provider test steps are in [the Phase 2 distribution guide](docs/content-distribution-phase-2.md).

### Content Distribution Engine

Phase 3 collects rate-limit-friendly engagement snapshots after publication, adds provider-aware retries and dead-letter recovery, supports agency client workspaces, feeds normalized performance signals into the Growth Brain, and exposes an optional project-scoped API. The complete role matrix, collection cadence, recovery behavior, provider metrics permissions, migration sequence, and API examples are in [the Phase 3 closed-loop guide](docs/content-distribution-phase-3.md).

End-to-end test for each provider:

1. Open a project's `Social Accounts` page and connect the provider.
2. Create a social draft, select or upload one JPEG, PNG, or WebP image, and approve it.
3. Select one or more connected accounts in the calendar publish panel.
4. Choose `Now` or `Schedule`, submit, and watch each job move through `queued`, `publishing`, then `published`; recoverable failures move through `retry_wait` and permanent failures move to `dead_letter`.
5. Open `View post`, then review collected metrics on Social Performance. Reconnect an expired account or retry a dead-letter job only after correcting its account, content, or media.

Run the automated adapter, model, approval-gate, and queue contract tests with `npm test`. Live provider tests still require real developer credentials and provider approval; the test suite never makes a real social post.

### Stripe

```env
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_STARTER_PRICE_ID=
STRIPE_PRO_PRICE_ID=
STRIPE_AGENCY_PRICE_ID=
STRIPE_STARTER_ANNUAL_PRICE_ID=
STRIPE_PRO_ANNUAL_PRICE_ID=
STRIPE_AGENCY_ANNUAL_PRICE_ID=
```

Moyi expects monthly and yearly recurring Price IDs for Starter, Pro, and Agency.

### SMTP Email

```env
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM="Moyi-CMO <no_reply@moyi-cmo.com>"
EMAIL_TEST_TO=
SUPPORT_EMAIL=
```

The sender address/domain must be verified in your SMTP provider. If Brevo rejects the sender, authenticate the domain or use a verified sender.

## Redis And Background Jobs

Production users will run scans and AI jobs at the same time. That requires Redis and BullMQ workers.

### Recommended Production Setup

1. Set `DISABLE_QUEUE=false`.
2. Set `REDIS_URL` to your managed Redis URL.
3. Run `npm start`.
4. Confirm `/readyz` returns healthy queue state.
5. Increase `WORKER_CONCURRENCY` carefully if jobs queue up.

### When To Run Extra Workers

Run extra workers only when you need more throughput:

```bash
npm run worker
```

Examples:

- More website scans are waiting than one worker can process.
- AI CMO reports queue during busy periods.
- Content generation pipelines are slow because many users submit at once.

Start conservative. Too much concurrency can overload the server, Redis, OpenAI limits, or crawler targets.

## First Project Tutorial

### Option A: Scan And Prefill

Use this for most new customers.

1. Sign in.
2. Open `Projects`.
3. Click `Add Project`.
4. Use the scan/prefill form.
5. Enter the business website URL.
6. Wait for discovery.
7. Review the calibration screen.
8. Edit tone, value props, personas, or competitors if needed.
9. Activate the workspace.
10. Open project settings and upload the transparent PNG logo.

### Option B: Manual Business Profile

Use this when you already know the brand details.

1. Open `Projects`.
2. Click `Add Project`.
3. Fill project name, website URL, industry, audience, target country, main offer, tone, goal, and competitors.
4. Upload the official transparent PNG logo.
5. Click `Create Project`.

Manual creation requires the logo because Moyi uses it later for branded visuals.

## Website Scans

A scan collects crawlable website evidence.

Routes and pages:

- `POST /projects/:id/scans`
- `GET /projects/:id/scans`
- `GET /projects/:id/scans/:scanId`
- `GET /projects/:id/pages`

The crawler records:

- Status code.
- Page title.
- Meta description.
- H1 and H2 headings.
- Canonical URL.
- Robots meta.
- Word count.
- Internal and external links.
- Image count and missing alt text.
- Open Graph fields.
- JSON-LD schema types.
- Crawl timestamp.

### How To Use Scan Results

1. Run a scan after creating or approving a project.
2. Wait for the scan to complete.
3. Review failed pages first.
4. Review critical issues and warnings.
5. Check pages with weak title/meta/H1/content depth.
6. Generate or regenerate recommendations from the completed scan.

If a scan stays pending, check Redis, the worker process, and `/readyz`.

## AI CMO Plans And Recommendations

The AI CMO plan turns available evidence into a ranked action queue.

Routes:

- `POST /projects/:id/ai-report`
- `GET /projects/:id/ai-report/latest`
- `GET /projects/:id/recommendations`
- `POST /recommendations/:id/status`

### Recommendation Actions

- `Accept`: Moves the recommendation into active execution.
- `Reject`: Removes it from active work without deleting history.
- `Restore`: Brings a rejected recommendation back.
- `Generate Full Pipeline`: Creates execution assets from the recommendation.
- `Manage recommendations`: Opens the full queue.

### How To Review Recommendations

1. Confirm the latest scan completed.
2. Open Recommendations.
3. Read the target page, reason, evidence, priority, and effort.
4. Accept only the work you want Moyi to execute.
5. Reject recommendations that are not useful now.
6. Generate content or pipeline assets from accepted recommendations.

Recommendations must stay tied to real pages, scan findings, competitor facts, or Search Console metrics.

## Content Workspace Tutorial

Every content draft has four tabs:

### 1. Write

Use this step to review and edit:

- Keyword.
- Title.
- Business goal.
- Target persona.
- Search intent.
- Primary CTA.
- Proof points.
- Body copy.
- JSON-LD where relevant.

Save changes before moving forward.

### 2. Visual

Use this step to:

- Generate a content-matched image.
- Upload a user-provided image.
- Use an existing image as a reference.
- Preview image and post copy together.
- Save alt text.
- Save caption.
- Select the final image.
- Reject weak candidates.
- Restore rejected candidates.

### 3. Review

Use this step to decide whether the asset is ready.

Options:

- `Approve and Continue`: Unlocks distribution controls.
- `Request Changes`: Marks the draft as needing revision.
- `Reject`: Rejects the asset.
- `Return to Review`: Brings a rejected or revision draft back to review.

Approval does not publish anything live.

### 4. Distribute

Use this step to:

- Create WordPress draft.
- Create Webflow draft.
- Create Shopify draft.
- Copy content.
- Export content.
- Create social drafts.
- Plan campaign.
- Record manual publication.

CMS options appear only when the project integration is connected and the content type is eligible.

## Content Template Options

Supported content styles include:

- `meta_title`: Search-result title draft.
- `meta_description`: Search-result description draft.
- `h1`: Page H1 improvement.
- `faq_section`: FAQ expansion and objection handling.
- `blog_outline`: Article structure.
- `blog_article`: Full article draft.
- `service_page_section`: Website section copy.
- `internal_linking_plan`: Internal links to add or improve.
- `schema_jsonld`: Structured data draft.
- `vs_comparison_article`: Compares your product against a competitor.
- `alternatives_list`: Positions your product among alternatives.
- `product_led_guide`: Educational content that naturally uses your product as the solution.

Use high-intent templates for SaaS and service businesses that need content with buying intent, not generic information.

## Image And Logo Workflow

### Project Logo

The project logo is the official brand reference.

Requirements:

- PNG only.
- Must have real transparency.
- No background.
- Maximum 2 MB.
- Stored as a private file, not inside MongoDB.

How to upload:

1. Open the project.
2. Open project edit/settings.
3. Upload the transparent PNG logo.
4. Save changes.
5. In content image art direction, mention `logo`, `brand mark`, `wordmark`, or similar when you want Moyi to use it.

Example art direction:

```text
Create a premium family broadband campaign image. Include the official logo in the top-left corner. Keep the logo clean and unchanged. Show a happy family using fast internet at home.
```

Important: prompt text alone cannot guarantee logo fidelity. The stored logo gives the image model an actual reference.

### Draft Image Candidates

For each content draft, users can:

- Upload JPG, PNG, or WebP images.
- Generate AI images.
- Use one candidate as a reference for another.
- Save alt text and captions.
- Select exactly one final image.
- Download, reject, or restore candidates.

Images are protected by project access controls.

## Campaigns And Calendar

Campaigns help Moyi behave like an organized CMO, not a random content generator.

Routes:

- `GET /projects/:id/calendar`
- `GET /projects/:id/campaigns`
- `POST /projects/:id/campaigns`
- `POST /content/:id/create-social-drafts`
- `POST /social-drafts/:id/approve`
- `POST /social-drafts/:id/mark-published`

### Campaign Planning Options

- `Single post`: Creates one draft.
- `Weekly plan`: Creates five scheduled posts.
- `Monthly plan`: Creates twelve scheduled posts across about thirty days.
- `Create social drafts`: Turns approved content into social/email drafts.
- `Open calendar`: Shows scheduled work in one place.
- `Mark as published`: Records manual publication after it happens elsewhere.

### Recommended Weekly Workflow

1. Open the project workspace.
2. Review active recommendations.
3. Generate or edit one core content asset.
4. Approve the final asset.
5. Create social drafts from it.
6. Plan the weekly campaign.
7. Review the calendar.
8. Manually publish or send through the appropriate external system.
9. Mark publication in Moyi.
10. Review results in weekly report.

## Measurement And Reports

### Search Console

Routes:

- `GET /integrations`
- `GET /integrations/google/connect`
- `GET /integrations/google/callback`
- `GET /projects/:id/search-console/connect`
- `POST /projects/:id/search-console/property`
- `POST /projects/:id/search-console/sync`
- `GET /projects/:id/search-console/performance`

Moyi syncs:

- Query.
- Page.
- Country.
- Device.
- Date.
- Clicks.
- Impressions.
- CTR.
- Average position.

### GSC Opportunities

- `Boost CTR`: Page-one queries, positions 1-10, with CTR below the project average. Action: improve meta title or description.
- `Push to Page 1`: Page-two queries, positions 11-20, with high impressions. Action: improve target page content, headings, FAQs, and internal links.

### Reports

Routes:

- `POST /projects/:id/reports/weekly`
- `POST /projects/:id/reports/monthly`
- `GET /projects/:id/reports`
- `GET /projects/:id/reports/:reportId`

Reports can include:

- Executive summary.
- Organic search performance.
- Click, impression, CTR, and position comparison.
- Top gaining and losing pages.
- Top gaining queries.
- Low CTR opportunities.
- Completed content actions.
- Open recommendations.
- Next 7-day and 30-day action plans.
- Warnings and limitations.

Reports should be treated as decision documents. They do not prove causation or guarantee outcomes.

## Integrations

### WordPress

Routes:

- `GET /projects/:id/integrations/wordpress`
- `POST /projects/:id/integrations/wordpress/connect`
- `POST /projects/:id/integrations/wordpress/test`
- `GET /projects/:id/integrations/wordpress/pages`
- `POST /content/:id/publish/wordpress-draft`

Rules:

- Approved content only.
- Creates draft posts.
- Does not overwrite existing pages.
- Credentials are encrypted.

### Webflow

Routes:

- `GET /projects/:id/integrations/webflow`
- `POST /projects/:id/integrations/webflow/connect`
- `POST /projects/:id/integrations/webflow/test`
- `POST /content/:id/publish/webflow-draft`

Requires Webflow API token and CMS collection mapping.

### Shopify

Routes:

- `GET /projects/:id/integrations/shopify`
- `POST /projects/:id/integrations/shopify/connect`
- `POST /projects/:id/integrations/shopify/test`
- `POST /content/:id/publish/shopify-draft`

Requires Shopify shop domain, blog ID, API version, and access token.

### Social Accounts

Routes:

- `GET /projects/:id/integrations/social`
- `GET /integrations/social/bluesky/connect`
- `GET /integrations/social/linkedin/connect`
- `GET /integrations/social/x/connect`
- `GET /integrations/social/meta/connect`
- `GET /integrations/social/threads/connect`
- `GET /integrations/social/tiktok/connect`
- `GET /integrations/social/youtube/connect`
- `POST /social-drafts/:id/media/upload`
- `GET /social-drafts/:id/media-status`
- `POST /social-drafts/:id/approve-and-publish`
- `GET /social-drafts/:id/publish-status`
- `POST /social-drafts/:id/publish-jobs/:jobId/retry`
- `POST /social-drafts/publish-all-connected`

Rules:

- Users connect Bluesky, X, LinkedIn, Facebook, Instagram, Threads, TikTok, or YouTube with OAuth.
- Tokens and Bluesky OAuth sessions are encrypted before storage.
- Drafts must pass the human approval gate before live publishing.
- One `PublishBatch` creates one durable `PublishJob` per selected account.
- The native adapters support platform-appropriate text, image, video, carousel, first-comment, immediate, and scheduled publishing.
- Images and videos are processed asynchronously into 1:1, 4:5, 9:16, and 16:9 variants before a waiting job is released.

### Outgoing Webhook

Set the project webhook URL in project settings.

When a draft is approved, Moyi sends a JSON payload with:

- Draft title.
- HTML body.
- Metadata.
- Keywords.
- Project context.

Security:

- Header: `X-Moyi-Signature`.
- Algorithm: HMAC-SHA256.
- Secret: project-specific webhook signing secret.

Verify the signature before accepting the payload in your custom frontend.

## Email Setup

Moyi uses SMTP for:

- Password reset PIN/email.
- Customer notifications.
- Support/contact communication.
- Newsletter or future customer messaging.

Brevo example:

```env
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_brevo_smtp_user
SMTP_PASS=your_brevo_smtp_password
SMTP_FROM="Moyi-CMO <no_reply@moyi-cmo.com>"
EMAIL_TEST_TO=you@example.com
SUPPORT_EMAIL=customersupport@moyi-cmo.com
```

If email does not send:

1. Check SMTP username and password.
2. Confirm the sender is verified.
3. Authenticate the sending domain with SPF, DKIM, and DMARC.
4. Check provider logs.
5. Send a test email.

## Billing

Plans are configured in `config/plans.js`.

Launch pricing:

- Starter monthly: EUR 49.
- Pro monthly: EUR 129.
- Agency monthly: EUR 299.
- Starter yearly: EUR 490.
- Pro yearly: EUR 1290.
- Agency yearly: EUR 2990.

Yearly billing gives two months free.

Routes:

- `GET /pricing`
- `GET /billing`
- `POST /billing/create-checkout-session`
- `POST /billing/create-portal-session`
- `POST /webhooks/stripe`

Stripe webhook signatures are verified with `STRIPE_WEBHOOK_SECRET`.

## Admin And Health Checks

Health endpoints:

- `GET /healthz`: Liveness, uptime, environment, release.
- `GET /readyz`: MongoDB, queue, configuration problems, and integration warnings.

Use `/readyz` for deployment readiness checks.

In production, a `503 /readyz` means the deployment is not ready.

## Testing

Run the full test suite:

```bash
npm test
```

Run syntax checks manually when editing specific files:

```bash
node --check services/projectLogoService.js
node --check routes/content.js
```

Render checks for EJS can be done with:

```bash
node - <<'NODE'
const ejs = require('ejs');
const fs = require('fs');
for (const file of ['views/projects/new.ejs', 'views/content/show.ejs']) {
  ejs.compile(fs.readFileSync(file, 'utf8'), { filename: file });
  console.log(`${file} ok`);
}
NODE
```

## Production Deployment Checklist

Before launch:

- Set `NODE_ENV=production`.
- Set `APP_URL` to the public HTTPS URL.
- Set strong `JWT_SECRET`.
- Set strong `TOKEN_ENCRYPTION_SECRET`.
- Configure production MongoDB.
- Configure Redis and set `DISABLE_QUEUE=false`.
- Confirm `npm start` runs web and worker processes.
- Set `TRUST_PROXY_HOPS=1` or higher behind a proxy.
- Configure persistent `CONTENT_IMAGE_STORAGE_PATH`.
- Configure OpenAI key and model settings.
- Configure SMTP with verified sender/domain.
- Configure Stripe live keys and all six Price IDs.
- Add Stripe webhook endpoint: `https://your-domain.com/webhooks/stripe`.
- Configure Google OAuth redirect URI if Search Console is used.
- Verify WordPress/Webflow/Shopify credentials per project where needed.
- Review Terms, Privacy, and Cookie pages.
- Add analytics/tracker language to customer-facing notices if using first-party tracking.
- Run `npm test`.
- Check `/readyz`.

## Useful Scripts

```bash
npm start       # run Express and supervised worker
npm run web     # run only the Express app
npm run dev     # run development server with nodemon
npm run worker  # run an extra BullMQ worker
npm test        # run all tests
```

## Safety Boundaries

Moyi must stay honest.

It should not:

- Invent scan findings.
- Invent traffic, clicks, impressions, conversions, or revenue.
- Invent testimonials, awards, locations, prices, or certifications.
- Claim guaranteed rankings.
- Copy competitor content.
- Auto-publish live content without explicit human review.
- Store image binaries in MongoDB.
- Use fake logos when the official logo is missing.

When data is missing, Moyi should say what is missing and what the user needs to connect, scan, or configure next.
