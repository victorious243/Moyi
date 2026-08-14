# Content Distribution Engine: Phase 3

Phase 3 closes the publishing loop. Moyi now collects engagement after a native post is published, records durable recovery state, exposes project analytics to the Growth Brain, supports agency client workspaces, and provides an optional scoped API.

The publishing stack remains owned by Moyi. It does not require Postiz, Ayrshare, Buffer, or a per-user scheduler API key.

## What Phase 3 Adds

- Append-only engagement snapshots for all eight native providers
- Adaptive, rate-limit-friendly metrics collection through the existing BullMQ worker
- Latest metrics and collection health on each `PublishJob` and `SocialAccount`
- Normalized `GrowthSignal` records for the Growth Brain and Data Layer
- Platform-aware retry delays, reconnect detection, dead-letter state, and durable job events
- Admin recovery controls and duplicate-risk warnings for unknown provider outcomes
- Agency workspaces with owner, admin, publisher, and analyst roles
- Cross-client publishing inside one agency with destination-level data separation
- A project Social Performance view and internal JSON endpoint
- Optional project-scoped API keys for accounts, approved publishing, job status, and analytics

## Data Model

Phase 3 adds these MongoDB models to the Phase 1 and Phase 2 records:

| Model | Purpose |
| --- | --- |
| `EngagementSnapshot` | Append-only normalized counters captured for one published job at one point in time. |
| `GrowthSignal` | Latest normalized social-performance signal consumed by the Growth Brain. |
| `PublishJobEvent` | Durable history of attempts, retries, publication, metrics failures, reconnects, and dead-letter transitions. |
| `Organization` | Agency workspace that groups client projects. |
| `OrganizationMember` | Agency membership and role. |
| `ApiCredential` | HMAC-hashed, scoped API credential. The raw key is never stored. |

`PublishJob.destinationProjectId` identifies the client workspace whose social account received the post. `PublishJob.projectId` remains the source workspace that owns the approved draft. Existing Phase 1 and Phase 2 jobs are backfilled so both values initially point to the original project.

## Metrics Collection

The publish worker registers `collect-social-engagement` every 15 minutes. Each run claims up to 100 due published jobs with a five-minute database lease and processes them sequentially to avoid bursts against provider APIs.

The next collection time depends on post age:

| Published age | Collection interval |
| --- | --- |
| Less than 6 hours | 30 minutes |
| 6 to 48 hours | 3 hours |
| 2 to 14 days | 24 hours |
| 14 to 90 days | 7 days |
| More than 90 days | Collection complete |

Rate limits and transient provider failures use exponential backoff up to 24 hours. A job stops after ten consecutive metrics failures. Reconnecting the account resets paused metrics jobs. A deleted or unavailable post stops collection only for that post and does not mark the entire account unhealthy.

Metrics are normalized to the fields providers actually return:

```text
impressions, reach, views, likes, comments, shares, quotes,
saves, clicks, videoViews, watchTimeMs
```

Unavailable fields stay absent and are recorded in `unavailableFields`; they are never converted into observed zeroes. Provider-specific metadata is depth-limited and credential-redacted before storage.

## Provider Metrics Setup

Existing accounts must reconnect when new read or insights scopes are required.

| Provider | Metrics used | Required access notes |
| --- | --- | --- |
| Bluesky | Likes, replies, reposts, quotes | Public AT Protocol post lookup; no extra scope. |
| X | Impressions when available, likes, replies, reposts, quotes, bookmarks, clicks when available | `tweet.read` and owner-authorized OAuth. Private/organic metrics gracefully fall back to public metrics. |
| LinkedIn | Reactions and comments; organization impressions, reach, shares, and clicks where approved | Community Management API access plus `r_member_social_feed` and/or `r_organization_social_feed`. Organization analytics also depends on the connected organization role. |
| Facebook Pages | Impressions, reach, clicks, likes, comments, shares | `pages_read_engagement` and `read_insights`, with approved Page access. |
| Instagram professional accounts | Views, reach, likes, comments, shares, saves | `instagram_manage_insights` and a linked Business or Creator account. |
| Threads | Views, likes, replies, reposts/shares, quotes | `threads_manage_insights`. |
| TikTok | Views, likes, comments, shares | `video.list` in addition to the Phase 2 publishing scopes. |
| YouTube | Views, likes, comments | `youtube.readonly`; unavailable or disabled counters remain absent. |

Provider review and permissions can limit metric availability even when publishing works. Moyi labels such jobs and accounts `limited` instead of fabricating complete analytics.

Official references:

- [Bluesky `app.bsky.feed.getPosts`](https://docs.bsky.app/docs/api/app-bsky-feed-get-posts)
- [X Get Post by ID](https://docs.x.com/x-api/posts/get-post-by-id)
- [LinkedIn share statistics](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/share-statistics)
- [LinkedIn Social Metadata API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/social-metadata-api)
- [TikTok Query Videos](https://developers.tiktok.com/doc/tiktok-api-v2-video-query/)
- [YouTube `videos.list`](https://developers.google.com/youtube/v3/docs/videos/list)
- [Meta Instagram API official collection](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api)
- [Meta Threads API official collection](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api)

## Reliability And Recovery

BullMQ performs one delivery attempt for a native publish job. Retry state is owned by MongoDB so queue restarts do not erase recovery decisions.

- Each provider has its own maximum attempts, base delay, and maximum delay.
- HTTP 429 responses and explicit rate-limit errors respect provider retry delays where supplied.
- Expired, revoked, or unauthorized OAuth credentials mark the account `reconnect_required` and pause publishing and metrics.
- Validation, permissions, and permanent media rejection errors go to `dead_letter` for operator review.
- A stale job that failed before provider dispatch is safely requeued.
- A stale worker or ambiguous network/server failure after provider dispatch is dead-lettered as `provider_outcome_unknown`. Check the live account before retrying because the provider may have created the post before the response was lost.
- Manual retries create `PublishJobEvent` audit records and never erase the earlier attempt history.

Project users see retry, reconnect, dead-letter, and metrics states in the Calendar. Platform admins see recovery jobs and reconnect-required accounts in `/admin`.

## Agency Workspaces

Open **Agency Workspaces** from the main navigation, create an agency, add existing Moyi users, and assign client projects owned by the agency manager.

| Role | Read client projects | Publish approved drafts | Connect accounts / manage project | Manage agency members |
| --- | --- | --- | --- | --- |
| Owner | Yes | Yes | Yes | Yes |
| Admin | Yes | Yes | Yes | Yes |
| Publisher | Yes | Yes | No | No |
| Analyst | Yes | No | No | No |

When the source draft belongs to an agency, its destination accounts are restricted to projects in that same agency. This prevents accidental cross-agency publishing. Analytics, account health, publish actions, and engagement snapshots belong to the destination client workspace. Source draft text is hidden from destination-only API consumers and Growth Brain context.

A direct project owner or project admin who is not an agency member can continue publishing that one project, but cannot use that project as a path into the agency's other clients.

## Analytics And Growth Brain

Open `/projects/PROJECT_ID/social-performance` for 7, 30, or 90-day performance. The view shows:

- published and measured post counts
- available exposure and interaction totals
- engagement rate only when an exposure denominator exists
- platform comparison and per-post live links
- publishing reliability, dead-letter jobs, and reconnect-required accounts
- account-level metrics collection health

The internal JSON version is `/projects/PROJECT_ID/social-performance/data` for authenticated UI clients.

Each successful snapshot upserts one `GrowthSignal` for the destination project. Campaign and social-draft prompts receive the strongest observed signals from the last 90 days, an evidence timestamp, and an explicit warning that provider fields differ and correlation is not causation. Cross-client signals contain metrics but not another client's draft copy.

## Public API

Create a key on `/account`. Moyi displays the complete key once, stores only its HMAC hash, and shows only its prefix afterward. Revoke a key from the same page. Authentication is:

```http
Authorization: Bearer moyi_live_PREFIX_SECRET
Content-Type: application/json
```

Start with the API root to inspect what the key can do:

```bash
curl -H "Authorization: Bearer $MOYI_API_KEY" \
  "https://YOUR_DOMAIN/api/v1"
```

Every request checks both the key's project allowlist and the key owner's current workspace role. Removing a user from an agency therefore removes their API access even if the key has not yet been revoked.

Available scopes:

| Scope | Routes |
| --- | --- |
| none | `GET /api/v1` |
| `accounts:read` | `GET /api/v1/accounts?projectId=...` |
| `publish:write` | `POST /api/v1/publish-jobs` |
| `jobs:read` | `GET /api/v1/publish-jobs/:id`, `GET /api/v1/publish-batches/:id` |
| `analytics:read` | `GET /api/v1/projects/:id/social-performance?days=30` |

List connected accounts:

```bash
curl -H "Authorization: Bearer $MOYI_API_KEY" \
  "https://YOUR_DOMAIN/api/v1/accounts?projectId=PROJECT_ID"
```

Queue an already-approved draft for immediate or scheduled publishing:

```bash
curl -X POST "https://YOUR_DOMAIN/api/v1/publish-jobs" \
  -H "Authorization: Bearer $MOYI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "SOURCE_PROJECT_ID",
    "draftId": "APPROVED_DRAFT_ID",
    "accountIds": ["CONNECTED_ACCOUNT_ID"],
    "scheduledAt": "2026-08-14T09:00:00.000Z",
    "firstComment": "Optional first comment",
    "publishOptions": {
      "youtube": { "privacyStatus": "private", "videoType": "regular" }
    }
  }'
```

The endpoint returns `202 Accepted` with one batch and one job per account. Poll a returned job ID:

```bash
curl -H "Authorization: Bearer $MOYI_API_KEY" \
  "https://YOUR_DOMAIN/api/v1/publish-jobs/PUBLISH_JOB_ID"
```

The API accepts only approved drafts and connected accounts. It never accepts raw provider tokens. A key scoped only to a destination project can read that destination job but receives `null` for the source project and draft IDs.

## Migration And Deployment

Use the same secrets and processes as Phase 2. No third-party scheduler credential is required. `TOKEN_ENCRYPTION_SECRET` also keys the API credential HMAC, so it must be stable, secret, and at least 32 random characters.

```bash
npm install
npm run migrate:distribution
npm run build:distribution
npm test
npm start
```

Production requires MongoDB, Redis, one continuously running worker, the web process, persistent S3/R2 or machine media storage, and FFmpeg/FFprobe. Deploy the migration before starting the Phase 3 worker. The migration is idempotent and creates the new indexes while backfilling Phase 1 and Phase 2 publishing records.

After deployment:

1. Run `npm run check:social`.
   The report must show the exact `/integrations/social/PLATFORM/callback` route on the same HTTPS origin as `APP_URL`; Moyi marks path, origin, and protocol mismatches invalid.
2. Reconnect test accounts to grant new metrics scopes.
3. Publish one approved test draft per provider.
4. Confirm the job reaches `published` and a metrics snapshot appears after collection.
5. Test a revoked token and confirm `reconnect_required` appears without logging the token.
6. Test a transient provider error and confirm `retry_wait` becomes a later attempt.
7. Verify destination analytics and Growth Brain context contain only fields returned by the provider.
8. Create a narrowly scoped API key, call each allowed endpoint, then revoke it.

Automated tests use provider sandboxes and never publish to a live social account. Live acceptance testing still requires real developer apps, provider review, test accounts, and current platform permissions.
