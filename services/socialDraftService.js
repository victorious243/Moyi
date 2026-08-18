const OpenAI = require('openai');
const env = require('../config/env');
const Campaign = require('../models/Campaign');
const SocialDraft = require('../models/SocialDraft');
const buildSocialDraftsPrompt = require('../src/prompts/social-drafts.prompt');
const buildCampaignPlannerPrompt = require('../src/prompts/campaign-planner.prompt');
const { buildGrowthBrainSocialContext } = require('./socialAnalyticsService');
const { fitStandardXPost } = require('./xTextService');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const CHANNELS = ['bluesky', 'linkedin', 'facebook', 'x', 'instagram', 'threads', 'tiktok', 'youtube', 'email'];
const MULTI_CHANNEL_SEQUENCE = ['linkedin', 'facebook', 'x', 'instagram', 'email', 'threads', 'tiktok', 'youtube', 'bluesky'];
const CADENCE_COUNTS = { single: 1, weekly: 5, monthly: 12 };

function parseJson(content) {
  const trimmed = String(content || '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  const json = start >= 0 && end >= start ? trimmed.slice(start, end + 1) : trimmed;
  return JSON.parse(json);
}

function projectContext(project) {
  return {
    name: project.name,
    websiteUrl: project.websiteUrl,
    industry: project.industry,
    targetAudience: project.targetAudience,
    mainGoal: project.mainGoal,
    mainOffer: project.mainOffer,
    brandTone: project.brandTone
  };
}

function scheduleDate(index) {
  const date = new Date();
  date.setDate(date.getDate() + index + 1);
  date.setHours(9 + (index % 3) * 3, 0, 0, 0);
  return date;
}

function campaignSchedule({ cadence, channel, startDate }) {
  const count = CADENCE_COUNTS[cadence] || CADENCE_COUNTS.single;
  const channelSequence = channel === 'multi' ? MULTI_CHANNEL_SEQUENCE : [channel];
  const start = new Date(startDate);
  start.setHours(9, 0, 0, 0);

  return Array.from({ length: count }, (_, index) => {
    const scheduledFor = new Date(start);
    const dayOffset = cadence === 'monthly'
      ? Math.round(index * 29 / Math.max(count - 1, 1))
      : index;
    scheduledFor.setDate(start.getDate() + dayOffset);
    scheduledFor.setHours(9 + (index % 3) * 3, 0, 0, 0);
    return {
      channel: channelSequence[index % channelSequence.length],
      scheduledFor
    };
  });
}

function campaignFallbackDrafts({ project, campaign, schedule }) {
  const audience = project.targetAudience || 'the people this business serves';
  const offer = project.mainOffer || project.name;
  const goal = campaign.goal;
  const tone = project.brandTone || 'clear and helpful';

  return schedule.map((slot, index) => ({
    channel: slot.channel,
    scheduledFor: slot.scheduledFor,
    title: `${campaign.name}: post ${index + 1}`,
    body: `${campaign.name}\n\n${goal}\n\n${project.name} helps ${audience} through ${offer}. This post is part of a ${tone} campaign built around that real offer.\n\nLearn more: ${project.websiteUrl}`
  }));
}

async function requestCampaignPlan(context) {
  if (!env.openaiApiKey) return null;
  const client = new OpenAI({ apiKey: env.openaiApiKey, timeout: env.contentAiTimeoutMs });
  const response = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.35,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'You are an evidence-bound campaign planner. Use only supplied business facts and never invent claims.'
      },
      { role: 'user', content: buildCampaignPlannerPrompt(context) }
    ]
  });
  return parseJson(response.choices[0].message.content);
}

function sanitizeCampaignDrafts(parsed, fallback, schedule) {
  const received = parsed && Array.isArray(parsed.drafts) ? parsed.drafts : [];
  return schedule.map((slot, index) => {
    const item = received[index] || fallback[index];
    return {
      channel: slot.channel,
      scheduledFor: slot.scheduledFor,
      title: String(item.title || fallback[index].title).slice(0, 180),
      body: slot.channel === 'x'
        ? fitStandardXPost(item.body || fallback[index].body)
        : String(item.body || fallback[index].body).slice(0, 4000)
    };
  });
}

async function createCampaignContentPlan({ project, campaign, cadence }) {
  const schedule = campaignSchedule({
    cadence,
    channel: campaign.channel,
    startDate: campaign.startDate
  });
  const fallback = campaignFallbackDrafts({ project, campaign, schedule });
  const socialPerformance = await buildGrowthBrainSocialContext(project._id).catch(() => ({
    source: 'Moyi Content Distribution Engine engagement snapshots',
    sampleSize: 0,
    strongestObservedPosts: [],
    platforms: []
  }));
  const context = {
    project: projectContext(project),
    campaign: {
      name: campaign.name,
      goal: campaign.goal,
      channel: campaign.channel,
      cadence
    },
    schedule: schedule.map((slot) => ({
      channel: slot.channel,
      scheduledFor: slot.scheduledFor.toISOString()
    })),
    socialPerformance
  };

  let parsed = null;
  try {
    parsed = await requestCampaignPlan(context);
  } catch (error) {
    parsed = null;
  }

  const drafts = sanitizeCampaignDrafts(parsed, fallback, schedule);
  return SocialDraft.insertMany(drafts.map((item) => ({
    projectId: project._id,
    campaignId: campaign._id,
    sourceContentDraftId: null,
    contentImageId: null,
    channel: item.channel,
    title: item.title,
    body: item.body,
    scheduledFor: item.scheduledFor
  })));
}

function fallbackDrafts({ project, draft }) {
  const audience = project.targetAudience || 'your audience';
  const goal = project.mainGoal || 'make a clearer decision';
  const title = draft.title || `${project.name} content update`;

  return [
    {
      channel: 'linkedin',
      title: `LinkedIn: ${title}`,
      body: `New guide from ${project.name}: ${title}\n\nIt is written to help ${audience} ${goal} with practical, honest information.\n\nRead it here: ${draft.targetUrl || project.websiteUrl}`
    },
    {
      channel: 'facebook',
      title: `Facebook: ${title}`,
      body: `${title}\n\nWe put this together for ${audience} who want useful next steps without hype. Take a look and see what applies to your situation.`
    },
    {
      channel: 'x',
      title: `X: ${title}`,
      body: `${title}\n\nA practical resource for ${audience}. No fluff, just useful points to help with ${goal}.\n${draft.targetUrl || project.websiteUrl}`
    },
    {
      channel: 'instagram',
      title: `Instagram: ${title}`,
      body: `${title}\n\nA visual summary for ${audience}, with practical next steps to help with ${goal}.\n\nLearn more through the link in our profile.`
    },
    {
      channel: 'threads',
      title: `Threads: ${title}`,
      body: `${title}\n\nA practical thought for ${audience}: useful progress starts with clear next steps, not hype. What would help you most with ${goal}?`
    },
    {
      channel: 'tiktok',
      title: `TikTok: ${title}`,
      body: `${title}\n\nA concise video explanation for ${audience}, focused on practical next steps for ${goal}.`
    },
    {
      channel: 'youtube',
      title: `YouTube: ${title}`,
      body: `${title}\n\nThis video helps ${audience} understand practical next steps for ${goal}.\n\nMore information: ${draft.targetUrl || project.websiteUrl}`
    },
    {
      channel: 'email',
      title: `Email: ${title}`,
      body: `Subject: ${title}\n\nHi,\n\nWe created a new resource for ${audience}: ${title}.\n\nIt covers practical next steps and honest guidance so readers can ${goal}.\n\nYou can review it here: ${draft.targetUrl || project.websiteUrl}\n\nBest,\n${project.name}`
    }
  ];
}

async function requestAiDrafts(context) {
  if (!env.openaiApiKey) return null;

  const client = new OpenAI({ apiKey: env.openaiApiKey });
  const response = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.35,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'You create ethical campaign draft posts. Never invent claims or engagement.'
      },
      { role: 'user', content: buildSocialDraftsPrompt(context) }
    ]
  });

  return parseJson(response.choices[0].message.content);
}

function sanitizeDrafts(parsed, fallback) {
  const items = parsed && Array.isArray(parsed.drafts) ? parsed.drafts : fallback;
  return items
    .filter((item) => CHANNELS.includes(item.channel))
    .slice(0, 8)
    .map((item) => ({
      channel: item.channel,
      title: String(item.title || `${item.channel} draft`).slice(0, 180),
      body: item.channel === 'x'
        ? fitStandardXPost(item.body)
        : String(item.body || '').slice(0, 4000)
    }))
    .filter((item) => item.body);
}

async function createCampaignFromContent({ project, draft }) {
  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 7);

  return Campaign.create({
    projectId: project._id,
    name: `Weekly plan: ${draft.title || project.name}`,
    goal: `Share approved content ethically with ${project.targetAudience || 'the target audience'}.`,
    channel: 'multi',
    startDate,
    endDate,
    status: 'planned'
  });
}

async function createSocialDraftsFromContent({ project, draft, campaignId = '' }) {
  if (!['approved', 'published_manually'].includes(draft.status)) {
    const error = new Error('Approve this content draft before creating social drafts.');
    error.statusCode = 422;
    throw error;
  }

  const campaign = campaignId
    ? await Campaign.findOne({ _id: campaignId, projectId: project._id })
    : await createCampaignFromContent({ project, draft });

  if (!campaign) {
    const error = new Error('Campaign not found.');
    error.statusCode = 404;
    throw error;
  }

  const fallback = fallbackDrafts({ project, draft });
  const socialPerformance = await buildGrowthBrainSocialContext(project._id).catch(() => ({
    source: 'Moyi Content Distribution Engine engagement snapshots',
    sampleSize: 0,
    strongestObservedPosts: [],
    platforms: []
  }));
  const context = {
    project: projectContext(project),
    campaign: {
      name: campaign.name,
      goal: campaign.goal,
      channel: campaign.channel,
      startDate: campaign.startDate,
      endDate: campaign.endDate
    },
    contentDraft: {
      title: draft.title,
      type: draft.type,
      targetUrl: draft.targetUrl,
      body: draft.body.slice(0, 5000)
    },
    socialPerformance
  };

  let parsed = null;
  try {
    parsed = await requestAiDrafts(context);
  } catch (error) {
    parsed = null;
  }

  const drafts = sanitizeDrafts(parsed, fallback);
  return SocialDraft.insertMany(drafts.map((item, index) => ({
    projectId: project._id,
    campaignId: campaign._id,
    sourceContentDraftId: draft._id,
    contentImageId: draft.selectedImageId || null,
    channel: item.channel,
    title: item.title,
    body: item.body,
    scheduledFor: scheduleDate(index)
  })));
}

module.exports = {
  campaignSchedule,
  createCampaignContentPlan,
  createSocialDraftsFromContent,
  sanitizeCampaignDrafts,
  sanitizeDrafts
};
