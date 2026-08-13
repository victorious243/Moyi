import fs from 'node:fs/promises';
import axios from 'axios';
import { distributionConfig } from '../config.mjs';
import { engagementMetricsResult, sandboxMetrics } from '../metrics.mjs';
import { requireValue } from '../provider-error.mjs';
import type {
  AuthorizationRequest,
  ConnectedAccount,
  ConnectContext,
  PublishMedia,
  PublishPayload,
  PublishResult,
  PublishStatusResult,
  SocialAccountCredentials,
  SocialProviderWithPublishStatus,
  TikTokPublishOptions,
  Tokens
} from '../types.mjs';
import type { EngagementMetricsResult, PublishedPostReference } from '../types.mjs';

const TIKTOK_SCOPES = ['user.info.basic', 'video.publish', 'video.list'];
const TIKTOK_API = 'https://open.tiktokapis.com';

type TikTokError = Error & {
  code?: string;
  statusCode?: number;
  providerCode?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
};

export interface TikTokCreatorInfo {
  creatorNickname: string;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSeconds: number;
}

function assertTikTokEnabled(): void {
  if (distributionConfig.socialEnableTiktok) return;
  const error = new Error('TikTok publishing is disabled while the app is awaiting audit. Set SOCIAL_ENABLE_TIKTOK=true when testing or after approval.') as TikTokError;
  error.code = 'provider_disabled';
  error.statusCode = 503;
  throw error;
}

function responseError(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object') return {};
  const payload = data as Record<string, unknown>;
  return payload.error && typeof payload.error === 'object' ? payload.error as Record<string, unknown> : {};
}

function friendlyTikTokError(code: string, message: string): string {
  const messages: Record<string, string> = {
    access_token_invalid: 'The TikTok session expired or was revoked. Reconnect the account.',
    scope_not_authorized: 'The TikTok app or account did not grant the video.publish permission.',
    privacy_level_option_mismatch: 'The selected visibility is not currently available for this TikTok creator. Refresh the account options and choose again.',
    unaudited_client_can_only_post_to_private_accounts: 'TikTok limits unaudited apps to private creators and Only me visibility.',
    reached_active_user_cap: 'This TikTok app reached its daily active-creator cap. Try again tomorrow.',
    spam_risk_too_many_posts: 'This TikTok creator reached the API posting limit for today.',
    spam_risk_too_many_pending_share: 'This TikTok creator has too many pending API uploads. Finish or remove a pending upload first.',
    spam_risk_user_banned_from_posting: 'TikTok has disabled posting for this creator account.',
    url_ownership_unverified: 'TikTok could not verify the media URL. Verify the APP_URL domain or /social-media/public/ URL prefix in the TikTok developer console.',
    file_format_check_failed: 'TikTok rejected the video format. Use the processed MP4/H.264 variant.',
    duration_check_failed: 'TikTok rejected the video duration for this creator account.',
    frame_rate_check_failed: 'TikTok requires a video frame rate between 23 and 60 FPS.',
    picture_size_check_failed: 'TikTok rejected the media dimensions. Use the processed 9:16 variant.',
    rate_limit_exceeded: 'TikTok rate-limited this publishing request. Moyi will retry it.'
  };
  return messages[code] || message || 'TikTok rejected the publishing request.';
}

function tiktokError(error: unknown, fallbackCode = 'tiktok_request_failed'): TikTokError {
  const response = axios.isAxiosError(error) ? error.response : undefined;
  const data = response?.data as Record<string, unknown> | undefined;
  const provider = responseError(data);
  const providerCode = String(provider.code || (data && data.error) || fallbackCode);
  const rawMessage = String(provider.message || (data && data.error_description) || (error instanceof Error ? error.message : ''));
  const wrapped = new Error(`TikTok rejected the post: ${friendlyTikTokError(providerCode, rawMessage)}`) as TikTokError;
  wrapped.code = providerCode === 'access_token_invalid' ? 'reauthorization_required' : providerCode;
  wrapped.statusCode = response?.status;
  wrapped.providerCode = providerCode;
  wrapped.retryable = providerCode === 'rate_limit_exceeded' || Boolean(response && (response.status === 429 || response.status >= 500));
  wrapped.details = {
    providerCode,
    ...(provider.log_id ? { logId: String(provider.log_id) } : {})
  };
  return wrapped;
}

function assertTikTokSuccess(data: unknown): void {
  const provider = responseError(data);
  const code = String(provider.code || 'ok');
  if (code === 'ok') return;
  const error = new Error(`TikTok rejected the post: ${friendlyTikTokError(code, String(provider.message || ''))}`) as TikTokError;
  error.code = code === 'access_token_invalid' ? 'reauthorization_required' : code;
  error.providerCode = code;
  error.statusCode = code === 'rate_limit_exceeded' ? 429 : 400;
  error.retryable = code === 'rate_limit_exceeded';
  error.details = { providerCode: code, ...(provider.log_id ? { logId: String(provider.log_id) } : {}) };
  throw error;
}

function mediaItems(payload: PublishPayload): PublishMedia[] {
  if (payload.mediaItems?.length) return payload.mediaItems;
  return payload.media ? [payload.media] : [];
}

function publicPhotoUrl(media: PublishMedia): string {
  try {
    if (media.url && new URL(media.url).protocol === 'https:') return media.url;
  } catch {
    // The friendly configuration error below is more useful than URL's parser error.
  }
  const error = new Error('TikTok photo posts require public HTTPS media URLs. Verify APP_URL in the TikTok developer console.') as TikTokError;
  error.code = 'public_media_url_required';
  error.statusCode = 422;
  throw error;
}

function publishOptions(payload: PublishPayload): TikTokPublishOptions {
  const options = payload.options?.tiktok || {};
  if (!options.privacyLevel) {
    const error = new Error('Choose a TikTok visibility before publishing. TikTok does not permit a default selection.') as TikTokError;
    error.code = 'tiktok_privacy_required';
    error.statusCode = 422;
    throw error;
  }
  if (!options.musicUsageConsent) {
    const error = new Error("Confirm TikTok's Music Usage terms before publishing.") as TikTokError;
    error.code = 'tiktok_music_consent_required';
    error.statusCode = 422;
    throw error;
  }
  if (!distributionConfig.tiktokAppAudited && options.privacyLevel !== 'SELF_ONLY') {
    const error = new Error('TikTok limits unaudited apps to Only me visibility. Choose Only me until the app passes audit.') as TikTokError;
    error.code = 'unaudited_client_can_only_post_to_private_accounts';
    error.statusCode = 422;
    throw error;
  }
  if (options.commercialContent && !options.brandedContent && !options.brandOrganicContent) {
    const error = new Error('Indicate whether the TikTok commercial content promotes your own brand, a third party, or both.') as TikTokError;
    error.code = 'tiktok_commercial_disclosure_required';
    error.statusCode = 422;
    throw error;
  }
  if (options.brandedContent && options.privacyLevel === 'SELF_ONLY') {
    const error = new Error('TikTok does not allow branded content with Only me visibility.') as TikTokError;
    error.code = 'tiktok_branded_content_visibility';
    error.statusCode = 422;
    throw error;
  }
  return options;
}

export async function queryTikTokCreatorInfo(account: SocialAccountCredentials): Promise<TikTokCreatorInfo> {
  if (account.accessToken.startsWith('sandbox_') || account.metadata.sandbox === true) {
    return {
      creatorNickname: account.accountName,
      privacyLevelOptions: distributionConfig.tiktokAppAudited
        ? ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY']
        : ['SELF_ONLY'],
      commentDisabled: false,
      duetDisabled: false,
      stitchDisabled: false,
      maxVideoPostDurationSeconds: 600
    };
  }
  assertTikTokEnabled();
  try {
    const response = await axios.post(`${TIKTOK_API}/v2/post/publish/creator_info/query/`, {}, {
      headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
      timeout: 12000
    });
    assertTikTokSuccess(response.data);
    const data = response.data?.data || {};
    return {
      creatorNickname: String(data.creator_nickname || account.accountName),
      privacyLevelOptions: Array.isArray(data.privacy_level_options) ? data.privacy_level_options.map(String) : [],
      commentDisabled: Boolean(data.comment_disabled),
      duetDisabled: Boolean(data.duet_disabled),
      stitchDisabled: Boolean(data.stitch_disabled),
      maxVideoPostDurationSeconds: Number(data.max_video_post_duration_sec || 180)
    };
  } catch (error) {
    if ((error as TikTokError).providerCode) throw error;
    throw tiktokError(error);
  }
}

function chunkPlan(size: number): { chunkSize: number; totalChunkCount: number } {
  if (!Number.isInteger(size) || size < 1 || size > 4 * 1024 * 1024 * 1024) {
    const error = new Error('TikTok videos must be no larger than 4 GB.') as TikTokError;
    error.code = 'video_size_check_failed';
    error.statusCode = 422;
    throw error;
  }
  const maximumChunk = 64 * 1024 * 1024;
  if (size <= maximumChunk) return { chunkSize: size, totalChunkCount: 1 };
  const targetChunkCount = Math.ceil(size / maximumChunk);
  const chunkSize = Math.floor(size / targetChunkCount);
  return { chunkSize, totalChunkCount: Math.floor(size / chunkSize) };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function uploadVideo(uploadUrl: string, media: PublishMedia, chunkSize: number, totalChunkCount: number): Promise<void> {
  if (!media.localPath && !media.buffer) {
    const error = new Error('The processed TikTok video file could not be opened.') as TikTokError;
    error.code = 'media_source_missing';
    throw error;
  }
  const file = media.localPath ? await fs.open(media.localPath, 'r') : null;
  try {
    for (let index = 0; index < totalChunkCount; index += 1) {
      const start = index * chunkSize;
      const isFinal = index === totalChunkCount - 1;
      const endExclusive = isFinal ? media.size : Math.min(media.size, start + chunkSize);
      const length = endExclusive - start;
      let chunk: Buffer;
      if (file) {
        chunk = Buffer.allocUnsafe(length);
        const { bytesRead } = await file.read(chunk, 0, length, start);
        if (bytesRead !== length) throw new Error('TikTok video upload ended before the expected file size.');
      } else {
        chunk = media.buffer!.subarray(start, endExclusive);
      }
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          await axios.put(uploadUrl, chunk, {
            headers: {
              'Content-Type': media.mimeType,
              'Content-Length': String(length),
              'Content-Range': `bytes ${start}-${endExclusive - 1}/${media.size}`
            },
            timeout: 120000,
            maxBodyLength: Infinity,
            validateStatus: (status) => status === 201 || status === 206
          });
          break;
        } catch (error) {
          const status = axios.isAxiosError(error) ? error.response?.status : 0;
          if (attempt === 3 || (status && status < 500)) throw error;
          await delay(2 ** attempt * 1000);
        }
      }
    }
  } finally {
    await file?.close();
  }
}

export class TikTokProvider implements SocialProviderWithPublishStatus {
  readonly platform = 'tiktok' as const;

  async getAuthorizationRequest(input: { state: string }): Promise<AuthorizationRequest> {
    assertTikTokEnabled();
    const clientKey = requireValue(distributionConfig.tiktokClientKey, 'TikTok OAuth is not configured. Add TIKTOK_CLIENT_KEY.');
    const params = new URLSearchParams({
      client_key: clientKey,
      scope: TIKTOK_SCOPES.join(','),
      response_type: 'code',
      redirect_uri: distributionConfig.tiktokRedirectUri,
      state: input.state
    });
    return { url: `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}` };
  }

  async connect(code: string, _context: ConnectContext = {}): Promise<ConnectedAccount[]> {
    assertTikTokEnabled();
    if (code.startsWith('sandbox_')) {
      return [{
        platform: 'tiktok', accountName: '@moyi_tiktok_sandbox', externalAccountId: 'tiktok_sandbox_open_id',
        accessToken: 'sandbox_tiktok_access', refreshToken: 'sandbox_tiktok_refresh', expiresInSeconds: 86400,
        scopes: TIKTOK_SCOPES, metadata: { username: 'moyi_tiktok_sandbox' }
      }];
    }
    requireValue(distributionConfig.tiktokClientKey, 'TikTok OAuth is not configured. Add TIKTOK_CLIENT_KEY.');
    requireValue(distributionConfig.tiktokClientSecret, 'TikTok OAuth is not configured. Add TIKTOK_CLIENT_SECRET.');
    try {
      const form = new URLSearchParams({
        client_key: distributionConfig.tiktokClientKey,
        client_secret: distributionConfig.tiktokClientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: distributionConfig.tiktokRedirectUri
      });
      const response = await axios.post(`${TIKTOK_API}/v2/oauth/token/`, form.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000
      });
      const accessToken = String(response.data?.access_token || '');
      const profile = await axios.get(`${TIKTOK_API}/v2/user/info/`, {
        params: { fields: 'open_id,union_id,avatar_url,display_name' },
        headers: { Authorization: `Bearer ${accessToken}` }, timeout: 12000
      });
      const user = profile.data?.data?.user || {};
      return [{
        platform: 'tiktok',
        accountName: String(user.display_name || 'TikTok creator'),
        externalAccountId: String(user.open_id || response.data?.open_id || ''),
        accessToken,
        refreshToken: String(response.data?.refresh_token || ''),
        expiresInSeconds: Number(response.data?.expires_in || 86400),
        scopes: String(response.data?.scope || TIKTOK_SCOPES.join(',')).split(',').filter(Boolean),
        metadata: { username: String(user.display_name || ''), unionId: String(user.union_id || '') }
      }];
    } catch (error) {
      throw tiktokError(error);
    }
  }

  async refreshToken(account: SocialAccountCredentials): Promise<Tokens> {
    if (account.accessToken.startsWith('sandbox_')) return { expiresInSeconds: 86400 };
    assertTikTokEnabled();
    requireValue(account.refreshToken, 'TikTok did not return a refresh token. Reconnect the account.');
    try {
      const form = new URLSearchParams({
        client_key: distributionConfig.tiktokClientKey,
        client_secret: distributionConfig.tiktokClientSecret,
        grant_type: 'refresh_token',
        refresh_token: account.refreshToken
      });
      const response = await axios.post(`${TIKTOK_API}/v2/oauth/token/`, form.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000
      });
      return {
        accessToken: String(response.data?.access_token || ''),
        refreshToken: String(response.data?.refresh_token || account.refreshToken),
        expiresInSeconds: Number(response.data?.expires_in || 86400),
        scopes: String(response.data?.scope || account.scopes.join(',')).split(',').filter(Boolean)
      };
    } catch (error) {
      throw tiktokError(error);
    }
  }

  async publish(account: SocialAccountCredentials, payload: PublishPayload): Promise<PublishResult> {
    if (!account.accessToken.startsWith('sandbox_') && account.metadata.sandbox !== true) assertTikTokEnabled();
    const media = mediaItems(payload);
    if (!media.length) {
      const error = new Error('TikTok requires a video or one or more images.') as TikTokError;
      error.code = 'media_required';
      error.statusCode = 422;
      throw error;
    }
    if (media.some((item) => item.kind !== media[0].kind)) {
      const error = new Error('TikTok posts cannot mix images and video.') as TikTokError;
      error.code = 'mixed_media_not_supported';
      error.statusCode = 422;
      throw error;
    }
    const options = publishOptions(payload);
    const creator = await queryTikTokCreatorInfo(account);
    if (!creator.privacyLevelOptions.includes(options.privacyLevel!)) {
      const error = new Error('The selected TikTok visibility is no longer available for this creator. Refresh the choices and select again.') as TikTokError;
      error.code = 'privacy_level_option_mismatch';
      error.statusCode = 422;
      throw error;
    }
    if (account.accessToken.startsWith('sandbox_') || account.metadata.sandbox === true) {
      const id = `tiktok_sandbox_${Date.now()}`;
      return { platformPostId: id, platformUrl: `https://www.tiktok.com/@${account.metadata.username || 'moyi'}/video/${id}` };
    }
    try {
      let publishId = '';
      if (media[0].kind === 'video') {
        if (media.length !== 1) throw new Error('TikTok accepts one video per post.');
        const video = media[0];
        if (video.durationMs && video.durationMs > creator.maxVideoPostDurationSeconds * 1000) {
          const error = new Error(`This TikTok creator currently accepts videos up to ${creator.maxVideoPostDurationSeconds} seconds.`) as TikTokError;
          error.code = 'duration_check_failed';
          error.statusCode = 422;
          throw error;
        }
        const chunks = chunkPlan(video.size);
        const initialized = await axios.post(`${TIKTOK_API}/v2/post/publish/video/init/`, {
          post_info: {
            title: payload.text.slice(0, 2200),
            privacy_level: options.privacyLevel,
            disable_duet: creator.duetDisabled || !options.allowDuet,
            disable_comment: creator.commentDisabled || !options.allowComment,
            disable_stitch: creator.stitchDisabled || !options.allowStitch,
            brand_content_toggle: Boolean(options.brandedContent),
            brand_organic_toggle: Boolean(options.brandOrganicContent)
          },
          source_info: {
            source: 'FILE_UPLOAD',
            video_size: video.size,
            chunk_size: chunks.chunkSize,
            total_chunk_count: chunks.totalChunkCount
          }
        }, {
          headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
          timeout: 15000
        });
        assertTikTokSuccess(initialized.data);
        publishId = String(initialized.data?.data?.publish_id || '');
        const uploadUrl = String(initialized.data?.data?.upload_url || '');
        if (!publishId || !uploadUrl) throw new Error('TikTok did not return an upload target.');
        await uploadVideo(uploadUrl, video, chunks.chunkSize, chunks.totalChunkCount);
      } else {
        if (media.length > 35) throw new Error('TikTok photo posts can contain at most 35 images.');
        const urls = media.map(publicPhotoUrl);
        const initialized = await axios.post(`${TIKTOK_API}/v2/post/publish/content/init/`, {
          post_info: {
            title: (payload.title || '').slice(0, 90),
            description: payload.text.slice(0, 4000),
            privacy_level: options.privacyLevel,
            disable_comment: creator.commentDisabled || !options.allowComment,
            auto_add_music: false,
            brand_content_toggle: Boolean(options.brandedContent),
            brand_organic_toggle: Boolean(options.brandOrganicContent)
          },
          source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: urls },
          post_mode: 'DIRECT_POST',
          media_type: 'PHOTO'
        }, {
          headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
          timeout: 15000
        });
        assertTikTokSuccess(initialized.data);
        publishId = String(initialized.data?.data?.publish_id || '');
      }
      if (!publishId) throw new Error('TikTok did not return a publish ID.');
      return {
        status: 'processing',
        platformPostId: publishId,
        platformUrl: '',
        providerState: {
          publishId,
          username: String(account.metadata.username || ''),
          submittedAt: new Date().toISOString(),
          checks: 0
        },
        warning: distributionConfig.tiktokAppAudited ? '' : 'TikTok restricts unaudited apps to private posting.'
      };
    } catch (error) {
      if ((error as TikTokError).code && !axios.isAxiosError(error)) throw error;
      throw tiktokError(error);
    }
  }

  async getPublishStatus(account: SocialAccountCredentials, state: Record<string, unknown>): Promise<PublishStatusResult> {
    const publishId = String(state.publishId || '');
    if (!publishId) return { status: 'failed', errorCode: 'invalid_publish_id', errorMessage: 'TikTok publish tracking data is missing.' };
    if (account.accessToken.startsWith('sandbox_')) {
      return {
        status: 'published', platformPostId: publishId,
        platformUrl: `https://www.tiktok.com/@${state.username || 'moyi'}/video/${publishId}`
      };
    }
    assertTikTokEnabled();
    try {
      const response = await axios.post(`${TIKTOK_API}/v2/post/publish/status/fetch/`, { publish_id: publishId }, {
        headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
        timeout: 12000
      });
      assertTikTokSuccess(response.data);
      const data = response.data?.data || {};
      const status = String(data.status || 'PROCESSING').toUpperCase();
      if (status === 'FAILED') {
        const reason = String(data.fail_reason || 'tiktok_processing_failed');
        return { status: 'failed', errorCode: reason, errorMessage: friendlyTikTokError(reason, 'TikTok rejected the media during processing.') };
      }
      if (status === 'PUBLISH_COMPLETE') {
        const postIds = Array.isArray(data.publicaly_available_post_id) ? data.publicaly_available_post_id.map(String) : [];
        const postId = postIds[0] || publishId;
        const username = String(state.username || account.metadata.username || '');
        return {
          status: 'published',
          platformPostId: postId,
          platformUrl: postIds[0] && username ? `https://www.tiktok.com/@${username}/video/${postId}` : `https://www.tiktok.com/@${username}`
        };
      }
      return {
        status: 'processing',
        providerState: { ...state, providerStatus: status, checks: Number(state.checks || 0) + 1 }
      };
    } catch (error) {
      throw tiktokError(error);
    }
  }

  async getMetrics(account: SocialAccountCredentials, post: PublishedPostReference): Promise<EngagementMetricsResult> {
    if (account.accessToken.startsWith('sandbox_') || account.metadata.sandbox === true) {
      return engagementMetricsResult(sandboxMetrics(account.metadata), { source: 'sandbox' });
    }
    assertTikTokEnabled();
    try {
      const response = await axios.post(
        `${TIKTOK_API}/v2/video/query/?fields=id,like_count,comment_count,share_count,view_count`,
        { filters: { video_ids: [post.platformPostId] } },
        {
          headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json' },
          timeout: 12000
        }
      );
      assertTikTokSuccess(response.data);
      const videos = Array.isArray(response.data?.data?.videos) ? response.data.data.videos : [];
      const video = videos[0];
      if (!video) {
        const error = new Error('TikTok could not find this video for the connected creator.') as TikTokError;
        error.code = 'post_not_found';
        error.statusCode = 404;
        throw error;
      }
      return engagementMetricsResult({
        views: video.view_count,
        videoViews: video.view_count,
        likes: video.like_count,
        comments: video.comment_count,
        shares: video.share_count
      });
    } catch (error) {
      if ((error as TikTokError).code === 'post_not_found') throw error;
      throw tiktokError(error);
    }
  }
}

export { TIKTOK_SCOPES, chunkPlan, friendlyTikTokError, tiktokError };
