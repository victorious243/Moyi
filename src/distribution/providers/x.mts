import crypto from 'node:crypto';
import axios from 'axios';
import { distributionConfig } from '../config.mjs';
import { providerError, requireValue } from '../provider-error.mjs';
import { engagementMetricsResult, sandboxMetrics } from '../metrics.mjs';
import type {
  AuthorizationRequest,
  ConnectedAccount,
  ConnectContext,
  PublishPayload,
  PublishResult,
  SocialAccountCredentials,
  SocialProvider,
  Tokens
} from '../types.mjs';
import type { EngagementMetricsResult, PublishedPostReference } from '../types.mjs';

const X_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access'];

function base64Url(value: Buffer): string {
  return value.toString('base64url');
}

function tokenHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (distributionConfig.twitterClientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${distributionConfig.twitterClientId}:${distributionConfig.twitterClientSecret}`).toString('base64')}`;
  }
  return headers;
}

function tokenExpiry(seconds: number | null | undefined): Date | null {
  return seconds ? new Date(Date.now() + seconds * 1000) : null;
}

export class XProvider implements SocialProvider {
  readonly platform = 'x' as const;

  async getAuthorizationRequest(input: { state: string }): Promise<AuthorizationRequest> {
    const clientId = requireValue(distributionConfig.twitterClientId, 'X OAuth is not configured. Add TWITTER_CLIENT_ID.');
    const codeVerifier = base64Url(crypto.randomBytes(48));
    const codeChallenge = base64Url(crypto.createHash('sha256').update(codeVerifier).digest());
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: distributionConfig.twitterRedirectUri,
      state: input.state,
      scope: X_SCOPES.join(' '),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });
    return { url: `https://x.com/i/oauth2/authorize?${params.toString()}`, codeVerifier };
  }

  async connect(code: string, context: ConnectContext = {}): Promise<ConnectedAccount[]> {
    requireValue(distributionConfig.twitterClientId, 'X OAuth is not configured. Add TWITTER_CLIENT_ID.');
    if (!context.codeVerifier) throw new Error('The X OAuth verifier expired. Start the connection again.');
    try {
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: distributionConfig.twitterRedirectUri,
        client_id: distributionConfig.twitterClientId,
        code_verifier: context.codeVerifier
      });
      const response = await axios.post('https://api.x.com/2/oauth2/token', params.toString(), {
        headers: tokenHeaders(), timeout: 12000
      });
      const accessToken = String(response.data.access_token || '');
      const profile = await axios.get('https://api.x.com/2/users/me', {
        headers: { Authorization: `Bearer ${accessToken}` }, timeout: 10000
      });
      const user = profile.data?.data || {};
      const expiresInSeconds = Number(response.data.expires_in || 7200);
      return [{
        platform: 'x',
        accountName: user.username ? `@${user.username}` : String(user.name || 'X account'),
        externalAccountId: String(user.id || ''),
        accessToken,
        refreshToken: String(response.data.refresh_token || ''),
        expiresInSeconds,
        expiresAt: tokenExpiry(expiresInSeconds),
        scopes: String(response.data.scope || X_SCOPES.join(' ')).split(/\s+/).filter(Boolean),
        metadata: { username: String(user.username || '') }
      }];
    } catch (error) {
      throw providerError('X', error);
    }
  }

  async refreshToken(account: SocialAccountCredentials): Promise<Tokens> {
    requireValue(account.refreshToken, 'X did not return a refresh token. Reconnect the account with offline access.');
    try {
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: account.refreshToken,
        client_id: distributionConfig.twitterClientId
      });
      const response = await axios.post('https://api.x.com/2/oauth2/token', params.toString(), {
        headers: tokenHeaders(), timeout: 12000
      });
      return {
        accessToken: String(response.data.access_token || ''),
        refreshToken: String(response.data.refresh_token || account.refreshToken),
        expiresInSeconds: Number(response.data.expires_in || 7200),
        scopes: String(response.data.scope || account.scopes.join(' ')).split(/\s+/).filter(Boolean)
      };
    } catch (error) {
      throw providerError('X', error);
    }
  }

  async publish(account: SocialAccountCredentials, payload: PublishPayload): Promise<PublishResult> {
    const media = payload.mediaItems?.length ? payload.mediaItems : payload.media ? [payload.media] : [];
    if (media.some((item) => item.kind !== 'image')) {
      const error = new Error('X video publishing is not enabled in this release.') as Error & { code?: string };
      error.code = 'video_not_supported';
      throw error;
    }
    if (media.length > 4) {
      const error = new Error('X posts can contain at most four images.') as Error & { code?: string };
      error.code = 'too_many_media_items';
      throw error;
    }
    if (media.some((item) => item.size > 5 * 1024 * 1024)) {
      const error = new Error('X images must be 5 MB or smaller.') as Error & { code?: string };
      error.code = 'media_too_large';
      throw error;
    }
    if (account.accessToken.startsWith('sandbox_') || account.metadata.sandbox === true) {
      const id = `x_sandbox_${Date.now()}`;
      return { platformPostId: id, platformUrl: `https://x.com/i/web/status/${id}` };
    }
    if (media.length && !account.scopes.includes('media.write')) {
      const error = new Error('Reconnect X to allow media uploads. The current token can publish text, but it was not granted the media.write scope.') as Error & {
        code?: string;
        statusCode?: number;
      };
      error.code = 'reauthorization_required';
      error.statusCode = 403;
      throw error;
    }

    try {
      const body: Record<string, unknown> = { text: payload.text };
      if (media.length) {
        const mediaIds: string[] = [];
        for (const item of media) {
          if (!item.buffer) throw new Error('The processed X image could not be opened.');
          const upload = await axios.post(
            'https://api.x.com/2/media/upload',
            {
              media: item.buffer.toString('base64'),
              media_category: 'tweet_image',
              media_type: item.mimeType
            },
            {
              headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json' },
              timeout: 30000,
              maxBodyLength: 10 * 1024 * 1024
            }
          );
          const mediaId = String(upload.data?.data?.id || upload.data?.media_id_string || '');
          if (!mediaId) throw new Error('X accepted an image upload but did not return a media ID.');
          mediaIds.push(mediaId);
        }
        body.media = { media_ids: mediaIds };
      }

      const response = await axios.post('https://api.x.com/2/tweets', body, {
        headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json' },
        timeout: 12000
      });
      const postId = String(response.data?.data?.id || '');
      if (!postId) throw new Error('X accepted the post but did not return its ID.');
      return { platformPostId: postId, platformUrl: `https://x.com/i/web/status/${postId}` };
    } catch (error) {
      throw providerError('X', error);
    }
  }

  async getMetrics(account: SocialAccountCredentials, post: PublishedPostReference): Promise<EngagementMetricsResult> {
    if (account.accessToken.startsWith('sandbox_') || account.metadata.sandbox === true) {
      return engagementMetricsResult(sandboxMetrics(account.metadata), { source: 'sandbox' });
    }
    try {
      let response;
      let privateMetricsAvailable = true;
      try {
        response = await axios.get(`https://api.x.com/2/tweets/${encodeURIComponent(post.platformPostId)}`, {
          params: { 'tweet.fields': 'public_metrics,non_public_metrics,organic_metrics' },
          headers: { Authorization: `Bearer ${account.accessToken}` },
          timeout: 12000
        });
      } catch (error) {
        const status = axios.isAxiosError(error) ? Number(error.response?.status || 0) : 0;
        if (![400, 403].includes(status)) throw error;
        privateMetricsAvailable = false;
        response = await axios.get(`https://api.x.com/2/tweets/${encodeURIComponent(post.platformPostId)}`, {
          params: { 'tweet.fields': 'public_metrics' },
          headers: { Authorization: `Bearer ${account.accessToken}` },
          timeout: 12000
        });
      }
      const data = response.data?.data || {};
      const publicMetrics = data.public_metrics || {};
      const ownedMetrics = data.organic_metrics || data.non_public_metrics || {};
      const impressions = ownedMetrics.impression_count ?? publicMetrics.impression_count;
      const clicks = ownedMetrics.url_link_clicks === undefined && ownedMetrics.user_profile_clicks === undefined
        ? null
        : Number(ownedMetrics.url_link_clicks || 0) + Number(ownedMetrics.user_profile_clicks || 0);
      return engagementMetricsResult({
        impressions,
        likes: publicMetrics.like_count,
        comments: publicMetrics.reply_count,
        shares: publicMetrics.retweet_count,
        quotes: publicMetrics.quote_count,
        saves: publicMetrics.bookmark_count,
        clicks
      }, { privateMetricsAvailable });
    } catch (error) {
      throw providerError('X metrics', error);
    }
  }
}

export { X_SCOPES };
