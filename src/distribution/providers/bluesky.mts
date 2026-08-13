import axios from 'axios';
import { Agent } from '@atproto/api';
import { BLUESKY_SCOPE, getBlueskyOAuthClient } from '../bluesky-client.mjs';
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
import { providerError } from '../provider-error.mjs';
import { engagementMetricsResult, sandboxMetrics } from '../metrics.mjs';
import type { EngagementMetricsResult, PublishedPostReference } from '../types.mjs';

function graphemeCount(value: string): number {
  return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)).length;
}

function scopes(value: string): string[] {
  return value.split(/\s+/).filter(Boolean);
}

async function publicProfile(did: string): Promise<{ handle: string; displayName: string }> {
  try {
    const response = await axios.get('https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile', {
      params: { actor: did },
      timeout: 10000
    });
    return {
      handle: String(response.data?.handle || ''),
      displayName: String(response.data?.displayName || '')
    };
  } catch {
    return { handle: '', displayName: '' };
  }
}

export class BlueskyProvider implements SocialProvider {
  readonly platform = 'bluesky' as const;

  async getAuthorizationRequest(input: { state: string; handle?: string }): Promise<AuthorizationRequest> {
    if (!input.handle) {
      const error = new Error('Enter the Bluesky handle you want to connect.') as Error & { statusCode?: number };
      error.statusCode = 400;
      throw error;
    }
    const client = await getBlueskyOAuthClient();
    const url = await client.authorize(input.handle, { scope: BLUESKY_SCOPE, state: input.state });
    return { url: url.toString() };
  }

  async connect(_code: string, context: ConnectContext = {}): Promise<ConnectedAccount[]> {
    if (!context.callbackParams) throw new Error('Bluesky did not return complete OAuth callback parameters.');
    try {
      const client = await getBlueskyOAuthClient();
      const { session, state } = await client.callback(context.callbackParams);
      const tokenInfo = await session.getTokenInfo(false);
      const profile = await publicProfile(session.did);
      const handle = profile.handle || context.handle || session.did;
      return [{
        platform: 'bluesky',
        accountName: profile.displayName ? `${profile.displayName} (@${handle})` : `@${handle}`,
        externalAccountId: session.did,
        accessToken: '',
        refreshToken: '',
        expiresInSeconds: tokenInfo.expiresAt
          ? Math.max(0, Math.floor((tokenInfo.expiresAt.getTime() - Date.now()) / 1000))
          : null,
        expiresAt: tokenInfo.expiresAt || null,
        scopes: scopes(tokenInfo.scope),
        metadata: {
          appState: state || '',
          handle,
          oauthSessionKey: session.did
        }
      }];
    } catch (error) {
      throw providerError('Bluesky', error);
    }
  }

  async refreshToken(account: SocialAccountCredentials): Promise<Tokens> {
    try {
      const sessionKey = String(account.metadata.oauthSessionKey || account.externalAccountId);
      const client = await getBlueskyOAuthClient();
      const session = await client.restore(sessionKey, true);
      const tokenInfo = await session.getTokenInfo(false);
      return {
        expiresAt: tokenInfo.expiresAt || null,
        scopes: scopes(tokenInfo.scope),
        metadata: { ...account.metadata, oauthSessionKey: session.did }
      };
    } catch (error) {
      throw providerError('Bluesky', error);
    }
  }

  async publish(account: SocialAccountCredentials, payload: PublishPayload): Promise<PublishResult> {
    if (graphemeCount(payload.text) > 300) {
      const error = new Error('Bluesky posts can contain at most 300 characters.') as Error & { code?: string };
      error.code = 'content_too_long';
      throw error;
    }
    const media = payload.mediaItems?.length ? payload.mediaItems : payload.media ? [payload.media] : [];
    if (media.some((item) => item.kind !== 'image')) {
      const error = new Error('Bluesky video publishing is not enabled in this release.') as Error & { code?: string };
      error.code = 'video_not_supported';
      throw error;
    }
    if (media.length > 4) {
      const error = new Error('Bluesky posts can contain at most four images.') as Error & { code?: string };
      error.code = 'too_many_media_items';
      throw error;
    }
    if (media.some((item) => item.size > 2 * 1024 * 1024)) {
      const error = new Error('Bluesky images must be 2 MB or smaller.') as Error & { code?: string };
      error.code = 'media_too_large';
      throw error;
    }
    if (account.metadata.sandbox === true) {
      const id = `3sandbox${Date.now()}`;
      return { platformPostId: `at://${account.externalAccountId}/app.bsky.feed.post/${id}`, platformUrl: `https://bsky.app/profile/${account.externalAccountId}/post/${id}` };
    }

    try {
      const sessionKey = String(account.metadata.oauthSessionKey || account.externalAccountId);
      const client = await getBlueskyOAuthClient();
      const session = await client.restore(sessionKey, 'auto');
      const agent = new Agent(session);
      let embed: Parameters<Agent['post']>[0]['embed'];

      if (media.length) {
        const images = [];
        for (const item of media) {
          if (!item.buffer) throw new Error('The processed Bluesky image could not be opened.');
          const uploaded = await agent.uploadBlob(item.buffer, { encoding: item.mimeType });
          images.push({ alt: item.altText || '', image: uploaded.data.blob });
        }
        embed = {
          $type: 'app.bsky.embed.images' as const,
          images
        };
      }

      const result = await agent.post({
        text: payload.text,
        ...(embed ? { embed } : {})
      });
      const rkey = result.uri.split('/').pop() || '';
      const handle = String(account.metadata.handle || account.externalAccountId);
      return {
        platformPostId: result.uri,
        platformUrl: `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${encodeURIComponent(rkey)}`
      };
    } catch (error) {
      throw providerError('Bluesky', error);
    }
  }

  async getMetrics(account: SocialAccountCredentials, post: PublishedPostReference): Promise<EngagementMetricsResult> {
    if (account.metadata.sandbox === true) {
      return engagementMetricsResult(sandboxMetrics(account.metadata), { source: 'sandbox' });
    }
    try {
      const params = new URLSearchParams();
      params.append('uris', post.platformPostId);
      const response = await axios.get(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?${params.toString()}`, {
        timeout: 10000
      });
      const item = Array.isArray(response.data?.posts) ? response.data.posts[0] : null;
      if (!item) {
        const error = new Error('Bluesky could not find the published post.') as Error & { code?: string; statusCode?: number };
        error.code = 'post_not_found';
        error.statusCode = 404;
        throw error;
      }
      return engagementMetricsResult({
        likes: item.likeCount,
        comments: item.replyCount,
        shares: item.repostCount,
        quotes: item.quoteCount
      });
    } catch (error) {
      if ((error as Error & { code?: string }).code === 'post_not_found') throw error;
      throw providerError('Bluesky metrics', error);
    }
  }
}
