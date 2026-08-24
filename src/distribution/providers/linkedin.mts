import fs from 'node:fs/promises';
import axios from 'axios';
import { distributionConfig } from '../config.mjs';
import { providerError, requireValue } from '../provider-error.mjs';
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

const LINKEDIN_DEFAULT_SCOPES = [
  'openid',
  'profile',
  'email',
  'w_member_social'
];

function linkedinScopes(): string[] {
  return String(distributionConfig.linkedinScopes || LINKEDIN_DEFAULT_SCOPES.join(' '))
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function canDiscoverOrganizations(scopes: string[]): boolean {
  return scopes.includes('rw_organization_admin') || scopes.includes('r_organization_admin');
}

function apiHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Linkedin-Version': distributionConfig.linkedinApiVersion,
    'X-Restli-Protocol-Version': '2.0.0'
  };
}

function personUrn(value: string): string {
  return value.startsWith('urn:li:') ? value : `urn:li:person:${value}`;
}

function organizationId(urn: string): string {
  return urn.split(':').pop() || '';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForLinkedInMedia(
  accessToken: string,
  mediaType: 'images' | 'videos',
  mediaUrn: string
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await axios.get(
      `https://api.linkedin.com/rest/${mediaType}/${encodeURIComponent(mediaUrn)}`,
      { headers: apiHeaders(accessToken), timeout: 12000 }
    );
    const status = String(response.data?.status || '').toUpperCase();
    if (status === 'AVAILABLE' || !status) return;
    if (['PROCESSING_FAILED', 'UPLOAD_FAILED', 'ERROR'].includes(status)) {
      const error = new Error(`LinkedIn ${mediaType === 'images' ? 'image' : 'video'} processing failed.`) as Error & { code?: string };
      error.code = 'linkedin_media_processing_failed';
      throw error;
    }
    await delay(3000);
  }
  const error = new Error(`LinkedIn is still processing the ${mediaType === 'images' ? 'image' : 'video'}. Retry the publish job shortly.`) as Error & { code?: string; retryable?: boolean };
  error.code = 'linkedin_media_processing_timeout';
  error.retryable = true;
  throw error;
}

async function organizationName(accessToken: string, urn: string): Promise<string> {
  try {
    const response = await axios.get(`https://api.linkedin.com/rest/organizations/${encodeURIComponent(organizationId(urn))}`, {
      headers: apiHeaders(accessToken), timeout: 10000
    });
    const localized = response.data?.localizedName || response.data?.vanityName;
    return String(localized || `LinkedIn organization ${organizationId(urn)}`);
  } catch {
    return `LinkedIn organization ${organizationId(urn)}`;
  }
}

async function organizationAccounts(accessToken: string, memberUrn: string): Promise<ConnectedAccount[]> {
  const requestedScopes = linkedinScopes();
  if (!canDiscoverOrganizations(requestedScopes)) return [];
  try {
    const response = await axios.get('https://api.linkedin.com/rest/organizationAcls', {
      params: { q: 'roleAssignee', state: 'APPROVED', count: 100 },
      headers: apiHeaders(accessToken),
      timeout: 12000
    });
    const elements = Array.isArray(response.data?.elements) ? response.data.elements : [];
    const allowedRoles = new Set(['ADMINISTRATOR', 'CONTENT_ADMIN', 'CONTENT_ADMINISTRATOR', 'DIRECT_SPONSORED_CONTENT_POSTER']);
    const urns = [...new Set(elements
      .filter((entry: Record<string, unknown>) => allowedRoles.has(String(entry.role || '')) && String(entry.state || '') === 'APPROVED')
      .map((entry: Record<string, unknown>) => String(entry.organization || entry.organizationTarget || ''))
      .filter((urn: string) => urn.startsWith('urn:li:organization')))] as string[];

    return Promise.all(urns.map(async (urn) => ({
      platform: 'linkedin' as const,
      accountName: await organizationName(accessToken, urn),
      externalAccountId: urn,
      accessToken,
      refreshToken: '',
      expiresInSeconds: null,
      scopes: requestedScopes,
      metadata: { accountType: 'organization', memberUrn, organizationUrn: urn }
    })));
  } catch {
    return [];
  }
}

function payloadMedia(payload: PublishPayload): PublishMedia[] {
  if (payload.mediaItems?.length) return payload.mediaItems;
  return payload.media ? [payload.media] : [];
}

async function mediaBuffer(media: PublishMedia): Promise<Buffer> {
  if (media.buffer) return media.buffer;
  if (media.localPath) return fs.readFile(media.localPath);
  throw new Error('The processed LinkedIn media file could not be opened.');
}

async function uploadLinkedInImage(accessToken: string, author: string, media: PublishMedia): Promise<string> {
  const initialized = await axios.post(
    'https://api.linkedin.com/rest/images?action=initializeUpload',
    { initializeUploadRequest: { owner: author } },
    { headers: apiHeaders(accessToken), timeout: 12000 }
  );
  const uploadUrl = String(initialized.data?.value?.uploadUrl || '');
  const imageUrn = String(initialized.data?.value?.image || '');
  if (!uploadUrl || !imageUrn) throw new Error('LinkedIn did not return an image upload target.');
  const buffer = await mediaBuffer(media);
  await axios.put(uploadUrl, buffer, {
    headers: { 'Content-Type': media.mimeType, 'Content-Length': String(buffer.byteLength) },
    timeout: 60000,
    maxBodyLength: 25 * 1024 * 1024
  });
  await waitForLinkedInMedia(accessToken, 'images', imageUrn);
  return imageUrn;
}

async function mediaRange(media: PublishMedia, firstByte: number, lastByte: number, handle: fs.FileHandle | null): Promise<Buffer> {
  const length = lastByte - firstByte + 1;
  if (handle) {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, firstByte);
    if (bytesRead !== length) throw new Error('The LinkedIn video ended before the expected file size.');
    return buffer;
  }
  if (media.buffer) return media.buffer.subarray(firstByte, lastByte + 1);
  throw new Error('The processed LinkedIn video file could not be opened.');
}

async function uploadLinkedInVideo(accessToken: string, author: string, media: PublishMedia): Promise<string> {
  const initialized = await axios.post(
    'https://api.linkedin.com/rest/videos?action=initializeUpload',
    {
      initializeUploadRequest: {
        owner: author,
        fileSizeBytes: media.size,
        uploadCaptions: false,
        uploadThumbnail: false
      }
    },
    { headers: apiHeaders(accessToken), timeout: 15000 }
  );
  const value = initialized.data?.value || {};
  const videoUrn = String(value.video || '');
  const uploadToken = String(value.uploadToken || '');
  const instructions = Array.isArray(value.uploadInstructions) ? value.uploadInstructions : [];
  if (!videoUrn || !instructions.length) throw new Error('LinkedIn did not return video upload instructions.');
  const handle = media.localPath ? await fs.open(media.localPath, 'r') : null;
  const uploadedPartIds: string[] = [];
  try {
    for (const instruction of instructions) {
      const firstByte = Number(instruction.firstByte);
      const lastByte = Number(instruction.lastByte);
      const uploadUrl = String(instruction.uploadUrl || '');
      const chunk = await mediaRange(media, firstByte, lastByte, handle);
      const uploaded = await axios.put(uploadUrl, chunk, {
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(chunk.byteLength) },
        timeout: 120000,
        maxBodyLength: Infinity
      });
      const partId = String(uploaded.headers.etag || '').replace(/^"|"$/g, '');
      if (!partId) throw new Error('LinkedIn uploaded a video part without returning its ETag.');
      uploadedPartIds.push(partId);
    }
  } finally {
    await handle?.close();
  }
  await axios.post(
    'https://api.linkedin.com/rest/videos?action=finalizeUpload',
    { finalizeUploadRequest: { video: videoUrn, uploadToken, uploadedPartIds } },
    { headers: apiHeaders(accessToken), timeout: 15000 }
  );
  await waitForLinkedInMedia(accessToken, 'videos', videoUrn);
  return videoUrn;
}

async function createLinkedInFirstComment(
  accessToken: string,
  author: string,
  postId: string,
  text: string
): Promise<string> {
  const response = await axios.post(
    `https://api.linkedin.com/rest/socialActions/${encodeURIComponent(postId)}/comments`,
    { actor: author, object: postId, message: { text } },
    { headers: apiHeaders(accessToken), timeout: 12000 }
  );
  return String(response.headers['x-restli-id'] || response.data?.id || response.data?.commentUrn || '');
}

export class LinkedInProvider implements SocialProvider {
  readonly platform = 'linkedin' as const;

  async getAuthorizationRequest(input: { state: string }): Promise<AuthorizationRequest> {
    const clientId = requireValue(distributionConfig.linkedinClientId, 'LinkedIn OAuth is not configured. Add LINKEDIN_CLIENT_ID.');
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: distributionConfig.linkedinRedirectUri,
      state: input.state,
      scope: linkedinScopes().join(' ')
    });
    return { url: `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}` };
  }

  async connect(code: string, _context: ConnectContext = {}): Promise<ConnectedAccount[]> {
    requireValue(distributionConfig.linkedinClientId, 'LinkedIn OAuth is not configured. Add LINKEDIN_CLIENT_ID.');
    requireValue(distributionConfig.linkedinClientSecret, 'LinkedIn OAuth is not configured. Add LINKEDIN_CLIENT_SECRET.');
    try {
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: distributionConfig.linkedinRedirectUri,
        client_id: distributionConfig.linkedinClientId,
        client_secret: distributionConfig.linkedinClientSecret
      });
      const response = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 12000
      });
      const accessToken = String(response.data.access_token || '');
      const profile = await axios.get('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }, timeout: 10000
      });
      const memberUrn = personUrn(String(profile.data?.sub || ''));
      const expiresInSeconds = Number(response.data.expires_in || 5184000);
      const grantedScopes = String(response.data.scope || linkedinScopes().join(' ')).split(/\s+/).filter(Boolean);
      const member: ConnectedAccount = {
        platform: 'linkedin',
        accountName: String(profile.data?.name || profile.data?.given_name || 'LinkedIn member'),
        externalAccountId: memberUrn,
        accessToken,
        refreshToken: String(response.data.refresh_token || ''),
        expiresInSeconds,
        scopes: grantedScopes,
        metadata: { accountType: 'person', memberUrn }
      };
      const organizations = await organizationAccounts(accessToken, memberUrn);
      organizations.forEach((account) => {
        account.refreshToken = member.refreshToken;
        account.expiresInSeconds = expiresInSeconds;
        account.scopes = grantedScopes;
      });
      return [member, ...organizations];
    } catch (error) {
      throw providerError('LinkedIn', error);
    }
  }

  async refreshToken(account: SocialAccountCredentials): Promise<Tokens> {
    if (!account.refreshToken) {
      const error = new Error('LinkedIn programmatic refresh is not enabled for this app. Reconnect the account before its token expires.') as Error & { code?: string };
      error.code = 'reauthorization_required';
      throw error;
    }
    try {
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: account.refreshToken,
        client_id: distributionConfig.linkedinClientId,
        client_secret: distributionConfig.linkedinClientSecret
      });
      const response = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 12000
      });
      return {
        accessToken: String(response.data.access_token || ''),
        refreshToken: String(response.data.refresh_token || account.refreshToken),
        expiresInSeconds: Number(response.data.expires_in || 5184000),
        scopes: String(response.data.scope || account.scopes.join(' ')).split(/\s+/).filter(Boolean)
      };
    } catch (error) {
      throw providerError('LinkedIn', error);
    }
  }

  async publish(account: SocialAccountCredentials, payload: PublishPayload): Promise<PublishResult> {
    if (Array.from(payload.text).length > 3000) {
      const error = new Error('LinkedIn posts can contain at most 3,000 characters.') as Error & { code?: string };
      error.code = 'content_too_long';
      throw error;
    }
    const media = payloadMedia(payload);
    const images = media.filter((item) => item.kind === 'image');
    const videos = media.filter((item) => item.kind === 'video');
    if (videos.length > 1 || (videos.length && media.length > 1)) {
      const error = new Error('LinkedIn video posts accept one video without additional images.') as Error & { code?: string };
      error.code = 'mixed_media_not_supported';
      throw error;
    }
    if (images.length > 20) {
      const error = new Error('LinkedIn multi-image posts accept at most 20 images.') as Error & { code?: string };
      error.code = 'too_many_media_items';
      throw error;
    }
    if (account.accessToken.startsWith('sandbox_') || account.metadata.sandbox === true) {
      const id = `urn:li:share:${Date.now()}`;
      return {
        platformPostId: id,
        platformUrl: `https://www.linkedin.com/feed/update/${id}/`,
        firstCommentId: payload.firstComment ? `comment_${Date.now()}` : ''
      };
    }

    try {
      const author = account.externalAccountId;
      const body: Record<string, unknown> = {
        author,
        commentary: payload.text,
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: []
        },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false
      };

      if (videos.length) {
        const videoUrn = await uploadLinkedInVideo(account.accessToken, author, videos[0]);
        body.content = {
          media: {
            id: videoUrn,
            ...(videos[0].altText ? { altText: videos[0].altText.slice(0, 4086) } : {}),
            ...(payload.title ? { title: payload.title.slice(0, 400) } : {})
          }
        };
      } else if (images.length === 1) {
        const imageUrn = await uploadLinkedInImage(account.accessToken, author, images[0]);
        body.content = {
          media: {
            id: imageUrn,
            ...(images[0].altText ? { altText: images[0].altText.slice(0, 4086) } : {}),
            ...(payload.title ? { title: payload.title.slice(0, 400) } : {})
          }
        };
      } else if (images.length > 1) {
        const imageUrns: string[] = [];
        for (const image of images) imageUrns.push(await uploadLinkedInImage(account.accessToken, author, image));
        body.content = {
          multiImage: {
            images: imageUrns.map((id, index) => ({ id, altText: images[index].altText || '' }))
          }
        };
      }

      const response = await axios.post('https://api.linkedin.com/rest/posts', body, {
        headers: apiHeaders(account.accessToken), timeout: 12000
      });
      const postId = String(response.headers['x-restli-id'] || response.data?.id || '');
      if (!postId) throw new Error('LinkedIn accepted the post but did not return its ID.');
      let firstCommentId = '';
      let warning = '';
      if (payload.firstComment) {
        try {
          firstCommentId = await createLinkedInFirstComment(
            account.accessToken,
            author,
            postId,
            payload.firstComment
          );
        } catch (error) {
          warning = providerError('LinkedIn first comment', error).message;
        }
      }
      return {
        platformPostId: postId,
        platformUrl: `https://www.linkedin.com/feed/update/${postId}/`,
        firstCommentId,
        warning
      };
    } catch (error) {
      throw providerError('LinkedIn', error);
    }
  }

  async getMetrics(account: SocialAccountCredentials, post: PublishedPostReference): Promise<EngagementMetricsResult> {
    if (account.accessToken.startsWith('sandbox_') || account.metadata.sandbox === true) {
      return engagementMetricsResult(sandboxMetrics(account.metadata), { source: 'sandbox' });
    }
    try {
      const socialResponse = await axios.get(
        `https://api.linkedin.com/rest/socialMetadata/${encodeURIComponent(post.platformPostId)}`,
        { headers: apiHeaders(account.accessToken), timeout: 12000 }
      );
      const reactions = socialResponse.data?.reactionSummaries || {};
      const likes = Object.values(reactions).reduce((total: number, item: unknown) => {
        const count = item && typeof item === 'object' ? Number((item as Record<string, unknown>).count || 0) : 0;
        return total + (Number.isFinite(count) ? count : 0);
      }, 0);
      let organizationStatistics: Record<string, unknown> = {};
      const organizationUrn = String(account.metadata.organizationUrn || '');
      if (organizationUrn) {
        try {
          const response = await axios.get('https://api.linkedin.com/rest/organizationalEntityShareStatistics', {
            params: {
              q: 'organizationalEntity',
              organizationalEntity: organizationUrn,
              shares: `List(${post.platformPostId})`
            },
            headers: apiHeaders(account.accessToken),
            timeout: 12000
          });
          const row = Array.isArray(response.data?.elements) ? response.data.elements[0] : null;
          organizationStatistics = row?.totalShareStatistics || {};
        } catch {
          organizationStatistics = {};
        }
      }
      const numeric = (value: unknown): number | null => {
        if (value === undefined || value === null || value === '') return null;
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? number : null;
      };
      return engagementMetricsResult({
        impressions: numeric(organizationStatistics.impressionCount),
        reach: numeric(organizationStatistics.uniqueImpressionsCount),
        likes: numeric(organizationStatistics.likeCount) ?? likes,
        reactions: numeric(organizationStatistics.likeCount) ?? likes,
        comments: numeric(organizationStatistics.commentCount) ?? numeric(socialResponse.data?.commentSummary?.count),
        shares: numeric(organizationStatistics.shareCount),
        clicks: numeric(organizationStatistics.clickCount)
      }, { organizationAnalyticsAvailable: Object.keys(organizationStatistics).length > 0 });
    } catch (error) {
      throw providerError('LinkedIn metrics', error);
    }
  }
}

export { LINKEDIN_DEFAULT_SCOPES, linkedinScopes };
