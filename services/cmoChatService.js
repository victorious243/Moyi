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

/**
 * Enterprise PII and sensitive secret sanitizer to prevent credential or private leaks
 */
function sanitizePiiAndSecrets(text) {
  if (!text || typeof text !== 'string') return text || '';
  let sanitized = text;
  // Strip Bearer tokens and JWTs
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/gi, 'Bearer [REDACTED_TOKEN]');
  // Strip API keys (e.g. sk-..., key-...)
  sanitized = sanitized.replace(/(sk-[a-zA-Z0-9]{20,}|key-[a-zA-Z0-9]{20,})/gi, '[REDACTED_KEY]');
  // Strip credit card numbers (13 to 19 digits)
  sanitized = sanitized.replace(/\b(?:\d{4}[ -]?){3}\d{4}\b/g, '[REDACTED_CARD]');
  // Strip social security numbers
  sanitized = sanitized.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED_SSN]');
  // Strip sensitive passwords / secrets in key=value or JSON pairs
  sanitized = sanitized.replace(/(password|secret|apiKey|api_key|token)\s*[:=]\s*["']?[^\s,"']+["']?/gi, '$1=[REDACTED_SECRET]');
  return sanitized;
}

async function assembleProjectTelemetryContext(projectId) {
  const project = await Project.findById(projectId);
  if (!project) throw new Error('Project not found for CMO chat.');

  const last7DaysStart = daysAgo(7);
  const now = new Date();

  const [latestScan, issues, searchMetrics, competitors, insights, recommendations, drafts] = await Promise.all([
    Scan.findOne({ projectId: project._id }).sort({ createdAt: -1 }),
    SeoIssue.find({ project: project._id }).sort({ severity: -1 }).limit(6),
    SearchMetric.find({ projectId: project._id, date: { $gte: last7DaysStart, $lte: now } }).limit(25),
    Competitor.find({ projectId: project._id }).limit(5),
    CompetitorInsight.find({ projectId: project._id }).sort({ createdAt: -1 }).limit(4),
    Recommendation.find({ projectId: project._id, status: { $in: ['open', 'pending'] } }).sort({ impact: -1 }).limit(6),
    ContentDraft.find({ projectId: project._id }).sort({ updatedAt: -1 }).limit(5)
  ]);

  const totalClicks = searchMetrics.reduce((sum, m) => sum + (m.clicks || 0), 0);
  const totalImpressions = searchMetrics.reduce((sum, m) => sum + (m.impressions || 0), 0);
  const topQueries = searchMetrics
    .map((m) => m.query)
    .filter(Boolean)
    .slice(0, 6);

  return {
    project: {
      id: project._id,
      name: sanitizePiiAndSecrets(project.name),
      websiteUrl: sanitizePiiAndSecrets(project.websiteUrl),
      industry: project.industry || 'B2B SaaS / Tech',
      targetAudience: project.targetAudience || 'B2B Decision Makers & Operators',
      businessModel: project.businessModel || 'Subscription SaaS',
      mainGoal: project.mainGoal || 'Drive organic revenue and pipeline growth',
      mainOffer: project.mainOffer || 'Core solution',
      brandTone: project.brandTone || 'Authoritative, clear, and evidence-driven'
    },
    telemetry: {
      healthScore: latestScan ? (latestScan.score || latestScan.healthScore || 88) : 'Pending crawl',
      criticalIssues: issues.map((i) => sanitizePiiAndSecrets(i.title || i.message)),
      gsc7DayClicks: totalClicks,
      gsc7DayImpressions: totalImpressions,
      topQueries: topQueries.map(sanitizePiiAndSecrets),
      competitorsMonitored: competitors.map((c) => sanitizePiiAndSecrets(c.name || c.websiteUrl)),
      recentCompetitorGaps: insights.map((i) => sanitizePiiAndSecrets(i.summary || i.recommendedAction)),
      topRecommendations: recommendations.map((r) => sanitizePiiAndSecrets(`${r.title} (Impact: ${r.impact || 'High'})`)),
      pendingDrafts: drafts.map((d) => sanitizePiiAndSecrets(d.title || 'Untitled Draft'))
    }
  };
}

const MOYI_PLATFORM_KNOWLEDGE = `
MOYI-CMO PLATFORM CAPABILITIES & WORKFLOWS:
1. Website Scans & Diagnostics:
   - Deep crawls of authorized public sites for technical SEO, metadata, H1-H6 hierarchy, schema markup, broken links, crawl depth, and performance.
   - Generates an evidence-backed Health Score (0-100) and pinpoints critical blockers.
2. AI CMO Planning & Recommendations:
   - Converts crawl and Google Search Console evidence into ranked, high-impact growth cards.
   - Actions: Accept (moves to execution pipeline), Reject (archives without deletion), Restore, or Generate Full Pipeline (produces drafts and campaigns).
3. Content Studio:
   - 4-stage governance workflow: Write -> Visual -> Review -> Distribute.
   - High-converting templates: Blog Articles, VS Competitor Comparisons, Alternatives Lists, Product-Led Guides, FAQ Sections, and Metadata/H1 drafts.
4. Image Studio & Visual Review:
   - Upload transparent PNG logos as immutable brand references. Generate content-matched visuals with art direction and alt-text.
5. Campaign Operations & Multi-Channel Publishing:
   - Weekly & monthly campaign planning, batch scheduling, and multi-channel publishing to LinkedIn, Meta (Facebook Pages, Instagram, Threads), X (Twitter), TikTok, YouTube, and Bluesky.
6. Google Search Console Integration:
   - Read-only OAuth connection extracting real search queries, impressions, clicks, CTR, position 5-15 quick wins, and page-two opportunities.
7. Autonomous Weekly Briefings & Growth Alerts:
   - Proactive Monday morning executive growth reports and immediate alerts on ranking shifts or technical site regressions.
8. Data Privacy & Zero-Training Guarantee:
   - Read-only scopes, AES-256 encrypted credential vaults, zero AI model training on customer data, 1-click JSON export (/account/export), and 1-click permanent erasure (/account/delete).
`;

function generateDeterministicCmoReply(message, context) {
  const msgLower = (message || '').toLowerCase();

  if (!context) {
    if (msgLower.includes('how') || msgLower.includes('feature') || msgLower.includes('search console') || msgLower.includes('publish') || msgLower.includes('privacy') || msgLower.includes('gdpr')) {
      return `### 🧭 Moyi-CMO Platform Guide & Capabilities

Here is how Moyi-CMO drives evidence-based growth across your marketing stack:

1. **Website Scans & Health Diagnostics:** Crawls your site to uncover technical blockers, missing metadata, and schema gaps.
2. **AI CMO Recommendations:** Converts raw evidence into prioritized, high-ROI action cards.
3. **Content Studio:** Generates long-form comparison articles, alternatives lists, and social posts with a 4-step *Write → Visual → Review → Distribute* review gate.
4. **Multi-Channel Publishing:** Connects LinkedIn, Meta (FB/Instagram/Threads), X, TikTok, and YouTube for 1-click publishing.
5. **Google Search Console Integration:** Connects read-only search queries to uncover high-impression, low-CTR quick wins.
6. **Strict Data Privacy & GDPR:** 100% tenant isolation, AES-256 encryption, and zero AI training on your private business data.

Open any project workspace or visit **[Documentation](/docs)** for step-by-step tutorials!`;
    }

    return `### 🧭 Strategic Growth Guidance from Moyi AI CMO

I am your fractional Chief Marketing Officer. I specialize in evidence-led SEO growth, conversion optimization, competitor positioning, and multi-channel distribution.

**Top High-Leverage Priorities:**
1. **Target High-Intent Search:** Prioritize bottom-of-funnel comparison and "vs" competitor queries that attract high-intent buyers.
2. **Optimize Title Snippets for CTR:** Lift clicks on existing rankings without waiting for new backlinks.
3. **Human-in-the-Loop Distribution:** Repurpose core wins into authoritative social posts and weekly briefings.

*Tip: Open any project workspace to unlock real-time Search Console telemetry, automated crawl diagnostics, and competitor gap analysis!*`;
  }

  const { project, telemetry } = context;

  if (msgLower.includes('traffic') || msgLower.includes('impression') || msgLower.includes('search') || msgLower.includes('click') || msgLower.includes('gsc') || msgLower.includes('seo')) {
    return `### 📊 Search & Demand Diagnostics for ${project.name}

Over the past 7 days, your Search Console telemetry shows **${telemetry.gsc7DayClicks.toLocaleString()} total clicks** and **${telemetry.gsc7DayImpressions.toLocaleString()} impressions**.

${telemetry.topQueries.length ? `**Top Queries Driving Demand:**\n${telemetry.topQueries.map((q) => `- \`${q}\``).join('\n')}` : `*Google Search Console query data is currently syncing.*`}

**Strategic Action Items:**
1. **Boost CTR Quick Wins:** Target queries currently ranking on positions 5–15 by refining page title tags and meta descriptions.
2. **Expand Underperforming Topics:** Check your **[Recommendations](/projects/${project.id}/recommendations)** queue for high-impact content additions.
3. **Capture Comparison Traffic:** Create dedicated comparison guides in **[Content Studio](/projects/${project.id}/content)**.`;
  }

  if (msgLower.includes('competitor') || msgLower.includes('rival') || msgLower.includes('market') || msgLower.includes('gap')) {
    return `### ⚔️ Competitor Intelligence Briefing

We are currently tracking **${telemetry.competitorsMonitored.length} direct & indirect competitors** (${telemetry.competitorsMonitored.join(', ') || 'configured in settings'}).

${telemetry.recentCompetitorGaps.length ? `**Identified Content & Keyword Gaps:**\n${telemetry.recentCompetitorGaps.map((g) => `- ${g}`).join('\n')}` : `*No disruptive competitor moves detected in the last 7 days.*`}

**Counter-Positioning Strategy:**
- Highlight ${project.name}'s key differentiation: **${project.mainOffer}** designed specifically for **${project.targetAudience}**.
- Launch targeted comparison playbooks in **[Content Studio](/projects/${project.id}/content)** to intercept prospects searching for alternatives.`;
  }

  if (msgLower.includes('content') || msgLower.includes('draft') || msgLower.includes('blog') || msgLower.includes('post') || msgLower.includes('linkedin') || msgLower.includes('hook') || msgLower.includes('social')) {
    return `### ✍️ Content & Distribution Playbook

Your Content Studio currently has **${telemetry.pendingDrafts.length} drafts** in the pipeline.

**High-Converting Content Angles for ${project.name}:**
1. **Pain-Point Breakdown:** "The #1 bottleneck preventing ${project.targetAudience} from achieving ${project.mainGoal}."
2. **Authority Teardown:** "Why legacy approaches fail for modern teams (and how ${project.name} solves it)."
3. **ROI Comparison:** "How ${project.name} delivers ${project.mainOffer} without enterprise overhead."

Head to **[Content Studio](/projects/${project.id}/content)** to generate, review, and schedule these posts directly to your connected social channels!`;
  }

  if (msgLower.includes('issue') || msgLower.includes('health') || msgLower.includes('scan') || msgLower.includes('crawl') || msgLower.includes('error')) {
    return `### 🛠️ Technical SEO & Crawl Diagnostics for ${project.name}

* **Website Health Score:** ${telemetry.healthScore} / 100
* **Critical Issues Identified:** ${telemetry.criticalIssues.length ? telemetry.criticalIssues.join(', ') : 'No critical technical blockers detected.'}

**Immediate Fix Recommendations:**
1. Resolve any missing meta descriptions or broken internal links.
2. Review structured schema markup to improve rich snippet visibility.
3. Open your **[Audit Scans](/projects/${project.id}/scans)** to inspect page-by-page diagnostic reports.`;
  }

  // Default general strategic reply
  return `### 🧭 Strategic Growth Diagnosis for ${project.name}

As your AI CMO, here is the current state of your growth engine based on live workspace telemetry:

* **Website Health Score:** ${telemetry.healthScore} / 100
* **7-Day Search Performance:** ${telemetry.gsc7DayClicks} clicks | ${telemetry.gsc7DayImpressions} impressions
* **Open Strategic Priorities:** ${telemetry.topRecommendations.length} active growth recommendations

**Immediate Action Items:**
${telemetry.topRecommendations.length ? telemetry.topRecommendations.slice(0, 3).map((r, i) => `${i + 1}. ${r}`).join('\n') : '1. Run a new site crawl to refresh technical diagnostics.\n2. Connect Google Search Console in Integrations.\n3. Create your first batch of SEO articles in Content Studio.'}

Feel free to ask me to draft social hooks, analyze competitor gaps, or prioritize this week's marketing roadmap!`;
}

async function askCmoAssistant({ projectId, message, history = [] }) {
  const sanitizedMessage = sanitizePiiAndSecrets(message);
  let context = null;

  if (projectId) {
    try {
      context = await assembleProjectTelemetryContext(projectId);
    } catch (e) {
      context = null;
    }
  }

  const client = getClient();

  if (!context) {
    if (!client) {
      return { reply: generateDeterministicCmoReply(sanitizedMessage, null), timestamp: new Date() };
    }

    try {
      const sanitizedHistory = history.slice(-6).map((h) => ({
        role: h.role,
        content: sanitizePiiAndSecrets(h.content)
      }));

      const systemPrompt = `You are Moyi, an elite world-class enterprise Chief Marketing Officer (CMO).
${MOYI_PLATFORM_KNOWLEDGE}

PRIVACY & SECURITY GUARDRAILS:
- You operate with strict enterprise data privacy: never leak secrets, API keys, or cross-tenant private user information.
- All customer conversations are private and never used for public foundation model training.
- Speak directly, authoritatively, concisely, and actionable as an experienced B2B growth leader.
- Ground advice in real marketing heuristics, ROI, and Moyi-CMO platform capabilities. Format with clean Markdown headers and bullet points.`;

      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          ...sanitizedHistory,
          { role: 'user', content: sanitizedMessage }
        ],
        temperature: 0.6,
        max_tokens: 900
      });

      return {
        reply: completion.choices?.[0]?.message?.content || generateDeterministicCmoReply(sanitizedMessage, null),
        timestamp: new Date()
      };
    } catch (err) {
      return { reply: generateDeterministicCmoReply(sanitizedMessage, null), timestamp: new Date() };
    }
  }

  if (!client) {
    return {
      reply: generateDeterministicCmoReply(sanitizedMessage, context),
      timestamp: new Date()
    };
  }

  const sanitizedHistory = history.slice(-6).map((h) => ({
    role: h.role,
    content: sanitizePiiAndSecrets(h.content)
  }));

  const systemPrompt = `You are Moyi, an elite, world-class enterprise Chief Marketing Officer (CMO) partnering directly with the founders and marketing team of "${context.project.name}" (${context.project.websiteUrl}).

${MOYI_PLATFORM_KNOWLEDGE}

BRAND CALIBRATION:
- Target Audience: ${context.project.targetAudience}
- Business Model: ${context.project.businessModel}
- Core Offer: ${context.project.mainOffer}
- Primary Goal: ${context.project.mainGoal}
- Brand Voice: ${context.project.brandTone}

LIVE WORKSPACE TELEMETRY:
- Technical Health Score: ${context.telemetry.healthScore} / 100
- Critical SEO Issues: ${context.telemetry.criticalIssues.join(', ') || 'None detected'}
- 7-Day GSC Performance: ${context.telemetry.gsc7DayClicks} clicks, ${context.telemetry.gsc7DayImpressions} impressions
- Top Search Queries: ${context.telemetry.topQueries.join(', ') || 'Syncing from Google Search Console'}
- Competitors Tracked: ${context.telemetry.competitorsMonitored.join(', ') || 'None configured'}
- Identified Competitor Gaps: ${context.telemetry.recentCompetitorGaps.join(', ') || 'No gaps detected'}
- Active Recommendations: ${context.telemetry.topRecommendations.join(', ') || 'Queue clear'}
- Content Drafts in Pipeline: ${context.telemetry.pendingDrafts.join(', ') || 'Ready for new drafts'}

PRIVACY & SECURITY GUARDRAILS:
- Strict Data Privacy: All customer data is strictly isolated to this workspace. Never invent, leak, or hallucinate external private information.
- Zero-Training: Assure the user that conversations and prompts are never used to train public foundation models.
- Evidence-First: Ground your strategic insights directly in the live telemetry and brand calibrations above.
- High-Leverage Tone: Speak authoritatively, directly, and concisely. When suggesting copy or hooks, write out real high-converting copy in clean Markdown.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...sanitizedHistory,
    { role: 'user', content: sanitizedMessage }
  ];

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.6,
      max_tokens: 900
    });

    const reply = completion.choices?.[0]?.message?.content || generateDeterministicCmoReply(sanitizedMessage, context);
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
      reply: generateDeterministicCmoReply(sanitizedMessage, context),
      timestamp: new Date()
    };
  }
}

module.exports = {
  askCmoAssistant,
  assembleProjectTelemetryContext,
  generateDeterministicCmoReply,
  sanitizePiiAndSecrets
};
