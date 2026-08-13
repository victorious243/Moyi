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

const META_SCOPES = [
  'public_profile',
  'pages_show_list',
  'pages_read_engagement',
  'read_insights',
  'pages_manage_posts',
  'pages_manage_engagement',
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_comments',
  'instagram_manage_insights'
];

type ProviderError = Error & {
  code?: string;
  statusCode?: number;
  providerCode?: string;
  providerSubcode?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
};

function graphBase(): string {
  return `https://graph.facebook.com/${distributionConfig.metaGraphVersion}`;
}

function assertMetaEnabled(): void {
  if (distributionConfig.socialEnableMeta) return;
  const error = new Error('Meta publishing is disabled while the app is awaiting review. Set SOCIAL_ENABLE_META=true after approval.') as ProviderError;
  error.code = 'provider_disabled';
  error.statusCode = 503;
  throw error;
}

function metaError(platform: string, error: unknown): ProviderError {
  const response = axios.isAxiosError(error) ? error.response : undefined;
  const responseData = response?.data as Record<string, unknown> | undefined;
  const meta = responseData && typeof responseData.error === 'object'
    ? responseData.error as Record<string, unknown>
    : responseData || {};
  const providerCode = String(meta.code || response?.status || 'unknown');
  const providerSubcode = String(meta.error_subcode || '');
  const rawMessage = String(
    meta.error_user_msg || meta.error_user_title || meta.message || (error instanceof Error ? error.message : 'The provider rejected the request.')
  );
  const mapped: Record<string, string> = {
    '10': 'The Meta app is missing a required publishing permission. Reconnect after the permission is approved.',
    '190': 'The Meta session expired or was revoked. Reconnect this account.',
    '200': 'Meta denied this publishing action. Check the Page role and approved app permissions.',
    '36003': 'Instagram rejected the media aspect ratio. Choose a processed 1:1, 4:5, or 9:16 variant.',
    '9007': 'Meta could not download the media URL. Confirm APP_URL is public HTTPS and reachable without signing in.',
    '2207009': 'Instagram is still processing the media container. Moyi will retry it.',
    '2207026': 'Instagram could not process this media file. Check its codec, duration, dimensions, and audio track.'
  };
  const friendly = mapped[providerSubcode] || mapped[providerCode] || rawMessage;
  const wrapped = new Error(`${platform} rejected the post: ${friendly}`) as ProviderError;
  wrapped.code = providerCode === '190' ? 'reauthorization_required' : `${platform.toLowerCase()}_request_failed`;
  wrapped.statusCode = response?.status;
  wrapped.providerCode = providerCode;
  wrapped.providerSubcode = providerSubcode;
  wrapped.retryable = Boolean(response && (response.status === 429 || response.status >= 500)) || providerSubcode === '2207009';
  wrapped.details = {
    providerCode,
    ...(providerSubcode ? { providerSubcode } : {}),
    ...(meta.fbtrace_id ? { traceId: String(meta.fbtrace_id) } : {})
  };
  return wrapped;
}

function authorizationRequest(state: string): AuthorizationRequest {
  assertMetaEnabled();
  const clientId = requireValue(distributionConfig.metaAppId, 'Meta OAuth is not configured. Add META_APP_ID.');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: distributionConfig.metaRedirectUri,
    state,
    response_type: 'code',
    scope: META_SCOPES.join(',')
  });
  return { url: `https://www.facebook.com/${distributionConfig.metaGraphVersion}/dialog/oauth?${params.toString()}` };
}

async function exchangeLongLivedUserToken(code: string): Promise<{ accessToken: string; expiresInSeconds: number }> {
  requireValue(distributionConfig.metaAppId, 'Meta OAuth is not configured. Add META_APP_ID.');
  requireValue(distributionConfig.metaAppSecret, 'Meta OAuth is not configured. Add META_APP_SECRET.');
  const short = await axios.get(`${graphBase()}/oauth/access_token`, {
    params: {
      client_id: distributionConfig.metaAppId,
      client_secret: distributionConfig.metaAppSecret,
      redirect_uri: distributionConfig.metaRedirectUri,
      code
    },
    timeout: 15000
  });
  const shortToken = String(short.data?.access_token || '');
  if (!shortToken) throw new Error('Meta did not return an access token.');
  const long = await axios.get(`${graphBase()}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: distributionConfig.metaAppId,
      client_secret: distributionConfig.metaAppSecret,
      fb_exchange_token: shortToken
    },
    timeout: 15000
  });
  return {
    accessToken: String(long.data?.access_token || shortToken),
    expiresInSeconds: Number(long.data?.expires_in || short.data?.expires_in || 5184000)
  };
}

async function accountsForUser(userToken: string, expiresInSeconds: number): Promise<ConnectedAccount[]> {
  const profile = await axios.get(`${graphBase()}/me`, {
    params: { fields: 'id,name', access_token: userToken },
    timeout: 12000
  });
  const connectionKey = String(profile.data?.id || '');
  const pages = await axios.get(`${graphBase()}/me/accounts`, {
    params: {
      fields: 'id,name,access_token,tasks,instagram_business_account{id,username,name,profile_picture_url}',
      limit: 100,
      access_token: userToken
    },
    timeout: 15000
  });
  const results: ConnectedAccount[] = [];
  for (const page of Array.isArray(pages.data?.data) ? pages.data.data : []) {
    const pageId = String(page.id || '');
    const pageToken = String(page.access_token || '');
    if (!pageId || !pageToken) continue;
    results.push({
      platform: 'facebook',
      accountName: String(page.name || `Facebook Page ${pageId}`),
      externalAccountId: pageId,
      accessToken: pageToken,
      refreshToken: userToken,
      expiresInSeconds,
      scopes: META_SCOPES,
      metadata: {
        accountType: 'page',
        pageId,
        connectionKey,
        tasks: Array.isArray(page.tasks) ? page.tasks.map(String) : []
      }
    });
    const instagram = page.instagram_business_account;
    if (instagram?.id) {
      const username = String(instagram.username || '');
      results.push({
        platform: 'instagram',
        accountName: username ? `@${username}` : String(instagram.name || `Instagram ${instagram.id}`),
        externalAccountId: String(instagram.id),
        accessToken: pageToken,
        refreshToken: userToken,
        expiresInSeconds,
        scopes: META_SCOPES,
        metadata: {
          accountType: 'professional',
          username,
          pageId,
          pageName: String(page.name || ''),
          connectionKey
        }
      });
    }
  }
  if (!results.length) {
    const error = new Error('Meta returned no Facebook Pages that this user can publish to. Confirm the Page role and permissions.') as ProviderError;
    error.code = 'no_publishable_accounts';
    error.statusCode = 422;
    throw error;
  }
  return results;
}

async function connectMeta(code: string): Promise<ConnectedAccount[]> {
  assertMetaEnabled();
  if (code.startsWith('sandbox_')) {
    return [
      {
        platform: 'facebook', accountName: 'Meta Sandbox Page', externalAccountId: 'meta_sandbox_page_id',
        accessToken: 'sandbox_meta_page', refreshToken: 'sandbox_meta_user', expiresInSeconds: 5184000,
        scopes: META_SCOPES, metadata: { accountType: 'page', pageId: 'meta_sandbox_page_id', connectionKey: 'sandbox_user' }
      },
      {
        platform: 'instagram', accountName: '@moyi_sandbox', externalAccountId: 'meta_sandbox_instagram_id',
        accessToken: 'sandbox_meta_page', refreshToken: 'sandbox_meta_user', expiresInSeconds: 5184000,
        scopes: META_SCOPES, metadata: { accountType: 'professional', pageId: 'meta_sandbox_page_id', username: 'moyi_sandbox', connectionKey: 'sandbox_user' }
      }
    ];
  }
  try {
    const tokens = await exchangeLongLivedUserToken(code);
    return accountsForUser(tokens.accessToken, tokens.expiresInSeconds);
  } catch (error) {
    throw metaError('Meta', error);
  }
}

async function refreshMetaToken(account: SocialAccountCredentials): Promise<Tokens> {
  if (account.accessToken.startsWith('sandbox_')) return { expiresInSeconds: 5184000 };
  assertMetaEnabled();
  requireValue(account.refreshToken, 'Meta did not provide a renewable user token. Reconnect this account.');
  try {
    const refreshed = await axios.get(`${graphBase()}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: distributionConfig.metaAppId,
        client_secret: distributionConfig.metaAppSecret,
        fb_exchange_token: account.refreshToken
      },
      timeout: 15000
    });
    const userToken = String(refreshed.data?.access_token || account.refreshToken);
    const pageId = String(account.metadata.pageId || (account.platform === 'facebook' ? account.externalAccountId : ''));
    const page = await axios.get(`${graphBase()}/${encodeURIComponent(pageId)}`, {
      params: { fields: 'access_token', access_token: userToken },
      timeout: 12000
    });
    const pageToken = String(page.data?.access_token || '');
    if (!pageToken) throw new Error('Meta did not return a renewed Page token.');
    return {
      accessToken: pageToken,
      refreshToken: userToken,
      expiresInSeconds: Number(refreshed.data?.expires_in || 5184000),
      scopes: account.scopes
    };
  } catch (error) {
    throw metaError('Meta', error);
  }
}

function payloadMedia(payload: PublishPayload): PublishMedia[] {
  if (payload.mediaItems?.length) return payload.mediaItems;
  return payload.media ? [payload.media] : [];
}

function publicMediaUrl(platform: string, media: PublishMedia): string {
  let parsed: URL | null = null;
  try {
    parsed = media.url ? new URL(media.url) : null;
  } catch {
    parsed = null;
  }
  if (!parsed || parsed.protocol !== 'https:') {
    const error = new Error(`${platform} requires a public media URL. Configure APP_URL with public HTTPS and process the media again.`) as ProviderError;
    error.code = 'public_media_url_required';
    error.statusCode = 422;
    throw error;
  }
  return parsed.toString();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForInstagramContainer(containerId: string, accessToken: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await axios.get(`${graphBase()}/${encodeURIComponent(containerId)}`, {
      params: { fields: 'status_code,status', access_token: accessToken },
      timeout: 12000
    });
    const status = String(response.data?.status_code || '').toUpperCase();
    if (status === 'FINISHED' || !status) return;
    if (['ERROR', 'EXPIRED'].includes(status)) {
      const error = new Error(`Instagram media processing ended with ${status.toLowerCase()}: ${response.data?.status || 'no details returned'}`) as ProviderError;
      error.code = 'instagram_container_failed';
      error.details = { containerId, status, providerStatus: String(response.data?.status || '') };
      throw error;
    }
    await delay(3000);
  }
  const error = new Error('Instagram is still processing the media after four minutes. Retry the publish job shortly.') as ProviderError;
  error.code = 'instagram_container_timeout';
  error.retryable = true;
  throw error;
}

async function createInstagramContainer(account: SocialAccountCredentials, payload: PublishPayload): Promise<string> {
  const media = payloadMedia(payload);
  const create = async (params: Record<string, string | boolean>) => {
    const response = await axios.post(`${graphBase()}/${encodeURIComponent(account.externalAccountId)}/media`, null, {
      params: { ...params, access_token: account.accessToken }, timeout: 15000
    });
    const id = String(response.data?.id || '');
    if (!id) throw new Error('Instagram did not return a media container ID.');
    return id;
  };

  if (media.length === 1) {
    const item = media[0];
    const containerId = await create(item.kind === 'video'
      ? { media_type: 'REELS', video_url: publicMediaUrl('Instagram', item), caption: payload.text, share_to_feed: true }
      : { image_url: publicMediaUrl('Instagram', item), caption: payload.text });
    await waitForInstagramContainer(containerId, account.accessToken);
    return containerId;
  }

  const childIds: string[] = [];
  for (const item of media) {
    const childId = await create(item.kind === 'video'
      ? { media_type: 'VIDEO', video_url: publicMediaUrl('Instagram', item), is_carousel_item: true }
      : { image_url: publicMediaUrl('Instagram', item), is_carousel_item: true });
    await waitForInstagramContainer(childId, account.accessToken);
    childIds.push(childId);
  }
  const parent = await create({ media_type: 'CAROUSEL', children: childIds.join(','), caption: payload.text });
  await waitForInstagramContainer(parent, account.accessToken);
  return parent;
}

async function publishInstagram(account: SocialAccountCredentials, payload: PublishPayload): Promise<PublishResult> {
  const media = payloadMedia(payload);
  if (!media.length) {
    const error = new Error('Instagram requires at least one image or video.') as ProviderError;
    error.code = 'media_required';
    error.statusCode = 422;
    throw error;
  }
  if (media.length > 10) {
    const error = new Error('Instagram carousels can contain at most 10 media items.') as ProviderError;
    error.code = 'too_many_media_items';
    error.statusCode = 422;
    throw error;
  }
  if (account.accessToken.startsWith('sandbox_') || account.metadata.sandbox === true) {
    const id = `ig_sandbox_${Date.now()}`;
    return { platformPostId: id, platformUrl: `https://www.instagram.com/p/${id}/`, firstCommentId: payload.firstComment ? `comment_${id}` : '' };
  }
  try {
    const creationId = await createInstagramContainer(account, payload);
    const published = await axios.post(`${graphBase()}/${encodeURIComponent(account.externalAccountId)}/media_publish`, null, {
      params: { creation_id: creationId, access_token: account.accessToken }, timeout: 20000
    });
    const postId = String(published.data?.id || '');
    if (!postId) throw new Error('Instagram accepted the container but did not return a post ID.');
    let platformUrl = '';
    try {
      const details = await axios.get(`${graphBase()}/${encodeURIComponent(postId)}`, {
        params: { fields: 'permalink', access_token: account.accessToken }, timeout: 10000
      });
      platformUrl = String(details.data?.permalink || '');
    } catch {
      platformUrl = '';
    }
    let firstCommentId = '';
    let warning = '';
    if (payload.firstComment) {
      try {
        const comment = await axios.post(`${graphBase()}/${encodeURIComponent(postId)}/comments`, null, {
          params: { message: payload.firstComment, access_token: account.accessToken }, timeout: 12000
        });
        firstCommentId = String(comment.data?.id || '');
      } catch (error) {
        warning = metaError('Instagram first comment', error).message;
      }
    }
    return {
      platformPostId: postId,
      platformUrl: platformUrl || `https://www.instagram.com/${String(account.metadata.username || '')}`,
      firstCommentId,
      warning
    };
  } catch (error) {
    if ((error as ProviderError).code && !axios.isAxiosError(error)) throw error;
    throw metaError('Instagram', error);
  }
}

async function facebookPermalink(postId: string, accessToken: string): Promise<string> {
  try {
    const response = await axios.get(`${graphBase()}/${encodeURIComponent(postId)}`, {
      params: { fields: 'permalink_url', access_token: accessToken }, timeout: 10000
    });
    return String(response.data?.permalink_url || '');
  } catch {
    return '';
  }
}

async function waitForFacebookVideo(videoId: string, accessToken: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await axios.get(`${graphBase()}/${encodeURIComponent(videoId)}`, {
      params: { fields: 'status', access_token: accessToken }, timeout: 12000
    });
    const status = response.data?.status || {};
    const videoStatus = String(status.video_status || '').toLowerCase();
    const processingStatus = String(status.processing_phase?.status || '').toLowerCase();
    const publishingStatus = String(status.publishing_phase?.status || '').toLowerCase();
    if (['ready', 'published', 'complete'].includes(videoStatus) || publishingStatus === 'complete') return;
    if ([videoStatus, processingStatus, publishingStatus].some((value) => ['error', 'failed'].includes(value))) {
      const error = new Error('Facebook could not process the uploaded video.') as ProviderError;
      error.code = 'facebook_video_processing_failed';
      error.details = { videoId, videoStatus, processingStatus, publishingStatus };
      throw error;
    }
    await delay(3000);
  }
  const error = new Error('Facebook is still processing the video. Retry the publish job shortly.') as ProviderError;
  error.code = 'facebook_video_processing_timeout';
  error.retryable = true;
  throw error;
}

async function publishFacebook(account: SocialAccountCredentials, payload: PublishPayload): Promise<PublishResult> {
  if (account.accessToken.startsWith('sandbox_') || account.metadata.sandbox === true) {
    const id = `${account.externalAccountId}_${Date.now()}`;
    return { platformPostId: id, platformUrl: `https://www.facebook.com/${id}`, firstCommentId: payload.firstComment ? `comment_${id}` : '' };
  }
  const media = payloadMedia(payload);
  try {
    let postId = '';
    if (!media.length) {
      const response = await axios.post(`${graphBase()}/${encodeURIComponent(account.externalAccountId)}/feed`, null, {
        params: { message: payload.text, access_token: account.accessToken }, timeout: 15000
      });
      postId = String(response.data?.id || '');
    } else if (media.length === 1 && media[0].kind === 'image') {
      const response = await axios.post(`${graphBase()}/${encodeURIComponent(account.externalAccountId)}/photos`, null, {
        params: {
          url: publicMediaUrl('Facebook', media[0]),
          caption: payload.text,
          published: true,
          access_token: account.accessToken
        },
        timeout: 20000
      });
      postId = String(response.data?.post_id || response.data?.id || '');
    } else if (media.length === 1 && media[0].kind === 'video') {
      const response = await axios.post(`${graphBase()}/${encodeURIComponent(account.externalAccountId)}/videos`, null, {
        params: {
          file_url: publicMediaUrl('Facebook', media[0]),
          description: payload.text,
          title: payload.title || '',
          access_token: account.accessToken
        },
        timeout: 30000
      });
      postId = String(response.data?.id || '');
      if (postId) await waitForFacebookVideo(postId, account.accessToken);
    } else {
      if (media.some((item) => item.kind !== 'image')) {
        const error = new Error('Facebook carousels currently support images only.') as ProviderError;
        error.code = 'mixed_media_not_supported';
        error.statusCode = 422;
        throw error;
      }
      const photoIds: string[] = [];
      for (const item of media) {
        const uploaded = await axios.post(`${graphBase()}/${encodeURIComponent(account.externalAccountId)}/photos`, null, {
          params: {
            url: publicMediaUrl('Facebook', item),
            published: false,
            access_token: account.accessToken
          },
          timeout: 20000
        });
        photoIds.push(String(uploaded.data?.id || ''));
      }
      const response = await axios.post(`${graphBase()}/${encodeURIComponent(account.externalAccountId)}/feed`, null, {
        params: {
          message: payload.text,
          attached_media: JSON.stringify(photoIds.filter(Boolean).map((id) => ({ media_fbid: id }))),
          access_token: account.accessToken
        },
        timeout: 20000
      });
      postId = String(response.data?.id || '');
    }
    if (!postId) throw new Error('Facebook accepted the request but did not return a post ID.');
    let firstCommentId = '';
    let warning = '';
    if (payload.firstComment) {
      try {
        const comment = await axios.post(`${graphBase()}/${encodeURIComponent(postId)}/comments`, null, {
          params: { message: payload.firstComment, access_token: account.accessToken }, timeout: 12000
        });
        firstCommentId = String(comment.data?.id || '');
      } catch (error) {
        warning = metaError('Facebook first comment', error).message;
      }
    }
    return {
      platformPostId: postId,
      platformUrl: await facebookPermalink(postId, account.accessToken) || `https://www.facebook.com/${postId}`,
      firstCommentId,
      warning
    };
  } catch (error) {
    if ((error as ProviderError).code && !axios.isAxiosError(error)) throw error;
    throw metaError('Facebook', error);
  }
}

abstract class BaseMetaProvider implements SocialProvider {
  abstract readonly platform: 'facebook' | 'instagram';

  async getAuthorizationRequest(input: { state: string }): Promise<AuthorizationRequest> {
    return authorizationRequest(input.state);
  }

  async connect(code: string, _context: ConnectContext = {}): Promise<ConnectedAccount[]> {
    return connectMeta(code);
  }

  async refreshToken(account: SocialAccountCredentials): Promise<Tokens> {
    return refreshMetaToken(account);
  }

  abstract publish(account: SocialAccountCredentials, payload: PublishPayload): Promise<PublishResult>;
}

export class FacebookProvider extends BaseMetaProvider {
  readonly platform = 'facebook' as const;
  async publish(account: SocialAccountCredentials, payload: PublishPayload): Promise<PublishResult> {
    if (!account.accessToken.startsWith('sandbox_') && account.metadata.sandbox !== true) assertMetaEnabled();
    return publishFacebook(account, payload);
  }

  async getMetrics(account: SocialAccountCredentials, post: PublishedPostReference): Promise<EngagementMetricsResult> {
    if (account.accessToken.startsWith('sandbox_') || account.metadata.sandbox === true) {
      return engagementMetricsResult(sandboxMetrics(account.metadata), { source: 'sandbox' });
    }
    assertMetaEnabled();
    try {
      const [postResponse, insightResponse] = await Promise.all([
        axios.get(`${graphBase()}/${encodeURIComponent(post.platformPostId)}`, {
          params: {
            fields: 'shares,likes.limit(0).summary(true),comments.limit(0).summary(true)',
            access_token: account.accessToken
          },
          timeout: 12000
        }),
        axios.get(`${graphBase()}/${encodeURIComponent(post.platformPostId)}/insights`, {
          params: {
            metric: 'post_impressions,post_impressions_unique,post_clicks',
            access_token: account.accessToken
          },
          timeout: 12000
        }).catch(() => ({ data: { data: [] } }))
      ]);
      const insights = Array.isArray(insightResponse.data?.data) ? insightResponse.data.data : [];
      const insightValues = Object.fromEntries(insights.map((row: Record<string, unknown>) => {
        const values = Array.isArray(row.values) ? row.values : [];
        const latest = values[values.length - 1];
        return [String(row.name || ''), latest && typeof latest === 'object' ? (latest as Record<string, unknown>).value : null];
      }));
      return engagementMetricsResult({
        impressions: insightValues.post_impressions,
        reach: insightValues.post_impressions_unique,
        likes: postResponse.data?.likes?.summary?.total_count,
        comments: postResponse.data?.comments?.summary?.total_count,
        shares: postResponse.data?.shares?.count,
        clicks: insightValues.post_clicks
      }, { insightsAvailable: insights.length > 0 });
    } catch (error) {
      throw metaError('Facebook metrics', error);
    }
  }
}

export class InstagramProvider extends BaseMetaProvider {
  readonly platform = 'instagram' as const;
  async publish(account: SocialAccountCredentials, payload: PublishPayload): Promise<PublishResult> {
    if (!account.accessToken.startsWith('sandbox_') && account.metadata.sandbox !== true) assertMetaEnabled();
    return publishInstagram(account, payload);
  }

  async getMetrics(account: SocialAccountCredentials, post: PublishedPostReference): Promise<EngagementMetricsResult> {
    if (account.accessToken.startsWith('sandbox_') || account.metadata.sandbox === true) {
      return engagementMetricsResult(sandboxMetrics(account.metadata), { source: 'sandbox' });
    }
    assertMetaEnabled();
    try {
      const [mediaResponse, insightResponse] = await Promise.all([
        axios.get(`${graphBase()}/${encodeURIComponent(post.platformPostId)}`, {
          params: { fields: 'like_count,comments_count,media_type', access_token: account.accessToken },
          timeout: 12000
        }),
        axios.get(`${graphBase()}/${encodeURIComponent(post.platformPostId)}/insights`, {
          params: { metric: 'views,reach,shares,saved,total_interactions', access_token: account.accessToken },
          timeout: 12000
        }).catch(() => ({ data: { data: [] } }))
      ]);
      const insights = Array.isArray(insightResponse.data?.data) ? insightResponse.data.data : [];
      const values = Object.fromEntries(insights.map((row: Record<string, unknown>) => {
        const totalValue = row.total_value && typeof row.total_value === 'object'
          ? (row.total_value as Record<string, unknown>).value
          : row.value;
        return [String(row.name || ''), totalValue];
      }));
      const video = String(mediaResponse.data?.media_type || '').toUpperCase() === 'VIDEO';
      return engagementMetricsResult({
        views: values.views,
        videoViews: video ? values.views : null,
        reach: values.reach,
        likes: mediaResponse.data?.like_count,
        comments: mediaResponse.data?.comments_count,
        shares: values.shares,
        saves: values.saved
      }, {
        insightsAvailable: insights.length > 0,
        totalInteractions: values.total_interactions ?? null
      });
    } catch (error) {
      throw metaError('Instagram metrics', error);
    }
  }
}

export { META_SCOPES, connectMeta, metaError };
