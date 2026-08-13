# Content Distribution Engine: Phase 2

Moyi owns this publishing stack. It does not use Postiz, Ayrshare, Buffer, or a per-user scheduler API key. OAuth credentials are encrypted in MongoDB, BullMQ executes publishing and media work, and S3/R2 or a persistent machine volume stores originals and generated variants.

## What Phase 2 Adds

- Facebook Pages and Instagram Business/Creator accounts through the Meta Graph API
- Threads profiles
- TikTok video and photo posts through the Content Posting API
- YouTube regular videos and Shorts
- Image, video, carousel, and per-account media selection
- Best-effort first comments on Facebook, Instagram, and LinkedIn
- Asynchronous image and FFmpeg video variants for 1:1, 4:5, 9:16, and 16:9
- Provider processing states and structured Meta/TikTok rejection messages
- Feature flags so reviewed providers can be enabled independently

## Runtime Architecture

The web process only validates and stores an upload, creates a `MediaAsset`, and enqueues `process-media-asset`. It never runs FFmpeg in the request thread. The media worker probes videos with FFprobe, stores the original, creates four H.264/AAC MP4 variants, and releases any `PublishJob` waiting in `preparing_media`.

The publish worker selects the best ready variant for each platform. Meta and Threads receive expiring signed public URLs. TikTok videos and YouTube videos use direct/resumable uploads. TikTok photo posts use signed public URLs. TikTok jobs remain in `provider_processing` until its status endpoint reports completion or rejection.

## Prerequisites

- Node.js 20.19 or newer
- MongoDB
- Redis with `DISABLE_QUEUE=false`
- FFmpeg and FFprobe on every media-worker host
- A public HTTPS `APP_URL` for Meta, Threads, and TikTok photo ingestion
- A persistent media volume, S3, or Cloudflare R2

On Ubuntu/Debian, install the media tools with:

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg
ffmpeg -version
ffprobe -version
```

Configure local storage:

```env
MEDIA_STORAGE_PROVIDER=machine
MEDIA_STORAGE_PATH=/var/lib/moyi/social-media
MEDIA_UPLOAD_TEMP_PATH=/var/lib/moyi/media-uploads
MEDIA_MAX_UPLOAD_MB=512
MEDIA_WORKER_CONCURRENCY=1
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
```

Or configure S3/R2:

```env
MEDIA_STORAGE_PROVIDER=s3
S3_BUCKET=moyi-media
S3_REGION=auto
S3_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=true
```

Objects remain private. Moyi streams authenticated previews and generates HMAC-signed, expiring URLs only when a provider must fetch media.

## Database and Processes

Run the idempotent migration, compile the TypeScript adapters, and launch the web and worker processes:

```bash
npm run migrate:distribution
npm run build:distribution
npm start
```

For separate processes:

```bash
npm run web
npm run worker
```

The worker is mandatory for video processing and scheduled publishing. `npm run dev` disables the queue and is not a complete Phase 2 runtime.

## Meta: Facebook and Instagram

1. Create a Meta developer app suitable for business integrations.
2. Add Facebook Login and the Instagram Graph API/content publishing use case.
3. Add the bare production host, such as `moyi-cmo.com`, to Meta **App Domains** and configure the matching HTTPS website URL. Do not place a path or protocol in App Domains.
4. Register the exact callback shown on Moyi's Social Accounts page, normally `https://YOUR_DOMAIN/integrations/social/meta/callback`, in **Valid OAuth Redirect URIs**.
5. Request advanced access/app review for `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_engagement`, `instagram_basic`, `instagram_content_publish`, and `instagram_manage_comments`.
6. Ensure each Instagram account is Business or Creator and is linked to a Facebook Page managed by the connecting user.
7. Add test users, Pages, and Instagram accounts while the Meta app is in development mode.
8. Enable the provider only after the app is ready for the intended users.

```env
META_APP_ID=...
META_APP_SECRET=...
META_REDIRECT_URI=https://YOUR_DOMAIN/integrations/social/meta/callback
META_GRAPH_VERSION=v25.0
SOCIAL_ENABLE_META=true
```

One Meta authorization can create several Moyi accounts: one `facebook` target per manageable Page and one `instagram` target per linked professional account. Instagram publishing follows the required create-container, wait-for-container, and publish-container sequence. Facebook video publishing waits for the asynchronous video status before attempting a first comment.

Meta reference: [Instagram content publishing collection](https://www.postman.com/meta/instagram/request/23987686-299b176b-90aa-4d8a-b6cf-e6028fc69de5).

## Threads

1. Create or configure a Meta app with the Threads API use case.
2. Register `https://YOUR_DOMAIN/integrations/social/threads/callback`.
3. Request `threads_basic`, `threads_content_publish`, `threads_manage_replies`, and `threads_read_replies`.
4. Configure permitted testers while the app is in development, then complete review for public users.
5. Add the app credentials and enable the provider.

```env
THREADS_APP_ID=...
THREADS_APP_SECRET=...
THREADS_REDIRECT_URI=https://YOUR_DOMAIN/integrations/social/threads/callback
THREADS_GRAPH_VERSION=v1.0
SOCIAL_ENABLE_THREADS=true
```

Moyi supports text, image, video, and mixed carousels of up to 20 items. Media publishing uses public URLs and the Threads create-container then publish-container flow.

Threads reference: [official Threads API collection](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api).

## TikTok

1. Create a TikTok developer app and add Login Kit plus the Content Posting API.
2. Register `https://YOUR_DOMAIN/integrations/social/tiktok/callback` and verify the production domain/media URL prefix required by TikTok.
3. Request `user.info.basic` and `video.publish`.
4. Complete Direct Post audit before enabling public visibility for customer posts.
5. Set the audit flag only after TikTok confirms approval.

```env
TIKTOK_CLIENT_KEY=...
TIKTOK_CLIENT_SECRET=...
TIKTOK_REDIRECT_URI=https://YOUR_DOMAIN/integrations/social/tiktok/callback
TIKTOK_APP_AUDITED=false
SOCIAL_ENABLE_TIKTOK=true
```

Before every post, Moyi queries creator info and makes the user choose one of TikTok's returned privacy values. It never selects visibility by default. The UI also captures comment/Duet/Stitch choices, commercial-content disclosure, and music-usage consent. Unaudited clients are restricted to private posting, so keep `TIKTOK_APP_AUDITED=false` until review is complete.

Video posts use direct chunked upload. Photo posts use `PULL_FROM_URL`, so `APP_URL` must be public HTTPS and TikTok must be able to fetch the signed media URL. Moyi polls the publish-status endpoint and maps rejection reasons back onto the draft.

TikTok references: [Direct Post API](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post), [media transfer](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide), [photo posts](https://developers.tiktok.com/doc/content-posting-api-reference-photo-post/), [status polling](https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status), and [UX/audit guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines/).

## YouTube

1. Create a Google Cloud project and enable YouTube Data API v3.
2. Configure the OAuth consent screen and add a Web application OAuth client.
3. Register `https://YOUR_DOMAIN/integrations/social/youtube/callback`.
4. Request `openid`, `profile`, `youtube.upload`, and `youtube.readonly`.
5. Add test users during development and complete Google OAuth verification where required.
6. Complete the YouTube API audit before relying on public uploads from a production project.

```env
YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...
YOUTUBE_REDIRECT_URI=https://YOUR_DOMAIN/integrations/social/youtube/callback
YOUTUBE_API_AUDITED=false
SOCIAL_ENABLE_YOUTUBE=true
```

Moyi uses the resumable upload protocol and can attach one processed image as a custom thumbnail. A Short must use the 9:16 variant and be no longer than three minutes; regular videos use 16:9. YouTube projects that have not passed the required audit may have API uploads forced to private regardless of Moyi's selected visibility.

YouTube references: [resumable uploads](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol), [`videos.insert`](https://developers.google.com/youtube/v3/docs/videos/insert), and [three-minute Shorts](https://support.google.com/youtube/answer/15424877?hl=en-EN).

## LinkedIn Phase 2 Media

LinkedIn now supports multi-image posts, multipart video upload/finalization, and a best-effort first comment. Organization posts still require `rw_organization_admin` plus approved organization publishing permissions. Comment creation can require the newer member/organization social-feed scopes; when LinkedIn rejects only the comment, Moyi keeps the post published and shows a warning.

LinkedIn references: [Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api), [Videos API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api), and [Comments API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/comments-api).

## Functional Test Checklist

For every enabled provider:

1. Connect a test account from a project's Social Accounts page.
2. Create and approve a social draft.
3. Upload an image or video and wait for all variants to show `ready`.
4. Select the account and its media in the Publish panel.
5. Complete platform options, choose Now or Schedule, and submit.
6. Confirm `queued -> publishing -> published`, or TikTok's `provider_processing -> published` path.
7. Open the live-post URL and verify the copy, media order, and first comment.
8. Test an intentionally invalid file and confirm the draft shows a useful provider rejection.

Automated checks never publish to live accounts:

```bash
npm run typecheck
npm test
npm audit
```

## Operational Notes

- Keep all `SOCIAL_ENABLE_*` flags false until credentials, review, and live-account tests are complete.
- Never log access tokens, refresh tokens, OAuth codes, signed media URLs, or provider request headers.
- Run at least one worker continuously; monitor Redis, media queue failures, and `provider_processing` jobs.
- Use a persistent machine path or object storage. Ephemeral container disks will lose media.
- Keep `APP_URL`, OAuth callbacks, provider allowlists, and proxy HTTPS headers consistent.
- Provider limits and permissions change. Reconfirm the linked official documentation before each production rollout.
