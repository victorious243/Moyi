const crypto = require('crypto');
const axios = require('axios');
const SocialDraft = require('../models/SocialDraft');
const SocialAccount = require('../models/SocialAccount');
const PublishAction = require('../models/PublishAction');
const ContentImage = require('../models/ContentImage');
const { getDecryptedSocialAccountCredentials } = require('./socialAccountService');
const appLogger = require('./appLogger');
const { publishFacebookPagePost, publishInstagramBusinessPost } = require('./metaMcpService');

function absoluteAppUrl(pathOrUrl) {
  if (!pathOrUrl) return '';
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const baseUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const path = String(pathOrUrl).startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${baseUrl}${path}`;
}

function socialPostText(payload) {
  return `${payload.title ? `${payload.title}\n\n` : ''}${payload.body || ''}`.trim();
}

async function dispatchMeta({ credentials, payload, draft }) {
  if (draft && draft.channel === 'instagram') {
    const imageUrl = payload.imageUrl ? absoluteAppUrl(payload.imageUrl) : '';
    if (!imageUrl) {
      throw new Error('Instagram publishing requires an image on the social draft.');
    }
    return publishInstagramBusinessPost({
      accessToken: credentials.accessToken,
      instagramAccountId: credentials.externalAccountId,
      imageUrl,
      caption: socialPostText(payload)
    });
  } else {
    return publishFacebookPagePost({
      accessToken: credentials.accessToken,
      pageId: credentials.externalAccountId,
      message: socialPostText(payload),
      imageUrl: payload.imageUrl ? absoluteAppUrl(payload.imageUrl) : ''
    });
  }
}

/**
 * Ensures human approval gate before executing any social post dispatch.
 */
function assertHumanApproved(draft) {
  const isApproved = draft.status === 'approved' ||
    draft.status === 'published_manually' ||
    draft.publishStatus === 'approved';

  if (!isApproved) {
    const error = new Error('Human approval gate: This social draft must be reviewed and approved by a human before publishing.');
    error.statusCode = 422;
    throw error;
  }
}

/**
 * Formulates the multi-platform post payload from a SocialDraft.
 */
async function buildPostPayload({ draft, project }) {
  let imageUrl = '';
  let imageAlt = '';

  if (draft.contentImageId) {
    const image = await ContentImage.findById(draft.contentImageId);
    if (image && image.status !== 'rejected') {
      imageUrl = `/social-drafts/${draft._id}/images/${image._id}/file`;
      imageAlt = image.altText || image.caption || draft.title || '';
    }
  }

  return {
    draftId: String(draft._id),
    projectId: String(draft.projectId),
    campaignId: String(draft.campaignId || ''),
    channel: draft.channel,
    title: draft.title || '',
    body: draft.body || '',
    scheduledFor: draft.scheduledFor,
    imageUrl,
    imageAlt,
    brandName: project ? project.name : '',
    websiteUrl: project ? project.websiteUrl : ''
  };
}

/**
 * Dispatches post to outgoing webhook (Make, Zapier, n8n, custom server).
 */
async function dispatchWebhook({ credentials, payload }) {
  if (!credentials.webhookUrl) {
    throw new Error('Webhook URL is not configured on the connected SocialAccount.');
  }

  const timestamp = String(Date.now());
  const bodyString = JSON.stringify(payload);
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Moyi-AI-CMO-Publisher/2.0',
    'X-Moyi-Timestamp': timestamp
  };

  if (credentials.webhookSecret) {
    const signature = crypto
      .createHmac('sha256', credentials.webhookSecret)
      .update(`${timestamp}.${bodyString}`)
      .digest('hex');
    headers['X-Moyi-Signature'] = signature;
  }

  const response = await axios.post(credentials.webhookUrl, bodyString, {
    headers,
    timeout: 10000
  });

  return {
    externalId: response.data && (response.data.id || response.data.postId || response.data.eventId)
      ? String(response.data.id || response.data.postId || response.data.eventId)
      : `webhook-${Date.now()}`
  };
}

/**
 * Dispatches post to Ayrshare or Buffer API aggregator if configured.
 */
async function dispatchAggregator({ credentials, payload }) {
  if (!credentials.accessToken) {
    throw new Error(`API access token is missing for ${credentials.platform}.`);
  }

  // Example dispatch structure for social API aggregator
  const response = await axios.post(
    'https://api.ayrshare.com/api/post',
    {
      post: `${payload.title ? `${payload.title}\n\n` : ''}${payload.body}`,
      platforms: [payload.channel],
      mediaUrls: payload.imageUrl ? [absoluteAppUrl(payload.imageUrl)] : []
    },
    {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 12000
    }
  );

  return {
    externalId: response.data && response.data.id ? String(response.data.id) : `aggregator-${Date.now()}`
  };
}

/**
 * Dispatches direct post to LinkedIn API.
 */
async function dispatchLinkedIn({ credentials, payload }) {
  if (!credentials.accessToken) {
    throw new Error('LinkedIn access token is missing on the connected SocialAccount.');
  }

  if (credentials.accessToken.startsWith('sandbox_')) {
    return { externalId: `linkedin_sandbox_${Date.now()}` };
  }

  const authorUrn = credentials.externalAccountId || 'urn:li:person:me';
  const response = await axios.post(
    'https://api.linkedin.com/v2/ugcPosts',
    {
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: {
            text: `${payload.title ? `${payload.title}\n\n` : ''}${payload.body}`
          },
          shareMediaCategory: 'NONE'
        }
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
      }
    },
    {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0'
      },
      timeout: 10000
    }
  );

  return {
    externalId: response.data && response.data.id ? String(response.data.id) : `linkedin-${Date.now()}`
  };
}

/**
 * Dispatches direct post to X API.
 */
async function dispatchTwitter({ credentials, payload }) {
  if (!credentials.accessToken) {
    throw new Error('X access token is missing on the connected SocialAccount.');
  }

  if (credentials.accessToken.startsWith('sandbox_')) {
    return { externalId: `x_sandbox_${Date.now()}` };
  }

  const response = await axios.post(
    'https://api.twitter.com/2/tweets',
    { text: socialPostText(payload) },
    {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    }
  );

  return {
    externalId: response.data && response.data.data && response.data.data.id
      ? String(response.data.data.id)
      : `x-${Date.now()}`
  };
}

/**
 * Primary multi-platform publishing engine method.
 */
async function publishSocialDraft({ socialDraftId, userId, socialAccountId = null, project = null }) {
  const draft = await SocialDraft.findById(socialDraftId);
  if (!draft) {
    const error = new Error('Social draft not found.');
    error.statusCode = 404;
    throw error;
  }

  // 1. Mandatory Human Approval Gate
  assertHumanApproved(draft);

  // 2. Find target SocialAccount
  let targetAccountId = socialAccountId || draft.socialAccountId;
  let account = null;

  const targetPlatformsByChannel = {
    linkedin: ['linkedin'],
    x: ['x'],
    facebook: ['facebook'],
    instagram: ['instagram', 'facebook'],
    webhook: ['webhook'],
    youtube: ['youtube'],
    tiktok: ['tiktok'],
    email: ['webhook']
  };

  if (targetAccountId) {
    account = await SocialAccount.findOne({ _id: targetAccountId, projectId: draft.projectId });
  } else {
    // Look up connected account for draft channel
    account = await SocialAccount.findOne({
      projectId: draft.projectId,
      platform: { $in: [...(targetPlatformsByChannel[draft.channel] || [draft.channel]), 'ayrshare', 'buffer'] },
      status: 'connected'
    }).sort({ updatedAt: -1 });
  }

  if (!account) {
    const error = new Error(`Connect a ${draft.channel} social account before publishing this post.`);
    error.statusCode = 422;
    throw error;
  }

  // 3. Set draft status to publishing
  draft.publishStatus = 'publishing';
  await draft.save();

  const payload = await buildPostPayload({ draft, project });
  let publishResult = { externalId: '' };
  let integrationType = draft.channel;
  let actionType = 'publish_social_post';

  try {
    if (account) {
      const credentials = await getDecryptedSocialAccountCredentials(account._id);

      if (account.platform === 'webhook' || credentials.webhookUrl) {
        integrationType = 'webhook';
        actionType = 'webhook_dispatch';
        publishResult = await dispatchWebhook({ credentials, payload });
      } else if (account.platform === 'ayrshare' || account.platform === 'buffer') {
        integrationType = account.platform;
        publishResult = await dispatchAggregator({ credentials, payload });
      } else if (account.platform === 'linkedin') {
        integrationType = 'linkedin';
        publishResult = await dispatchLinkedIn({ credentials, payload });
      } else if (account.platform === 'x') {
        integrationType = 'x';
        publishResult = await dispatchTwitter({ credentials, payload });
      } else if (account.platform === 'facebook' || account.platform === 'instagram' || account.platform === 'meta') {
        integrationType = account.platform;
        publishResult = await dispatchMeta({ credentials, payload, draft });
      } else {
        throw new Error(`${account.platform} direct publishing is not implemented yet. Connect LinkedIn, X, Facebook/Instagram, Ayrshare, Buffer, or a webhook.`);
      }
    }

    // Update draft on success
    draft.status = 'published_manually';
    draft.publishStatus = 'published';
    draft.publishedAt = new Date();
    draft.platformPostId = publishResult.externalId || `pub-${Date.now()}`;
    draft.errorMessage = '';
    await draft.save();

    // Log PublishAction
    await PublishAction.create({
      projectId: draft.projectId,
      userId,
      socialDraftId: draft._id,
      socialAccountId: account ? account._id : null,
      integrationType,
      actionType,
      externalId: publishResult.externalId,
      status: 'success'
    });

    appLogger.info(`[MultiPlatformPublish] Published social draft ${draft._id} to ${draft.channel}`, {
      projectId: draft.projectId,
      channel: draft.channel,
      externalId: publishResult.externalId
    });

    return {
      success: true,
      draft,
      externalId: publishResult.externalId
    };
  } catch (error) {
    const errorMsg = error.response && error.response.data && error.response.data.message
      ? error.response.data.message
      : error.message;

    draft.publishStatus = 'failed';
    draft.errorMessage = errorMsg;
    await draft.save();

    await PublishAction.create({
      projectId: draft.projectId,
      userId,
      socialDraftId: draft._id,
      socialAccountId: account ? account._id : null,
      integrationType,
      actionType,
      status: 'failed',
      errorMessage: errorMsg
    });

    appLogger.error(`[MultiPlatformPublish] Failed to publish social draft ${draft._id}`, {
      error: errorMsg,
      projectId: draft.projectId,
      channel: draft.channel
    });

    throw error;
  }
}

/**
 * Batch publishes multiple human-approved social drafts in 1-click.
 */
async function batchPublishSocialDrafts({ projectId, userId, draftIds }) {
  const drafts = await SocialDraft.find({
    _id: { $in: draftIds },
    projectId
  });

  const results = {
    total: drafts.length,
    successCount: 0,
    failedCount: 0,
    errors: []
  };

  for (const draft of drafts) {
    try {
      await publishSocialDraft({
        socialDraftId: draft._id,
        userId,
        project: null
      });
      results.successCount += 1;
    } catch (error) {
      results.failedCount += 1;
      results.errors.push({
        draftId: draft._id,
        title: draft.title,
        channel: draft.channel,
        error: error.message
      });
    }
  }

  return results;
}

/**
 * Publishes all pending or approved social drafts across connected channels in 1-click.
 */
async function publishAllConnectedChannels({ projectId, userId }) {
  const drafts = await SocialDraft.find({
    projectId,
    status: { $in: ['approved', 'published_manually'] },
    publishStatus: { $in: ['approved', 'failed'] }
  });

  if (!drafts.length) {
    return { total: 0, successCount: 0, failedCount: 0, errors: [] };
  }

  return batchPublishSocialDrafts({
    projectId,
    userId,
    draftIds: drafts.map((d) => d._id)
  });
}

module.exports = {
  assertHumanApproved,
  buildPostPayload,
  publishSocialDraft,
  batchPublishSocialDrafts,
  publishAllConnectedChannels
};
