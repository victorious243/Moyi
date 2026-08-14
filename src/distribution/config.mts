const appUrl = String(process.env.APP_URL || `http://localhost:${process.env.PORT || '3000'}`).replace(/\/$/, '');

export const distributionConfig = {
  appUrl,
  blueskyPrivateJwk: process.env.BLUESKY_PRIVATE_JWK || '',
  blueskyRedirectUri: process.env.BLUESKY_REDIRECT_URI || `${appUrl}/integrations/social/bluesky/callback`,
  linkedinApiVersion: process.env.LINKEDIN_API_VERSION || '202607',
  linkedinClientId: process.env.LINKEDIN_CLIENT_ID || '',
  linkedinClientSecret: process.env.LINKEDIN_CLIENT_SECRET || '',
  linkedinRedirectUri: process.env.LINKEDIN_REDIRECT_URI || `${appUrl}/integrations/social/linkedin/callback`,
  linkedinScopes: process.env.LINKEDIN_SCOPES || 'openid profile email w_member_social',
  twitterClientId: process.env.TWITTER_CLIENT_ID || '',
  twitterClientSecret: process.env.TWITTER_CLIENT_SECRET || '',
  twitterRedirectUri: process.env.TWITTER_REDIRECT_URI || `${appUrl}/integrations/social/x/callback`,
  metaAppId: process.env.META_APP_ID || '',
  metaAppSecret: process.env.META_APP_SECRET || '',
  metaRedirectUri: process.env.META_REDIRECT_URI || `${appUrl}/integrations/social/meta/callback`,
  metaGraphVersion: process.env.META_GRAPH_VERSION || 'v25.0',
  threadsAppId: process.env.THREADS_APP_ID || '',
  threadsAppSecret: process.env.THREADS_APP_SECRET || '',
  threadsRedirectUri: process.env.THREADS_REDIRECT_URI || `${appUrl}/integrations/social/threads/callback`,
  threadsGraphVersion: process.env.THREADS_GRAPH_VERSION || 'v1.0',
  tiktokClientKey: process.env.TIKTOK_CLIENT_KEY || '',
  tiktokClientSecret: process.env.TIKTOK_CLIENT_SECRET || '',
  tiktokRedirectUri: process.env.TIKTOK_REDIRECT_URI || `${appUrl}/integrations/social/tiktok/callback`,
  tiktokAppAudited: /^(1|true|yes|on)$/i.test(process.env.TIKTOK_APP_AUDITED || ''),
  youtubeClientId: process.env.YOUTUBE_CLIENT_ID || '',
  youtubeClientSecret: process.env.YOUTUBE_CLIENT_SECRET || '',
  youtubeRedirectUri: process.env.YOUTUBE_REDIRECT_URI || `${appUrl}/integrations/social/youtube/callback`,
  youtubeApiAudited: /^(1|true|yes|on)$/i.test(process.env.YOUTUBE_API_AUDITED || ''),
  socialEnableMeta: /^(1|true|yes|on)$/i.test(process.env.SOCIAL_ENABLE_META || ''),
  socialEnableThreads: /^(1|true|yes|on)$/i.test(process.env.SOCIAL_ENABLE_THREADS || ''),
  socialEnableTiktok: /^(1|true|yes|on)$/i.test(process.env.SOCIAL_ENABLE_TIKTOK || ''),
  socialEnableYoutube: /^(1|true|yes|on)$/i.test(process.env.SOCIAL_ENABLE_YOUTUBE || '')
};

export function isLocalBlueskyClient(): boolean {
  const hostname = new URL(distributionConfig.appUrl).hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1';
}
