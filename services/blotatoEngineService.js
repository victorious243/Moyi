const SocialDraft = require('../models/SocialDraft');
const Campaign = require('../models/Campaign');
const { createAndQueuePublishBatch } = require('./contentDistributionEngineService');
const { recordAppLog } = require('./appLogger');
const { recordDraftCreation } = require('./calendarCollaborationService');

/**
 * Formats a single master piece of content into platform-native Blotato-style post payloads.
 */
function formatBlotatoMultiPlatformPayloads({ title = '', body = '', url = '', imageUrl = '' }) {
  const cleanTitle = title.trim() || 'New Update';
  const cleanBody = body.trim() || cleanTitle;
  const cleanUrl = url.trim();

  // 1. LinkedIn (B2B storytelling format, line breaks, comment question)
  const linkedinBody = `${cleanTitle}\n\n${cleanBody}${cleanUrl ? `\n\n🔗 Read more: ${cleanUrl}` : ''}\n\nWhat are your thoughts on this approach? Let's discuss in the comments below.\n\n#Growth #Marketing #Innovation`;

  // 2. X / Twitter (High density, under 280 characters)
  let xBody = `${cleanTitle}: ${cleanBody}`;
  if (cleanUrl) xBody += ` ${cleanUrl}`;
  if (xBody.length > 275) {
    xBody = xBody.slice(0, 270) + '... ' + (cleanUrl || '');
  }

  // 3. Facebook (Conversational, emoji bullets)
  const facebookBody = `🚀 ${cleanTitle}\n\n${cleanBody}${cleanUrl ? `\n\n👉 Learn more here: ${cleanUrl}` : ''}`;

  // 4. Instagram (Visual storytelling caption)
  const instagramBody = `✨ ${cleanTitle}\n\n${cleanBody}\n.\n.\n.\n#ContentStrategy #BrandGrowth #MarketingTools`;

  // 5. YouTube Shorts / Video (Catchy video description)
  const youtubeBody = `🎬 ${cleanTitle}\n\n${cleanBody}${cleanUrl ? `\n\nFull Link: ${cleanUrl}` : ''}`;

  return [
    { channel: 'linkedin', title: `${cleanTitle} (LinkedIn)`, body: linkedinBody, imageUrl },
    { channel: 'x', title: `${cleanTitle} (X/Twitter)`, body: xBody, imageUrl },
    { channel: 'facebook', title: `${cleanTitle} (Facebook)`, body: facebookBody, imageUrl },
    { channel: 'instagram', title: `${cleanTitle} (Instagram)`, body: instagramBody, imageUrl },
    { channel: 'youtube', title: `${cleanTitle} (YouTube)`, body: youtubeBody, imageUrl }
  ];
}

/**
 * Creates a compatibility campaign with drafts that still require human approval.
 */
async function createBlotatoCampaign({ projectId, userId, topic = '', url = '', title = '', body = '', imageUrl = '' }) {
  const campaignName = topic || title || `Blotato Campaign ${new Date().toLocaleDateString()}`;
  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

  const campaign = await Campaign.create({
    projectId,
    name: campaignName,
    goal: topic || title || '',
    channel: 'multi',
    cadence: 'custom',
    startDate,
    endDate,
    status: 'planned'
  });

  const payloads = formatBlotatoMultiPlatformPayloads({ title: title || topic, body, url, imageUrl });
  const drafts = [];

  try {
    for (const payload of payloads) {
      const draft = await SocialDraft.create({
        projectId,
        campaignId: campaign._id,
        channel: payload.channel,
        title: payload.title,
        body: payload.body,
        status: 'draft',
        publishStatus: 'pending_approval',
        scheduledFor: startDate
      });
      drafts.push(draft);
    }
    await recordDraftCreation(drafts, { user: { _id: userId }, summary: 'Created the post from a multi-platform campaign.' });
  } catch (error) {
    await Promise.all([
      SocialDraft.deleteMany({ campaignId: campaign._id, projectId }),
      Campaign.deleteOne({ _id: campaign._id, projectId })
    ]).catch(() => null);
    throw error;
  }

  recordAppLog({
    level: 'info',
    message: `[BlotatoEngine] Created multi-platform campaign ${campaign._id} with ${drafts.length} drafts`,
    metadata: { projectId, campaignId: campaign._id }
  }).catch(() => {});

  return {
    campaign,
    drafts
  };
}

/**
 * Queues only human-approved drafts through Moyi's native publishing engine.
 */
async function publishBlotatoCampaign({ projectId, userId, campaignId = null, project = null }) {
  const drafts = await SocialDraft.find({
    projectId,
    ...(campaignId ? { campaignId } : {}),
    status: 'approved',
    publishStatus: { $in: ['approved', 'failed'] }
  }).select('_id');

  if (!drafts.length) {
    return {
      total: 0,
      queuedCount: 0,
      successCount: 0,
      failedCount: 0,
      errors: [],
      requiresApproval: true
    };
  }

  return createAndQueuePublishBatch({
    projectId,
    userId,
    draftIds: drafts.map((draft) => draft._id),
    project,
    scheduledAt: new Date()
  });
}

module.exports = {
  formatBlotatoMultiPlatformPayloads,
  createBlotatoCampaign,
  publishBlotatoCampaign
};
