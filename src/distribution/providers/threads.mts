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

const THREADS_SCOPES = ['threads_basic', 'threads_content_publish', 'threads_manage_replies', 'threads_read_replies', 'threads_manage_insights'];

type ThreadsError = Error & {
  code?: string;
  statusCode?: number;
  providerCode?: string;
  providerSubcode?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
};

function threadsBase(): string {
  return `https://graph.threads.net/${distributionConfig.threadsGraphVersion}`;
}

function assertThreadsEnabled(): void {
  if (distributionConfig.socialEnableThreads) return;
  const error = new Error('Threads publishing is disabled while the app is awaiting review. Set SOCIAL_ENABLE_THREADS=true after approval.') as ThreadsError;
  error.code = 'provider_disabled';
  error.statusCode = 503;
  throw error;
}

function threadsError(error: unknown): ThreadsError {
  const response = axios.isAxiosError(error) ? error.response : undefined;
  const data = response?.data as Record<string, unknown> | undefined;
  const provider = data && typeof data.error === 'object' ? data.error as Record<string, unknown> : data || {};
  const providerCode = String(provider.code || response?.status || 'unknown');
  const providerSubcode = String(provider.error_subcode || '');
  const message = String(provider.error_user_msg || provider.message || (error instanceof Error ? error.message : 'The provider rejected the request.'));
  const wrapped = new Error(`Threads rejected the post: ${message}`) as ThreadsError;
  wrapped.code = providerCode === '190' ? 'reauthorization_required' : 'threads_request_failed';
  wrapped.statusCode = response?.status;
  wrapped.providerCode = providerCode;
  wrapped.providerSubcode = providerSubcode;
  wrapped.retryable = Boolean(response && (response.status === 429 || response.status >= 500));
  wrapped.details = {
    providerCode,
    ...(providerSubcode ? { providerSubcode } : {}),
    ...(provider.fbtrace_id ? { traceId: String(provider.fbtrace_id) } : {})
  };
  return wrapped;
}

function mediaItems(payload: PublishPayload): PublishMedia[] {
  if (payload.mediaItems?.length) return payload.mediaItems;
  return payload.media ? [payload.media] : [];
}

function mediaUrl(media: PublishMedia): string {
  try {
    if (media.url && new URL(media.url).protocol === 'https:') return media.url;
  } catch {
    // The friendly configuration error below is more useful than URL's parser error.
  }
  const error = new Error('Threads requires a public HTTPS media URL. Configure APP_URL and process this media again.') as ThreadsError;
  error.code = 'public_media_url_required';
  error.statusCode = 422;
  throw error;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForContainer(containerId: string, accessToken: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await axios.get(`${threadsBase()}/${encodeURIComponent(containerId)}`, {
      params: { fields: 'status,error_message', access_token: accessToken }, timeout: 12000
    });
    const status = String(response.data?.status || '').toUpperCase();
    if (['FINISHED', 'PUBLISHED'].includes(status) || !status) return;
    if (['ERROR', 'EXPIRED'].includes(status)) {
      const error = new Error(`Threads could not process the media: ${response.data?.error_message || status}.`) as ThreadsError;
      error.code = 'threads_container_failed';
      error.details = { containerId, status };
      throw error;
    }
    await delay(3000);
  }
  const error = new Error('Threads is still processing the media. Retry the publish job shortly.') as ThreadsError;
  error.code = 'threads_container_timeout';
  error.retryable = true;
  throw error;
}

export class ThreadsProvider implements SocialProvider {
  readonly platform = 'threads' as const;

  async getAuthorizationRequest(input: { state: string }): Promise<AuthorizationRequest> {
    assertThreadsEnabled();
    const clientId = requireValue(distributionConfig.threadsAppId, 'Threads OAuth is not configured. Add THREADS_APP_ID.');
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: distributionConfig.threadsRedirectUri,
      scope: THREADS_SCOPES.join(','),
      response_type: 'code',
      state: input.state
    });
    return { url: `https://threads.net/oauth/authorize?${params.toString()}` };
  }

  async connect(code: string, _context: ConnectContext = {}): Promise<ConnectedAccount[]> {
    assertThreadsEnabled();
    if (code.startsWith('sandbox_')) {
      return [{
        platform: 'threads',
        accountName: '@moyi_threads_sandbox',
        externalAccountId: 'threads_sandbox_user',
        accessToken: 'sandbox_threads_access',
        refreshToken: 'sandbox_threads_access',
        expiresInSeconds: 5184000,
        scopes: THREADS_SCOPES,
        metadata: { username: 'moyi_threads_sandbox' }
      }];
    }
    requireValue(distributionConfig.threadsAppId, 'Threads OAuth is not configured. Add THREADS_APP_ID.');
    requireValue(distributionConfig.threadsAppSecret, 'Threads OAuth is not configured. Add THREADS_APP_SECRET.');
    try {
      const token = await axios.post('https://graph.threads.net/oauth/access_token', null, {
        params: {
          client_id: distributionConfig.threadsAppId,
          client_secret: distributionConfig.threadsAppSecret,
          grant_type: 'authorization_code',
          redirect_uri: distributionConfig.threadsRedirectUri,
          code
        },
        timeout: 15000
      });
      const shortToken = String(token.data?.access_token || '');
      const long = await axios.get('https://graph.threads.net/access_token', {
        params: {
          grant_type: 'th_exchange_token',
          client_secret: distributionConfig.threadsAppSecret,
          access_token: shortToken
        },
        timeout: 15000
      });
      const accessToken = String(long.data?.access_token || shortToken);
      const profile = await axios.get(`${threadsBase()}/me`, {
        params: { fields: 'id,username,threads_profile_picture_url', access_token: accessToken },
        timeout: 12000
      });
      const username = String(profile.data?.username || '');
      return [{
        platform: 'threads',
        accountName: username ? `@${username}` : 'Threads profile',
        externalAccountId: String(profile.data?.id || token.data?.user_id || ''),
        accessToken,
        refreshToken: accessToken,
        expiresInSeconds: Number(long.data?.expires_in || 5184000),
        scopes: THREADS_SCOPES,
        metadata: { username }
      }];
    } catch (error) {
      throw threadsError(error);
    }
  }

  async refreshToken(account: SocialAccountCredentials): Promise<Tokens> {
    if (account.accessToken.startsWith('sandbox_')) return { expiresInSeconds: 5184000 };
    assertThreadsEnabled();
    requireValue(account.refreshToken || account.accessToken, 'Threads did not return a renewable token. Reconnect the account.');
    try {
      const response = await axios.get('https://graph.threads.net/refresh_access_token', {
        params: {
          grant_type: 'th_refresh_token',
          access_token: account.refreshToken || account.accessToken
        },
        timeout: 15000
      });
      const accessToken = String(response.data?.access_token || '');
      return {
        accessToken,
        refreshToken: accessToken,
        expiresInSeconds: Number(response.data?.expires_in || 5184000),
        scopes: account.scopes
      };
    } catch (error) {
      throw threadsError(error);
    }
  }

  async publish(account: SocialAccountCredentials, payload: PublishPayload): Promise<PublishResult> {
    if (!account.accessToken.startsWith('sandbox_') && account.metadata.sandbox !== true) assertThreadsEnabled();
    const media = mediaItems(payload);
    if (media.length > 20) {
      const error = new Error('Threads carousels can contain at most 20 media items.') as ThreadsError;
      error.code = 'too_many_media_items';
      error.statusCode = 422;
      throw error;
    }
    if (account.accessToken.startsWith('sandbox_') || account.metadata.sandbox === true) {
      const id = `threads_sandbox_${Date.now()}`;
      return { platformPostId: id, platformUrl: `https://www.threads.net/@${account.metadata.username || 'moyi'}/post/${id}` };
    }
    try {
      const create = async (params: Record<string, string | boolean>) => {
        const response = await axios.post(`${threadsBase()}/${encodeURIComponent(account.externalAccountId)}/threads`, null, {
          params: { ...params, access_token: account.accessToken }, timeout: 15000
        });
        const id = String(response.data?.id || '');
        if (!id) throw new Error('Threads did not return a media container ID.');
        return id;
      };

      let creationId = '';
      if (!media.length) {
        creationId = await create({ media_type: 'TEXT', text: payload.text });
      } else if (media.length === 1) {
        const item = media[0];
        creationId = await create(item.kind === 'video'
          ? { media_type: 'VIDEO', video_url: mediaUrl(item), text: payload.text, alt_text: item.altText || '' }
          : { media_type: 'IMAGE', image_url: mediaUrl(item), text: payload.text, alt_text: item.altText || '' });
        await waitForContainer(creationId, account.accessToken);
      } else {
        const childIds: string[] = [];
        for (const item of media) {
          const child = await create(item.kind === 'video'
            ? { media_type: 'VIDEO', video_url: mediaUrl(item), is_carousel_item: true, alt_text: item.altText || '' }
            : { media_type: 'IMAGE', image_url: mediaUrl(item), is_carousel_item: true, alt_text: item.altText || '' });
          await waitForContainer(child, account.accessToken);
          childIds.push(child);
        }
        creationId = await create({ media_type: 'CAROUSEL', children: childIds.join(','), text: payload.text });
        await waitForContainer(creationId, account.accessToken);
      }

      const published = await axios.post(`${threadsBase()}/${encodeURIComponent(account.externalAccountId)}/threads_publish`, null, {
        params: { creation_id: creationId, access_token: account.accessToken }, timeout: 20000
      });
      const postId = String(published.data?.id || '');
      if (!postId) throw new Error('Threads accepted the container but did not return a post ID.');
      let permalink = '';
      try {
        const details = await axios.get(`${threadsBase()}/${encodeURIComponent(postId)}`, {
          params: { fields: 'permalink', access_token: account.accessToken }, timeout: 10000
        });
        permalink = String(details.data?.permalink || '');
      } catch {
        permalink = '';
      }
      return {
        platformPostId: postId,
        platformUrl: permalink || `https://www.threads.net/@${String(account.metadata.username || '')}`
      };
    } catch (error) {
      if ((error as ThreadsError).code && !axios.isAxiosError(error)) throw error;
      throw threadsError(error);
    }
  }

  async getMetrics(account: SocialAccountCredentials, post: PublishedPostReference): Promise<EngagementMetricsResult> {
    if (account.accessToken.startsWith('sandbox_') || account.metadata.sandbox === true) {
      return engagementMetricsResult(sandboxMetrics(account.metadata), { source: 'sandbox' });
    }
    assertThreadsEnabled();
    try {
      const response = await axios.get(`${threadsBase()}/${encodeURIComponent(post.platformPostId)}/insights`, {
        params: {
          metric: 'views,likes,replies,reposts,quotes,shares',
          access_token: account.accessToken
        },
        timeout: 12000
      });
      const rows = Array.isArray(response.data?.data) ? response.data.data : [];
      const values = Object.fromEntries(rows.map((row: Record<string, unknown>) => {
        const entries = Array.isArray(row.values) ? row.values : [];
        const value = entries[entries.length - 1] && typeof entries[entries.length - 1] === 'object'
          ? (entries[entries.length - 1] as Record<string, unknown>).value
          : row.total_value && typeof row.total_value === 'object'
            ? (row.total_value as Record<string, unknown>).value
            : row.value;
        return [String(row.name || ''), value];
      }));
      return engagementMetricsResult({
        views: values.views,
        likes: values.likes,
        comments: values.replies,
        shares: values.shares ?? values.reposts,
        quotes: values.quotes
      });
    } catch (error) {
      throw threadsError(error);
    }
  }
}

export { THREADS_SCOPES, threadsError };
