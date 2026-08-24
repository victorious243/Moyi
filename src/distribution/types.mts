export type SocialPlatform =
  | 'bluesky'
  | 'x'
  | 'linkedin'
  | 'facebook'
  | 'instagram'
  | 'threads'
  | 'tiktok'
  | 'youtube';

export type AccountMetadata = Record<string, unknown>;

export interface SocialAccountCredentials {
  id: string;
  projectId: string;
  userId: string;
  platform: SocialPlatform;
  accountName: string;
  externalAccountId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
  scopes: string[];
  metadata: AccountMetadata;
  status: 'connected' | 'disconnected' | 'error' | 'reconnect_required';
}

export interface ConnectedAccount {
  platform: SocialPlatform;
  accountName: string;
  externalAccountId: string;
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number | null;
  expiresAt?: Date | null;
  scopes: string[];
  metadata: AccountMetadata;
}

export interface ConnectContext {
  callbackParams?: URLSearchParams;
  codeVerifier?: string;
  handle?: string;
}

export interface AuthorizationRequest {
  url: string;
  codeVerifier?: string;
}

export interface Tokens {
  accessToken?: string;
  refreshToken?: string;
  expiresInSeconds?: number | null;
  expiresAt?: Date | null;
  scopes?: string[];
  metadata?: AccountMetadata;
}

export interface PublishMedia {
  id: string;
  kind: 'image' | 'video';
  buffer?: Buffer;
  localPath?: string;
  url?: string;
  storageKey?: string;
  mimeType:
    | 'image/jpeg'
    | 'image/png'
    | 'image/webp'
    | 'video/mp4'
    | 'video/quicktime'
    | 'video/webm';
  size: number;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  altText: string;
}

export interface TikTokPublishOptions {
  privacyLevel?: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY';
  allowComment?: boolean;
  allowDuet?: boolean;
  allowStitch?: boolean;
  commercialContent?: boolean;
  brandedContent?: boolean;
  brandOrganicContent?: boolean;
  musicUsageConsent?: boolean;
}

export interface YouTubePublishOptions {
  privacyStatus?: 'public' | 'private' | 'unlisted';
  videoType?: 'short' | 'regular';
  categoryId?: string;
  notifySubscribers?: boolean;
}

export interface PublishPayload {
  text: string;
  title?: string;
  body?: string;
  firstComment?: string;
  media?: PublishMedia | null;
  mediaItems?: PublishMedia[];
  options?: {
    tiktok?: TikTokPublishOptions;
    youtube?: YouTubePublishOptions;
    [key: string]: unknown;
  };
}

export interface PublishResult {
  platformPostId: string;
  platformUrl: string;
  status?: 'published' | 'processing';
  providerState?: Record<string, unknown>;
  firstCommentId?: string;
  warning?: string;
}

export interface PublishStatusResult {
  status: 'processing' | 'published' | 'failed';
  platformPostId?: string;
  platformUrl?: string;
  providerState?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

export type EngagementMetricName =
  | 'impressions'
  | 'reach'
  | 'views'
  | 'likes'
  | 'reactions'
  | 'comments'
  | 'shares'
  | 'reposts'
  | 'quotes'
  | 'saves'
  | 'clicks'
  | 'linkClicks'
  | 'profileClicks'
  | 'videoViews'
  | 'watchTimeMs';

export type EngagementMetricValues = Partial<Record<EngagementMetricName, number | null>>;

export interface PublishedPostReference {
  platformPostId: string;
  platformUrl?: string;
  providerState?: Record<string, unknown>;
  publishedAt?: Date | null;
}

export interface EngagementMetricsResult {
  metrics: EngagementMetricValues;
  availableFields: EngagementMetricName[];
  unavailableFields?: EngagementMetricName[];
  providerData?: Record<string, unknown>;
  capturedAt?: Date;
}

export interface SocialProvider {
  readonly platform: SocialPlatform;
  getAuthorizationRequest(input: { state: string; handle?: string }): Promise<AuthorizationRequest>;
  connect(code: string, context?: ConnectContext): Promise<ConnectedAccount[]>;
  refreshToken(account: SocialAccountCredentials): Promise<Tokens>;
  publish(account: SocialAccountCredentials, payload: PublishPayload): Promise<PublishResult>;
}

export interface SocialProviderWithPublishStatus extends SocialProvider {
  getPublishStatus(account: SocialAccountCredentials, state: Record<string, unknown>): Promise<PublishStatusResult>;
}

export interface SocialProviderWithMetrics extends SocialProvider {
  getMetrics(account: SocialAccountCredentials, post: PublishedPostReference): Promise<EngagementMetricsResult>;
}
