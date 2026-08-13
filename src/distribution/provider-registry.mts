import { BlueskyProvider } from './providers/bluesky.mjs';
import { LinkedInProvider } from './providers/linkedin.mjs';
import { FacebookProvider, InstagramProvider } from './providers/meta.mjs';
import { ThreadsProvider } from './providers/threads.mjs';
import { TikTokProvider } from './providers/tiktok.mjs';
import { XProvider } from './providers/x.mjs';
import { YouTubeProvider } from './providers/youtube.mjs';
import type { SocialPlatform, SocialProvider } from './types.mjs';

const providers = new Map<SocialPlatform, SocialProvider>([
  ['bluesky', new BlueskyProvider()],
  ['x', new XProvider()],
  ['linkedin', new LinkedInProvider()],
  ['facebook', new FacebookProvider()],
  ['instagram', new InstagramProvider()],
  ['threads', new ThreadsProvider()],
  ['tiktok', new TikTokProvider()],
  ['youtube', new YouTubeProvider()]
]);

export function getSocialProvider(platform: string): SocialProvider {
  const provider = providers.get(platform as SocialPlatform);
  if (!provider) {
    const error = new Error(`Moyi does not have a native ${platform} publishing adapter.`) as Error & { code?: string; statusCode?: number };
    error.code = 'provider_not_supported';
    error.statusCode = 422;
    throw error;
  }
  return provider;
}

export function nativeSocialPlatforms(): SocialPlatform[] {
  return [...providers.keys()];
}
