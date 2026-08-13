import fs from 'node:fs/promises';
import axios from 'axios';
import { distributionConfig } from '../config.mjs';
import { requireValue } from '../provider-error.mjs';
import { engagementMetricsResult, sandboxMetrics } from '../metrics.mjs';
import type {
  AuthorizationRequest,
  ConnectedAccount,
  ConnectContext,
  PublishMedia,
  PublishPayload,
  PublishResult,
  SocialAccountCredentials,
  SocialProvider,
  Tokens
} from '../types.mjs';
import type { EngagementMetricsResult, PublishedPostReference } from '../types.mjs';

const YOUTUBE_SCOPES = [
  'openid',
  'profile',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly'
];

type YouTubeError = Error & {
  code?: string;
  statusCode?: number;
  providerCode?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
};

function assertYouTubeEnabled(): void {
  if (distributionConfig.socialEnableYoutube) return;
  const error = new Error('YouTube publishing is disabled while the API project is awaiting audit. Set SOCIAL_ENABLE_YOUTUBE=true when testing or after approval.') as YouTubeError;
  error.code = 'provider_disabled';
  error.statusCode = 503;
  throw error;
}

function youtubeError(error: unknown): YouTubeError {
  const response = axios.isAxiosError(error) ? error.response : undefined;
  const data = response?.data as Record<string, unknown> | undefined;
  const root = data && typeof data.error === 'object' ? data.error as Record<string, unknown> : data || {};
  const errors = Array.isArray(root.errors) ? root.errors as Array<Record<string, unknown>> : [];
  const providerCode = String(errors[0]?.reason || root.status || root.code || response?.status || 'youtube_request_failed');
  const rawMessage = String(root.message || (error instanceof Error ? error.message : 'YouTube rejected the request.'));
  const friendly: Record<string, string> = {
    quotaExceeded: 'The YouTube Data API upload quota is exhausted for today.',
    dailyLimitExceeded: 'The YouTube API project reached its daily request limit.',
    uploadLimitExceeded: 'This YouTube channel reached its daily video upload limit.',
    insufficientPermissions: 'The YouTube account did not grant the youtube.upload permission. Reconnect it.',
    youtubeSignupRequired: 'This Google account does not have a YouTube channel yet.',
    forbidden: 'YouTube denied the upload. Confirm channel ownership and API project access.',
    invalidTitle: 'The YouTube video title is invalid or too long.'
  };
  const wrapped = new Error(`YouTube rejected the video: ${friendly[providerCode] || rawMessage}`) as YouTubeError;
  wrapped.code = ['insufficientPermissions', 'authError', 'invalidCredentials'].includes(providerCode)
    ? 'reauthorization_required'
    : providerCode;
  wrapped.statusCode = response?.status;
  wrapped.providerCode = providerCode;
  wrapped.retryable = Boolean(response && (response.status === 429 || response.status >= 500));
  wrapped.details = { providerCode };
  return wrapped;
}

function mediaItems(payload: PublishPayload): PublishMedia[] {
  if (payload.mediaItems?.length) return payload.mediaItems;
  return payload.media ? [payload.media] : [];
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readChunk(media: PublishMedia, start: number, length: number, handle: fs.FileHandle | null): Promise<Buffer> {
  if (handle) {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    if (bytesRead !== length) throw new Error('The YouTube video ended before the expected file size.');
    return buffer;
  }
  if (media.buffer) return media.buffer.subarray(start, start + length);
  throw new Error('The processed YouTube video file could not be opened.');
}

function uploadedOffset(rangeHeader: unknown): number {
  const match = String(rangeHeader || '').match(/bytes=0-(\d+)/i);
  return match ? Number(match[1]) + 1 : 0;
}

async function queryUploadOffset(uploadUrl: string, accessToken: string, totalSize: number): Promise<{ offset: number; complete?: Record<string, unknown> }> {
  const response = await axios.put(uploadUrl, null, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Length': '0',
      'Content-Range': `bytes */${totalSize}`
    },
    timeout: 30000,
    validateStatus: (status) => status === 200 || status === 201 || status === 308
  });
  if (response.status === 200 || response.status === 201) return { offset: totalSize, complete: response.data };
  return { offset: uploadedOffset(response.headers.range) };
}

async function uploadYouTubeVideo(uploadUrl: string, account: SocialAccountCredentials, media: PublishMedia): Promise<Record<string, unknown>> {
  const chunkSize = 8 * 1024 * 1024;
  const handle = media.localPath ? await fs.open(media.localPath, 'r') : null;
  let offset = 0;
  try {
    while (offset < media.size) {
      const length = Math.min(chunkSize, media.size - offset);
      const chunk = await readChunk(media, offset, length, handle);
      let response;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          response = await axios.put(uploadUrl, chunk, {
            headers: {
              Authorization: `Bearer ${account.accessToken}`,
              'Content-Type': media.mimeType,
              'Content-Length': String(length),
              'Content-Range': `bytes ${offset}-${offset + length - 1}/${media.size}`
            },
            timeout: 120000,
            maxBodyLength: Infinity,
            validateStatus: (status) => status === 200 || status === 201 || status === 308
          });
          break;
        } catch (error) {
          if (!axios.isAxiosError(error) || !error.response || ![500, 502, 503, 504].includes(error.response.status) || attempt === 3) throw error;
          await delay(2 ** attempt * 1000);
          const status = await queryUploadOffset(uploadUrl, account.accessToken, media.size);
          if (status.complete) return status.complete;
          offset = status.offset;
          break;
        }
      }
      if (!response) continue;
      if (response.status === 200 || response.status === 201) return response.data as Record<string, unknown>;
      const nextOffset = uploadedOffset(response.headers.range);
      offset = nextOffset > offset ? nextOffset : offset + length;
    }
    const final = await queryUploadOffset(uploadUrl, account.accessToken, media.size);
    if (final.complete) return final.complete;
    throw new Error('YouTube did not confirm that the resumable upload completed.');
  } finally {
    await handle?.close();
  }
}

async function uploadThumbnail(videoId: string, account: SocialAccountCredentials, image: PublishMedia): Promise<void> {
  let buffer = image.buffer;
  if (!buffer && image.localPath) buffer = await fs.readFile(image.localPath);
  if (!buffer) throw new Error('The YouTube thumbnail could not be opened.');
  await axios.post(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`, buffer, {
    headers: {
      Authorization: `Bearer ${account.accessToken}`,
      'Content-Type': image.mimeType,
      'Content-Length': String(buffer.byteLength)
    },
    timeout: 60000,
    maxBodyLength: 5 * 1024 * 1024
  });
}

export class YouTubeProvider implements SocialProvider {
  readonly platform = 'youtube' as const;

  async getAuthorizationRequest(input: { state: string }): Promise<AuthorizationRequest> {
    assertYouTubeEnabled();
    const clientId = requireValue(distributionConfig.youtubeClientId, 'YouTube OAuth is not configured. Add YOUTUBE_CLIENT_ID.');
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: distributionConfig.youtubeRedirectUri,
      response_type: 'code',
      scope: YOUTUBE_SCOPES.join(' '),
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      state: input.state
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
  }

  async connect(code: string, _context: ConnectContext = {}): Promise<ConnectedAccount[]> {
    assertYouTubeEnabled();
    if (code.startsWith('sandbox_')) {
      return [{
        platform: 'youtube', accountName: 'Moyi YouTube Sandbox', externalAccountId: 'youtube_sandbox_channel',
        accessToken: 'sandbox_youtube_access', refreshToken: 'sandbox_youtube_refresh', expiresInSeconds: 3600,
        scopes: YOUTUBE_SCOPES, metadata: { channelTitle: 'Moyi YouTube Sandbox' }
      }];
    }
    requireValue(distributionConfig.youtubeClientId, 'YouTube OAuth is not configured. Add YOUTUBE_CLIENT_ID.');
    requireValue(distributionConfig.youtubeClientSecret, 'YouTube OAuth is not configured. Add YOUTUBE_CLIENT_SECRET.');
    try {
      const form = new URLSearchParams({
        code,
        client_id: distributionConfig.youtubeClientId,
        client_secret: distributionConfig.youtubeClientSecret,
        redirect_uri: distributionConfig.youtubeRedirectUri,
        grant_type: 'authorization_code'
      });
      const tokens = await axios.post('https://oauth2.googleapis.com/token', form.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000
      });
      const accessToken = String(tokens.data?.access_token || '');
      const channels = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
        params: { part: 'id,snippet', mine: 'true' },
        headers: { Authorization: `Bearer ${accessToken}` }, timeout: 12000
      });
      const channel = Array.isArray(channels.data?.items) ? channels.data.items[0] : null;
      if (!channel?.id) {
        const error = new Error('This Google account does not have a YouTube channel. Create one, then reconnect.') as YouTubeError;
        error.code = 'youtubeSignupRequired';
        error.statusCode = 422;
        throw error;
      }
      return [{
        platform: 'youtube',
        accountName: String(channel.snippet?.title || 'YouTube channel'),
        externalAccountId: String(channel.id),
        accessToken,
        refreshToken: String(tokens.data?.refresh_token || ''),
        expiresInSeconds: Number(tokens.data?.expires_in || 3600),
        scopes: String(tokens.data?.scope || YOUTUBE_SCOPES.join(' ')).split(/\s+/).filter(Boolean),
        metadata: { channelTitle: String(channel.snippet?.title || '') }
      }];
    } catch (error) {
      if ((error as YouTubeError).code && !axios.isAxiosError(error)) throw error;
      throw youtubeError(error);
    }
  }

  async refreshToken(account: SocialAccountCredentials): Promise<Tokens> {
    if (account.accessToken.startsWith('sandbox_')) return { expiresInSeconds: 3600 };
    assertYouTubeEnabled();
    requireValue(account.refreshToken, 'YouTube did not return a refresh token. Reconnect the channel and grant offline access.');
    try {
      const form = new URLSearchParams({
        client_id: distributionConfig.youtubeClientId,
        client_secret: distributionConfig.youtubeClientSecret,
        refresh_token: account.refreshToken,
        grant_type: 'refresh_token'
      });
      const response = await axios.post('https://oauth2.googleapis.com/token', form.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000
      });
      return {
        accessToken: String(response.data?.access_token || ''),
        refreshToken: account.refreshToken,
        expiresInSeconds: Number(response.data?.expires_in || 3600),
        scopes: String(response.data?.scope || account.scopes.join(' ')).split(/\s+/).filter(Boolean)
      };
    } catch (error) {
      throw youtubeError(error);
    }
  }

  async publish(account: SocialAccountCredentials, payload: PublishPayload): Promise<PublishResult> {
    if (!account.accessToken.startsWith('sandbox_') && account.metadata.sandbox !== true) assertYouTubeEnabled();
    const media = mediaItems(payload);
    const videos = media.filter((item) => item.kind === 'video');
    const images = media.filter((item) => item.kind === 'image');
    if (videos.length !== 1) {
      const error = new Error('YouTube publishing requires exactly one video.') as YouTubeError;
      error.code = 'video_required';
      error.statusCode = 422;
      throw error;
    }
    if (images.length > 1) {
      const error = new Error('YouTube accepts at most one custom thumbnail.') as YouTubeError;
      error.code = 'too_many_media_items';
      error.statusCode = 422;
      throw error;
    }
    if (account.accessToken.startsWith('sandbox_') || account.metadata.sandbox === true) {
      const id = `youtube_sandbox_${Date.now()}`;
      return { platformPostId: id, platformUrl: `https://youtu.be/${id}` };
    }
    try {
      const video = videos[0];
      const options = payload.options?.youtube || {};
      const requestedPrivacy = options.privacyStatus || 'private';
      const effectivePrivacy = distributionConfig.youtubeApiAudited ? requestedPrivacy : 'private';
      const metadata = {
        snippet: {
          title: String(payload.title || payload.text.split('\n')[0] || 'Moyi video').slice(0, 100),
          description: String(payload.body || payload.text || '').slice(0, 5000),
          categoryId: options.categoryId || '22'
        },
        status: {
          privacyStatus: effectivePrivacy,
          selfDeclaredMadeForKids: false
        }
      };
      const body = JSON.stringify(metadata);
      const initialized = await axios.post(
        `https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=${options.notifySubscribers === true}`,
        body,
        {
          headers: {
            Authorization: `Bearer ${account.accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'Content-Length': String(Buffer.byteLength(body)),
            'X-Upload-Content-Length': String(video.size),
            'X-Upload-Content-Type': video.mimeType
          },
          timeout: 20000
        }
      );
      const uploadUrl = String(initialized.headers.location || '');
      if (!uploadUrl) throw new Error('YouTube did not return a resumable upload URL.');
      const result = await uploadYouTubeVideo(uploadUrl, account, video);
      const videoId = String(result.id || '');
      if (!videoId) throw new Error('YouTube completed the upload but did not return a video ID.');
      let warning = '';
      if (images[0]) {
        try {
          await uploadThumbnail(videoId, account, images[0]);
        } catch (error) {
          warning = youtubeError(error).message;
        }
      }
      if (!distributionConfig.youtubeApiAudited && requestedPrivacy !== 'private') {
        warning = `${warning ? `${warning} ` : ''}YouTube forces uploads from unaudited API projects to private visibility.`;
      }
      return { platformPostId: videoId, platformUrl: `https://youtu.be/${videoId}`, warning };
    } catch (error) {
      if ((error as YouTubeError).code && !axios.isAxiosError(error)) throw error;
      throw youtubeError(error);
    }
  }

  async getMetrics(account: SocialAccountCredentials, post: PublishedPostReference): Promise<EngagementMetricsResult> {
    if (account.accessToken.startsWith('sandbox_') || account.metadata.sandbox === true) {
      return engagementMetricsResult(sandboxMetrics(account.metadata), { source: 'sandbox' });
    }
    assertYouTubeEnabled();
    try {
      const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: { part: 'statistics', id: post.platformPostId },
        headers: { Authorization: `Bearer ${account.accessToken}` },
        timeout: 12000
      });
      const statistics = Array.isArray(response.data?.items) ? response.data.items[0]?.statistics : null;
      if (!statistics) {
        const error = new Error('YouTube could not find the published video.') as YouTubeError;
        error.code = 'post_not_found';
        error.statusCode = 404;
        throw error;
      }
      return engagementMetricsResult({
        views: statistics.viewCount,
        videoViews: statistics.viewCount,
        likes: statistics.likeCount,
        comments: statistics.commentCount
      });
    } catch (error) {
      if ((error as YouTubeError).code === 'post_not_found') throw error;
      throw youtubeError(error);
    }
  }
}

export { YOUTUBE_SCOPES, youtubeError };
