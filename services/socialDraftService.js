const OpenAI = require('openai');
const env = require('../config/env');
const Campaign = require('../models/Campaign');
const SocialDraft = require('../models/SocialDraft');
const buildSocialDraftsPrompt = require('../src/prompts/social-drafts.prompt');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const CHANNELS = ['linkedin', 'facebook', 'x', 'instagram', 'email'];

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
      body: String(item.body || '').slice(0, 4000)
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
  if (draft.status !== 'approved') {
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
    }
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
    channel: item.channel,
    title: item.title,
    body: item.body,
    scheduledFor: scheduleDate(index)
  })));
}

module.exports = {
  createSocialDraftsFromContent
};
