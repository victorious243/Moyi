const OpenAI = require('openai');
const env = require('../config/env');
const Project = require('../models/Project');
const Scan = require('../models/Scan');
const SeoIssue = require('../models/SeoIssue');
const SearchMetric = require('../models/SearchMetric');
const Competitor = require('../models/Competitor');
const CompetitorInsight = require('../models/CompetitorInsight');
const Recommendation = require('../models/Recommendation');
const ContentDraft = require('../models/ContentDraft');
const { recordAppLog } = require('./appLogger');

let openAiClient = null;
function getClient() {
  if (!openAiClient && env.openaiApiKey) {
    try {
      openAiClient = new OpenAI({ apiKey: env.openaiApiKey });
    } catch (e) {
      openAiClient = null;
    }
  }
  return openAiClient;
}

function daysAgo(days) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

async function assembleProjectTelemetryContext(projectId) {
  const project = await Project.findById(projectId);
  if (!project) throw new Error('Project not found for CMO chat.');

  const last7DaysStart = daysAgo(7);
  const now = new Date();

  const [latestScan, issues, searchMetrics, competitors, insights, recommendations, drafts] = await Promise.all([
    Scan.findOne({ projectId: project._id }).sort({ createdAt: -1 }),
    SeoIssue.find({ project: project._id }).sort({ severity: -1 }).limit(5),
    SearchMetric.find({ projectId: project._id, date: { $gte: last7DaysStart, $lte: now } }).limit(20),
    Competitor.find({ projectId: project._id }).limit(5),
    CompetitorInsight.find({ projectId: project._id }).sort({ createdAt: -1 }).limit(3),
    Recommendation.find({ projectId: project._id, status: { $in: ['open', 'pending'] } }).sort({ impact: -1 }).limit(5),
    ContentDraft.find({ projectId: project._id }).sort({ updatedAt: -1 }).limit(4)
  ]);

  const totalClicks = searchMetrics.reduce((sum, m) => sum + (m.clicks || 0), 0);
  const totalImpressions = searchMetrics.reduce((sum, m) => sum + (m.impressions || 0), 0);
  const topQueries = searchMetrics
    .map((m) => m.query)
    .filter(Boolean)
    .slice(0, 5);

  return {
    project: {
      id: project._id,
      name: project.name,
      websiteUrl: project.websiteUrl,
      industry: project.industry || 'Tech / Digital',
      targetAudience: project.targetAudience || 'Target customers',
      businessModel: project.businessModel || 'Digital product',
      mainGoal: project.mainGoal || 'Drive organic revenue and qualified pipeline',
      mainOffer: project.mainOffer || 'Core solution',
      brandTone: project.brandTone || 'Authoritative and results-oriented'
    },
    telemetry: {
      healthScore: latestScan ? (latestScan.score || latestScan.healthScore || 85) : 'Pending first scan',
      criticalIssues: issues.map((i) => i.title || i.message),
      gsc7DayClicks: totalClicks,
      gsc7DayImpressions: totalImpressions,
      topQueries,
      competitorsMonitored: competitors.map((c) => c.name || c.websiteUrl),
      recentCompetitorGaps: insights.map((i) => i.summary || i.recommendedAction),
      topRecommendations: recommendations.map((r) => `${r.title} (Impact: ${r.impact || 'High'})`),
      pendingDrafts: drafts.map((d) => d.title || 'Untitled Draft')
    }
  };
}

function generateDeterministicCmoReply(message, context) {
  const { project, telemetry } = context;
  const msgLower = (message || '').toLowerCase();

  if (msgLower.includes('traffic') || msgLower.includes('impression') || msgLower.includes('search') || msgLower.includes('click')) {
    return `### 📊 Search & Demand Diagnostics for ${project.name}

Over the past 7 days, your Search Console telemetry shows **${telemetry.gsc7DayClicks.toLocaleString()} total clicks** and **${telemetry.gsc7DayImpressions.toLocaleString()} impressions**.

${telemetry.topQueries.length ? `**Top Queries Driving Demand:**\n${telemetry.topQueries.map((q) => `- \`${q}\``).join('\n')}` : `*GSC query data is currently syncing.*`}

**Strategic Recommendation:**
1. Focus on high-impression queries ranking on positions 5–15.
2. Upgrade page title tags and meta descriptions to lift organic CTR.
3. Review your **[Recommendations](/projects/${project.id}/recommendations)** queue to capture low-hanging search wins.`;
  }

  if (msgLower.includes('competitor') || msgLower.includes('rival') || msgLower.includes('market')) {
    return `### ⚔️ Competitor Intelligence Briefing

We are currently tracking **${telemetry.competitorsMonitored.length} direct & indirect competitors** (${telemetry.competitorsMonitored.join(', ') || 'configured in settings'}).

${telemetry.recentCompetitorGaps.length ? `**Identified Content & Keyword Gaps:**\n${telemetry.recentCompetitorGaps.map((g) => `- ${g}`).join('\n')}` : `*No disruptive competitor moves detected in the last 7 days.*`}

**Action Plan:**
- Launch counter-comparison pages highlighting ${project.name}'s key differentiation (${project.mainOffer}).
- Target competitor keywords with comprehensive comparison guides in **[Content Studio](/projects/${project.id}/content)**.`;
  }

  if (msgLower.includes('content') || msgLower.includes('draft') || msgLower.includes('blog') || msgLower.includes('post') || msgLower.includes('linkedin')) {
    return `### ✍️ Content & Distribution Strategy

Your Content Studio currently has **${telemetry.pendingDrafts.length} drafts** in the pipeline.

**High-Leverage Content Angles for ${project.name}:**
1. **Thought Leadership:** "Why ${project.targetAudience} are shifting away from legacy tools to ${project.name}."
2. **Problem Breakdown:** How to overcome the #1 bottleneck preventing ${project.mainGoal}.
3. **Product Teardown / Comparison:** Direct feature and ROI comparison against ${telemetry.competitorsMonitored[0] || 'market alternatives'}.

Head to **[Content Studio](/projects/${project.id}/content)** to generate, review, and schedule these posts directly to your social and blog channels.`;
  }

  // Default general strategic reply
  return `### 🧭 Strategic Growth Diagnosis for ${project.name}

As your AI CMO, here is the current state of your growth engine based on real workspace telemetry:

* **Website Health:** ${telemetry.healthScore} / 100
* **7-Day Search Volume:** ${telemetry.gsc7DayClicks} clicks | ${telemetry.gsc7DayImpressions} impressions
* **Open Priorities:** ${telemetry.topRecommendations.length} active growth recommendations

**Immediate Action Items:**
${telemetry.topRecommendations.length ? telemetry.topRecommendations.slice(0, 3).map((r, i) => `${i + 1}. ${r}`).join('\n') : '1. Run a new site crawl to refresh technical diagnostics.\n2. Add target competitors in Project Settings.\n3. Create your first batch of SEO articles in Content Studio.'}

Feel free to ask me to draft social hooks, analyze competitor gaps, or prioritize this week's marketing roadmap!`;
}

async function askCmoAssistant({ projectId, message, history = [] }) {
  const context = await assembleProjectTelemetryContext(projectId);
  const client = getClient();

  if (!client) {
    return {
      reply: generateDeterministicCmoReply(message, context),
      timestamp: new Date()
    };
  }

  const systemPrompt = `You are Moyi, an elite, world-class enterprise Chief Marketing Officer (CMO) partnering with the founders and marketing team of "${context.project.name}" (${context.project.websiteUrl}).

BRAND PROFILE:
- Target Audience: ${context.project.targetAudience}
- Business Model: ${context.project.businessModel}
- Core Offer: ${context.project.mainOffer}
- Primary Goal: ${context.project.mainGoal}
- Brand Voice: ${context.project.brandTone}

LIVE WORKSPACE TELEMETRY:
- Technical Health Score: ${context.telemetry.healthScore}
- Critical SEO Issues: ${context.telemetry.criticalIssues.join(', ') || 'None'}
- 7-Day GSC Performance: ${context.telemetry.gsc7DayClicks} clicks, ${context.telemetry.gsc7DayImpressions} impressions
- Top Search Queries: ${context.telemetry.topQueries.join(', ') || 'Syncing'}
- Competitors Tracked: ${context.telemetry.competitorsMonitored.join(', ') || 'None configured'}
- Active Recommendations: ${context.telemetry.topRecommendations.join(', ') || 'Queue clear'}
- Content Pipeline: ${context.telemetry.pendingDrafts.join(', ') || 'Ready for new drafts'}

STYLE & INSTRUCTIONS:
- You speak directly, concisely, and authoritatively as an experienced fractional CMO.
- Ground all your advice directly in the provided telemetry and brand profile.
- When suggesting content, draft actual high-converting hooks, headlines, or outlines.
- Format with clean Markdown headers, bullet points, and bold text for maximum legibility.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-6).map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: message }
  ];

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.6,
      max_tokens: 800
    });

    const reply = completion.choices?.[0]?.message?.content || generateDeterministicCmoReply(message, context);
    return {
      reply,
      timestamp: new Date()
    };
  } catch (err) {
    recordAppLog({
      level: 'warn',
      message: `[CMO Chat] OpenAI error: ${err.message}. Using telemetry fallback.`
    }).catch(() => {});

    return {
      reply: generateDeterministicCmoReply(message, context),
      timestamp: new Date()
    };
  }
}

module.exports = {
  askCmoAssistant,
  assembleProjectTelemetryContext,
  generateDeterministicCmoReply
};
