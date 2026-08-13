import { getBlueskyClientMetadata, getBlueskyJwks } from './bluesky-client.mjs';
import { getSocialProvider, nativeSocialPlatforms } from './provider-registry.mjs';
import { queryTikTokCreatorInfo } from './providers/tiktok.mjs';
import type {
  ConnectContext,
  PublishPayload,
  SocialAccountCredentials,
  SocialProviderWithMetrics,
  SocialProviderWithPublishStatus
} from './types.mjs';

export async function getAuthorizationRequest(platform: string, input: { state: string; handle?: string }) {
  return getSocialProvider(platform).getAuthorizationRequest(input);
}

export async function connectProvider(platform: string, code: string, context: ConnectContext = {}) {
  return getSocialProvider(platform).connect(code, context);
}

export async function refreshProviderToken(platform: string, account: SocialAccountCredentials) {
  return getSocialProvider(platform).refreshToken(account);
}

export async function publishWithProvider(platform: string, account: SocialAccountCredentials, payload: PublishPayload) {
  return getSocialProvider(platform).publish(account, payload);
}

export async function getProviderPublishStatus(
  platform: string,
  account: SocialAccountCredentials,
  state: Record<string, unknown>
) {
  const provider = getSocialProvider(platform) as Partial<SocialProviderWithPublishStatus>;
  if (typeof provider.getPublishStatus !== 'function') {
    const error = new Error(`${platform} does not expose asynchronous publishing status.`) as Error & { code?: string };
    error.code = 'publish_status_not_supported';
    throw error;
  }
  return provider.getPublishStatus(account, state);
}

export async function getProviderMetrics(
  platform: string,
  account: SocialAccountCredentials,
  post: {
    platformPostId: string;
    platformUrl?: string;
    providerState?: Record<string, unknown>;
    publishedAt?: Date | null;
  }
) {
  const provider = getSocialProvider(platform) as Partial<SocialProviderWithMetrics>;
  if (typeof provider.getMetrics !== 'function') {
    const error = new Error(`${platform} does not expose engagement metrics.`) as Error & { code?: string };
    error.code = 'metrics_not_supported';
    throw error;
  }
  return provider.getMetrics(account, post);
}

export async function getTikTokCreatorInfo(account: SocialAccountCredentials) {
  return queryTikTokCreatorInfo(account);
}

export {
  getBlueskyClientMetadata,
  getBlueskyJwks,
  nativeSocialPlatforms
};

export type {
  AuthorizationRequest,
  ConnectedAccount,
  ConnectContext,
  EngagementMetricName,
  EngagementMetricsResult,
  PublishMedia,
  PublishPayload,
  PublishResult,
  PublishStatusResult,
  SocialAccountCredentials,
  SocialPlatform,
  SocialProvider,
  SocialProviderWithMetrics,
  SocialProviderWithPublishStatus,
  TikTokPublishOptions,
  Tokens,
  YouTubePublishOptions
} from './types.mjs';
