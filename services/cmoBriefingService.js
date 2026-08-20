const CmoReport = require('../models/CmoReport');
const Competitor = require('../models/Competitor');
const CompetitorInsight = require('../models/CompetitorInsight');
const ContentDraft = require('../models/ContentDraft');
const GrowthAlert = require('../models/GrowthAlert');
const MarketingGoal = require('../models/MarketingGoal');
const Project = require('../models/Project');
const Recommendation = require('../models/Recommendation');
const Scan = require('../models/Scan');
const SearchMetric = require('../models/SearchMetric');
const SocialDraft = require('../models/SocialDraft');
const User = require('../models/User');
const env = require('../config/env');
const emailService = require('./emailService');
const { buildGoalBriefingSummary, formatGoalValue, metricLabel } = require('./goalIntelligenceService');
const { createAndDispatchNotification } = require('./notificationDeliveryService');
const { getProjectLocalTime, isLocalDeliveryDue } = require('./dailyGrowthScheduler');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function daysAgo(days) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

function formatPercentChange(current, previous) {
  if (!previous) return current > 0 ? '+100%' : '0%';
  const diff = ((current - previous) / previous) * 100;
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${diff.toFixed(1)}%`;
}

async function buildWeeklyBriefingData(projectId) {
  const project = await Project.findById(projectId).populate('owner');
  if (!project) {
    throw new Error('Project not found for briefing assembly.');
  }

  // 1. Search Metrics (Last 7 days vs previous 7 days)
  const last7DaysStart = daysAgo(7);
  const prev7DaysStart = daysAgo(14);
  const now = new Date();

  const [recentMetrics, prevMetrics] = await Promise.all([
    SearchMetric.find({ projectId: project._id, date: { $gte: last7DaysStart, $lte: now } }),
    SearchMetric.find({ projectId: project._id, date: { $gte: prev7DaysStart, $lt: last7DaysStart } })
  ]);

  const recentClicks = recentMetrics.reduce((sum, m) => sum + (m.clicks || 0), 0);
  const recentImpressions = recentMetrics.reduce((sum, m) => sum + (m.impressions || 0), 0);
  const prevClicks = prevMetrics.reduce((sum, m) => sum + (m.clicks || 0), 0);
  const prevImpressions = prevMetrics.reduce((sum, m) => sum + (m.impressions || 0), 0);

  // Top Queries from recent metrics
  const queryMap = new Map();
  recentMetrics.forEach((m) => {
    if (!m.query) return;
    const item = queryMap.get(m.query) || { query: m.query, clicks: 0, impressions: 0, position: 0, count: 0 };
    item.clicks += m.clicks || 0;
    item.impressions += m.impressions || 0;
    item.position += m.position || 0;
    item.count += 1;
    queryMap.set(m.query, item);
  });
  const topQueries = Array.from(queryMap.values())
    .map((q) => ({ ...q, avgPosition: q.count ? (q.position / q.count).toFixed(1) : 0 }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 4);

  // 2. High-Priority Pending Recommendations
  const pendingRecommendations = await Recommendation.find({
    projectId: project._id,
    status: { $in: ['open', 'pending', 'in_progress'] }
  })
    .sort({ impact: -1, createdAt: -1 })
    .limit(3);

  // 3. Competitor Intelligence Updates
  const [competitors, insights] = await Promise.all([
    Competitor.find({ projectId: project._id }).limit(5),
    CompetitorInsight.find({ projectId: project._id }).sort({ createdAt: -1 }).limit(3)
  ]);

  // 4. Content Studio Pipeline
  const pendingDrafts = await ContentDraft.find({
    projectId: project._id,
    status: { $in: ['draft', 'in_review', 'pending_approval'] }
  }).sort({ updatedAt: -1 }).limit(3);

  const upcomingSocialDrafts = await SocialDraft.find({
    projectId: project._id,
    scheduledFor: { $gte: now, $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }
  }).sort({ scheduledFor: 1 }).limit(4);

  // 5. Latest Website Scan Score
  const latestScan = await Scan.findOne({ projectId: project._id }).sort({ createdAt: -1 });
  const goals = await MarketingGoal.find({
    projectId: project._id,
    status: { $ne: 'paused' }
  }).sort({ status: 1, periodEnd: 1 }).lean();
  const goalSummary = buildGoalBriefingSummary(goals);

  return {
    project: {
      _id: project._id,
      name: project.name,
      websiteUrl: project.websiteUrl,
      targetAudience: project.targetAudience || 'Market audience',
      businessModel: project.businessModel || 'Digital business'
    },
    user: project.owner,
    search: {
      clicks: recentClicks,
      clicksDelta: formatPercentChange(recentClicks, prevClicks),
      impressions: recentImpressions,
      impressionsDelta: formatPercentChange(recentImpressions, prevImpressions),
      topQueries
    },
    recommendations: pendingRecommendations.map((r) => ({
      _id: r._id,
      title: r.title,
      category: r.category || 'Growth',
      impact: r.impact || 'High',
      effort: r.effort || 'Medium',
      actionUrl: `${env.appUrl}/projects/${project._id}/recommendations`
    })),
    competitors: {
      totalMonitored: competitors.length,
      recentInsights: insights.map((i) => ({
        competitorName: i.competitorName || 'Competitor',
        summary: i.summary || i.title || 'Competitor indexed new strategic content.',
        recommendation: i.recommendedAction || ''
      }))
    },
    contentPipeline: {
      pendingDraftCount: pendingDrafts.length,
      pendingDrafts: pendingDrafts.map((d) => ({
        _id: d._id,
        title: d.title || 'Untitled Draft',
        targetKeyword: d.targetKeyword || '',
        url: `${env.appUrl}/projects/${project._id}/content`
      })),
      upcomingSocialCount: upcomingSocialDrafts.length
    },
    scanScore: latestScan ? (latestScan.score || latestScan.healthScore || 85) : null,
    goals,
    goalSummary,
    dashboardUrl: `${env.appUrl}/projects/${project._id}`,
    settingsUrl: `${env.appUrl}/projects/${project._id}/settings/notifications`
  };
}

function renderWeeklyBriefingHtml(briefing) {
  const { project, search, recommendations, competitors, contentPipeline, scanScore, dashboardUrl, goals = [], goalSummary = {} } = briefing;

  const goalRowsHtml = goals.length
    ? goals.slice(0, 5).map((goal) => `
      <tr>
        <td style="padding:9px 12px;border-bottom:1px solid #232a30;color:#e1e7ec;font-size:13px;">${escapeHtml(goal.name)}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #232a30;color:#8b949e;font-size:12px;">${escapeHtml(String(goal.status || '').replace(/_/g, ' '))}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #232a30;color:#55e6cf;font-size:12px;text-align:right;">${escapeHtml(formatGoalValue(goal, goal.forecastValue))} / ${escapeHtml(formatGoalValue(goal, goal.targetValue))}</td>
      </tr>`).join('')
    : '<tr><td colspan="3" style="padding:12px;color:#8b949e;text-align:center;font-size:13px;">No project goals are defined yet.</td></tr>';

  const topQueriesHtml = search.topQueries.length
    ? search.topQueries
        .map(
          (q) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #232a30;color:#e1e7ec;font-size:13px;">${escapeHtml(q.query)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #232a30;color:#55e6cf;font-size:13px;font-weight:700;text-align:right;">${q.impressions.toLocaleString()}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #232a30;color:#8a7cff;font-size:13px;text-align:right;">#${q.avgPosition}</td>
      </tr>`
        )
        .join('')
    : `<tr><td colspan="3" style="padding:12px;color:#8b949e;text-align:center;font-size:13px;">GSC search metrics accumulating. Verify Search Console integration in settings.</td></tr>`;

  const recommendationsHtml = recommendations.length
    ? recommendations
        .map(
          (r) => `
      <div style="background:#171c20;border:1px solid #28323a;border-radius:8px;padding:14px 16px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#55e6cf;background:rgba(85,230,207,0.12);padding:2px 8px;border-radius:4px;">${escapeHtml(r.category)}</span>
          <span style="font-size:12px;color:#8b949e;">Impact: <strong style="color:#ffffff;">${escapeHtml(r.impact)}</strong></span>
        </div>
        <div style="font-size:14px;font-weight:700;color:#ffffff;line-height:1.4;">${escapeHtml(r.title)}</div>
      </div>`
        )
        .join('')
    : `<p style="color:#8b949e;font-size:13px;margin:0;">No pending recommendations. Your growth queue is clean.</p>`;

  const competitorHtml = competitors.recentInsights.length
    ? competitors.recentInsights
        .map(
          (c) => `
      <div style="border-left:3px solid #8a7cff;padding-left:12px;margin-bottom:10px;">
        <strong style="color:#ffffff;font-size:13px;">${escapeHtml(c.competitorName)}</strong>
        <p style="margin:2px 0 0;color:#9eaab6;font-size:12px;line-height:1.4;">${escapeHtml(c.summary)}</p>
      </div>`
        )
        .join('')
    : `<p style="color:#8b949e;font-size:13px;margin:0;">Monitoring ${competitors.totalMonitored} competitors. No disruptive moves detected this week.</p>`;

  const contentDraftsHtml = contentPipeline.pendingDrafts.length
    ? contentPipeline.pendingDrafts
        .map(
          (d) => `
      <div style="background:#171c20;border:1px solid #28323a;border-radius:8px;padding:10px 14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <strong style="color:#ffffff;font-size:13px;display:block;">${escapeHtml(d.title)}</strong>
          ${d.targetKeyword ? `<span style="font-size:11px;color:#55e6cf;">Target: ${escapeHtml(d.targetKeyword)}</span>` : ''}
        </div>
      </div>`
        )
        .join('')
    : `<p style="color:#8b949e;font-size:13px;margin:0;">All generated content has been published. Ready to plan the next campaign.</p>`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Weekly CMO Briefing - ${escapeHtml(project.name)}</title>
</head>
<body style="margin:0;padding:0;background-color:#07090a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e1e7ec;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#07090a;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:620px;background:#0d1012;border:1px solid #232a30;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.6);">
          
          <!-- Header Banner -->
          <tr>
            <td style="padding:28px 32px;background:linear-gradient(135deg,#121619 0%,#182026 100%);border-bottom:1px solid #232a30;">
              <table role="presentation" width="100%">
                <tr>
                  <td>
                    <span style="font-size:11px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#55e6cf;">Moyi Executive Briefing</span>
                    <h1 style="margin:6px 0 2px;font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;">${escapeHtml(project.name)} Growth Report</h1>
                    <p style="margin:0;font-size:13px;color:#8b949e;">Performance, accountable goals, risks, and strategic priorities.</p>
                  </td>
                  <td align="right" valign="top">
                    ${scanScore ? `<div style="text-align:center;background:#171c20;border:1px solid rgba(85,230,207,0.3);border-radius:10px;padding:8px 12px;"><span style="font-size:18px;font-weight:900;color:#55e6cf;display:block;">${scanScore}</span><span style="font-size:9px;color:#8b949e;text-transform:uppercase;font-weight:700;">Health</span></div>` : ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content Body -->
          <tr>
            <td style="padding:28px 32px;">

              <h2 style="font-size:14px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:#8b949e;margin:0 0 14px;">Executive outcome review</h2>
              <div style="background:#121619;border:1px solid #232a30;border-radius:10px;padding:16px;margin-bottom:20px;">
                <p style="margin:0 0 7px;color:#e1e7ec;font-size:13px;"><strong>On track:</strong> ${goalSummary.activeCount ? `${goalSummary.onTrackCount} of ${goalSummary.activeCount} active goals` : 'No accountable goals configured'}</p>
                <p style="margin:0 0 7px;color:#e1e7ec;font-size:13px;"><strong>Biggest risk:</strong> ${escapeHtml(goalSummary.biggestRisk ? `${metricLabel(goalSummary.biggestRisk)} is ${String(goalSummary.biggestRisk.status).replace(/_/g, ' ')}` : 'No goal is currently flagged at risk')}</p>
                <p style="margin:0 0 7px;color:#e1e7ec;font-size:13px;"><strong>Biggest opportunity:</strong> ${escapeHtml(goalSummary.biggestOpportunity ? goalSummary.biggestOpportunity.name : (recommendations[0] ? recommendations[0].title : 'Review emerging demand signals'))}</p>
                <p style="margin:0;color:#e1e7ec;font-size:13px;"><strong>Next:</strong> ${escapeHtml(goalSummary.nextAction || (recommendations[0] ? recommendations[0].title : 'Confirm this period\'s primary marketing outcome'))}</p>
              </div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#121619;border:1px solid #232a30;border-radius:10px;overflow:hidden;margin-bottom:28px;">
                <thead><tr style="background:#171c20;"><th style="padding:8px 12px;color:#8b949e;text-align:left;font-size:11px;text-transform:uppercase;">Goal</th><th style="padding:8px 12px;color:#8b949e;text-align:left;font-size:11px;text-transform:uppercase;">Status</th><th style="padding:8px 12px;color:#8b949e;text-align:right;font-size:11px;text-transform:uppercase;">Forecast / target</th></tr></thead>
                <tbody>${goalRowsHtml}</tbody>
              </table>

              <!-- Search Performance Grid -->
              <h2 style="font-size:14px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:#8b949e;margin:0 0 14px;">1. Search Console Traction (7-Day)</h2>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:20px;">
                <tr>
                  <td width="48%" style="background:#171c20;border:1px solid #28323a;border-radius:10px;padding:16px;">
                    <span style="font-size:11px;font-weight:700;color:#8b949e;text-transform:uppercase;display:block;">Total Clicks</span>
                    <div style="font-size:24px;font-weight:900;color:#ffffff;margin:4px 0;">${search.clicks.toLocaleString()}</div>
                    <span style="font-size:11px;font-weight:700;color:${search.clicksDelta.startsWith('+') ? '#12c99b' : '#8b949e'};">${search.clicksDelta} vs last week</span>
                  </td>
                  <td width="4%"></td>
                  <td width="48%" style="background:#171c20;border:1px solid #28323a;border-radius:10px;padding:16px;">
                    <span style="font-size:11px;font-weight:700;color:#8b949e;text-transform:uppercase;display:block;">Search Impressions</span>
                    <div style="font-size:24px;font-weight:900;color:#ffffff;margin:4px 0;">${search.impressions.toLocaleString()}</div>
                    <span style="font-size:11px;font-weight:700;color:${search.impressionsDelta.startsWith('+') ? '#12c99b' : '#8b949e'};">${search.impressionsDelta} vs last week</span>
                  </td>
                </tr>
              </table>

              <!-- Top Queries Table -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#121619;border:1px solid #232a30;border-radius:10px;overflow:hidden;margin-bottom:28px;">
                <thead>
                  <tr style="background:#171c20;border-bottom:1px solid #232a30;">
                    <th style="padding:8px 12px;font-size:11px;font-weight:800;color:#8b949e;text-align:left;text-transform:uppercase;">Top Query</th>
                    <th style="padding:8px 12px;font-size:11px;font-weight:800;color:#8b949e;text-align:right;text-transform:uppercase;">Impr</th>
                    <th style="padding:8px 12px;font-size:11px;font-weight:800;color:#8b949e;text-align:right;text-transform:uppercase;">Rank</th>
                  </tr>
                </thead>
                <tbody>
                  ${topQueriesHtml}
                </tbody>
              </table>

              <!-- High-Priority Recommendations -->
              <h2 style="font-size:14px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:#8b949e;margin:0 0 14px;">2. Top Priority Growth Actions</h2>
              ${recommendationsHtml}

              <!-- Competitor Intelligence Section -->
              <h2 style="font-size:14px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:#8b949e;margin:28px 0 14px;">3. Competitor Intelligence & Market Shifts</h2>
              <div style="background:#121619;border:1px solid #232a30;border-radius:10px;padding:16px;margin-bottom:28px;">
                ${competitorHtml}
              </div>

              <!-- Content Studio Pipeline -->
              <h2 style="font-size:14px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:#8b949e;margin:0 0 14px;">4. Content Studio & Approval Pipeline</h2>
              ${contentDraftsHtml}

              <!-- Action Button CTA -->
              <div style="text-align:center;margin:32px 0 16px;">
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto;">
                  <tr>
                    <td style="border-radius:10px;background:linear-gradient(135deg,#55e6cf,#8a7cff);box-shadow:0 12px 32px rgba(85,230,207,0.3);">
                      <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;padding:15px 32px;color:#04110e;font-size:15px;font-weight:900;text-decoration:none;border-radius:10px;letter-spacing:-0.01em;">Open Project Workspace &rarr;</a>
                    </td>
                  </tr>
                </table>
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px;background:#090b0c;border-top:1px solid #1a1f23;text-align:center;font-size:12px;color:#6b7280;">
              <p style="margin:0 0 8px;">You are receiving this executive briefing because you are the owner or collaborator of <strong>${escapeHtml(project.name)}</strong> on Moyi.</p>
              <p style="margin:0;"><a href="${escapeHtml(briefing.settingsUrl)}" style="color:#55e6cf;text-decoration:none;">Manage briefing notification preferences</a></p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

async function sendWeeklyBriefingEmail({ project, recipientEmail = '', force = false }) {
  const targetProject = typeof project === 'object' && project._id ? project : await Project.findById(project).populate('owner');
  if (!targetProject) throw new Error('Project not found for briefing dispatch.');

  const cmoNotifs = targetProject.cmoNotifications || {};
  const weeklyBriefingConfig = cmoNotifs.weeklyBriefing || {};

  if (!force && weeklyBriefingConfig.enabled === false) {
    return { skipped: true, reason: 'Weekly briefings disabled in project settings.' };
  }

  const briefingData = await buildWeeklyBriefingData(targetProject._id);
  const html = renderWeeklyBriefingHtml(briefingData);
  const subject = `Weekly CMO Growth Briefing: ${targetProject.name}`;
  const text = `Weekly CMO Growth Briefing for ${targetProject.name}\n\nReview goals, performance, risks, and priority actions at ${briefingData.dashboardUrl}`;
  let recipient = recipientEmail;
  if (recipientEmail) {
    await emailService.sendEmail({ to: recipientEmail, subject, html, text });
    await GrowthAlert.create({
      projectId: targetProject._id,
      userId: targetProject.owner ? targetProject.owner._id : null,
      recipientUserIds: targetProject.owner ? [targetProject.owner._id] : [],
      type: 'weekly_briefing',
      category: 'executive_briefing',
      severity: 'info',
      title: 'Weekly CMO Briefing delivered',
      summary: `Dispatched weekly executive briefing with ${briefingData.goalSummary.onTrackCount || 0} goals on track and ${briefingData.recommendations.length} priority actions.`,
      evidenceData: { clicks: briefingData.search.clicks, impressions: briefingData.search.impressions, recommendationCount: briefingData.recommendations.length, goalCount: briefingData.goals.length },
      ctaUrl: briefingData.dashboardUrl,
      ctaLabel: 'View Workspace',
      recipientEmail,
      channels: ['in_app', 'email'],
      deliveryStatus: 'sent',
      sentAt: new Date()
    });
  } else {
    const dispatch = await createAndDispatchNotification({
      project: targetProject,
      force: true,
      type: 'weekly_briefing',
      category: 'executive_briefing',
      severity: 'info',
      urgency: 'normal',
      confidence: 90,
      title: 'Weekly CMO Briefing ready',
      summary: `${briefingData.goalSummary.onTrackCount || 0} goals are on track, ${briefingData.goalSummary.atRiskCount || 0} need attention, and ${briefingData.recommendations.length} priority actions are ready.`,
      businessImpact: 'This briefing aligns marketing activity with accountable project outcomes.',
      recommendedAction: briefingData.goalSummary.nextAction || (briefingData.recommendations[0] && briefingData.recommendations[0].title) || 'Confirm the next marketing priority.',
      evidenceData: { clicks: briefingData.search.clicks, impressions: briefingData.search.impressions, recommendationCount: briefingData.recommendations.length, goalCount: briefingData.goals.length },
      ctaUrl: briefingData.dashboardUrl,
      ctaLabel: 'Open Weekly Brief',
      customEmail: { subject, html, text },
      dedupeKey: `weekly-brief:${targetProject._id}:${getProjectLocalTime(targetProject.timezone || 'UTC').dateString}`
    });
    recipient = `${dispatch.sent || 0} deliveries`;
  }

  // Update lastSentAt on project
  targetProject.cmoNotifications = targetProject.cmoNotifications || {};
  targetProject.cmoNotifications.weeklyBriefing = targetProject.cmoNotifications.weeklyBriefing || {};
  targetProject.cmoNotifications.weeklyBriefing.lastSentAt = new Date();
  await targetProject.save();

  return { success: true, recipient, project: targetProject.name };
}

async function sendMonthlyStrategyReview({ project, force = false }) {
  const targetProject = typeof project === 'object' && project._id ? project : await Project.findById(project).populate('owner');
  if (!targetProject) throw new Error('Project not found for monthly strategy review.');
  const config = targetProject.cmoNotifications && targetProject.cmoNotifications.monthlyStrategyReview || {};
  if (!force && config.enabled === false) return { skipped: true, reason: 'Monthly strategy review disabled.' };
  const briefingData = await buildWeeklyBriefingData(targetProject._id);
  const html = renderWeeklyBriefingHtml(briefingData).replace(/Weekly CMO Briefing/g, 'Monthly Strategy Review');
  const subject = `Monthly Marketing Strategy Review: ${targetProject.name}`;
  const text = `Monthly strategy review for ${targetProject.name}\n\nReview accountable goals, risks, opportunities, and next decisions at ${briefingData.dashboardUrl}`;
  const dispatch = await createAndDispatchNotification({
    project: targetProject,
    force: true,
    type: 'monthly_strategy_review',
    category: 'executive_briefing',
    severity: 'info',
    urgency: 'normal',
    confidence: 90,
    title: 'Monthly Strategy Review ready',
    summary: `${briefingData.goalSummary.onTrackCount || 0} goals are on track and ${briefingData.goalSummary.atRiskCount || 0} require a decision.`,
    businessImpact: 'The review connects marketing execution to this month’s agreed business outcomes.',
    recommendedAction: briefingData.goalSummary.nextAction || 'Confirm next month’s primary outcome and accountable owner.',
    evidenceData: { goalCount: briefingData.goals.length, recommendationCount: briefingData.recommendations.length },
    ctaUrl: briefingData.dashboardUrl,
    ctaLabel: 'Open Strategy Review',
    customEmail: { subject, html, text },
    dedupeKey: `monthly-review:${targetProject._id}:${getProjectLocalTime(targetProject.timezone || 'UTC').dateString.slice(0, 7)}`
  });
  targetProject.cmoNotifications.monthlyStrategyReview.lastSentAt = new Date();
  await targetProject.save();
  return { success: true, deliveries: dispatch.sent || 0, project: targetProject.name };
}

async function sendProactiveGrowthAlert({
  project,
  type = 'recommendation_urgent',
  severity = 'growth_opportunity',
  title,
  summary,
  evidenceData = {},
  ctaUrl = '',
  ctaLabel = 'Review in Moyi'
}) {
  const targetProject = typeof project === 'object' && project._id ? project : await Project.findById(project).populate('owner');
  if (!targetProject) throw new Error('Project not found for growth alert.');

  const cmoNotifs = targetProject.cmoNotifications || {};
  const alertConfig = cmoNotifs.growthAlerts || {};
  if (alertConfig.enabled === false) {
    return { skipped: true, reason: 'Growth alerts disabled in project settings.' };
  }

  const to = targetProject.owner && targetProject.owner.email;
  if (!to) return { skipped: true, reason: 'No owner email.' };

  const targetUrl = ctaUrl || `${env.appUrl}/projects/${targetProject._id}`;
  const subject = `[Moyi Alert] ${title} - ${targetProject.name}`;

  const html = `
    <div style="background:#0d1012;border:1px solid #232a30;border-radius:12px;padding:24px;max-width:580px;font-family:sans-serif;color:#e1e7ec;">
      <span style="font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#55e6cf;">Moyi Growth Alert</span>
      <h2 style="margin:8px 0 12px;font-size:20px;color:#ffffff;">${escapeHtml(title)}</h2>
      <p style="margin:0 0 20px;color:#9eaab6;font-size:14px;line-height:1.5;">${escapeHtml(summary)}</p>
      <div style="margin:24px 0 12px;">
        <a href="${escapeHtml(targetUrl)}" style="display:inline-block;padding:12px 24px;background:#55e6cf;color:#04110e;text-decoration:none;font-weight:800;border-radius:8px;">${escapeHtml(ctaLabel)} &rarr;</a>
      </div>
      <p style="margin:20px 0 0;font-size:11px;color:#6b7280;">Project: ${escapeHtml(targetProject.name)} | Website: ${escapeHtml(targetProject.websiteUrl)}</p>
    </div>
  `;

  await emailService.sendEmail({
    to,
    subject,
    html,
    text: `${title}\n\n${summary}\n\nView details: ${targetUrl}`
  });

  await GrowthAlert.create({
    projectId: targetProject._id,
    userId: targetProject.owner._id,
    recipientUserIds: [targetProject.owner._id],
    type,
    category: 'growth',
    severity,
    title,
    summary,
    evidenceData,
    ctaUrl: targetUrl,
    ctaLabel,
    recipientEmail: to,
    channels: ['in_app', 'email'],
    deliveryStatus: 'sent',
    sentAt: new Date()
  });

  return { success: true, recipient: to, title };
}

async function triggerWeeklyBriefingBatch({ force = false } = {}) {
  const now = new Date();

  const projects = await Project.find({
    status: 'approved'
  }).populate('owner');

  const results = [];
  for (const project of projects) {
    try {
      const config = (project.cmoNotifications && project.cmoNotifications.weeklyBriefing) || {};
      if (!force && config.enabled === false) continue;
      const local = getProjectLocalTime(project.timezone || 'UTC', now);
      const targetDay = config.deliveryDay || 'monday';
      if (!force && targetDay !== local.weekday) continue;
      if (!force && !isLocalDeliveryDue(local, config.deliveryTime || '08:00')) continue;
      if (!force && config.lastSentAt && getProjectLocalTime(project.timezone || 'UTC', new Date(config.lastSentAt)).dateString === local.dateString) continue;

      const res = await sendWeeklyBriefingEmail({ project, force });
      results.push(res);
    } catch (err) {
      results.push({ success: false, project: project.name, error: err.message });
    }
  }

  return results;
}

async function triggerMonthlyStrategyReviewBatch({ force = false, now = new Date() } = {}) {
  const projects = await Project.find({ status: 'approved' }).populate('owner');
  const results = [];
  for (const project of projects) {
    try {
      const config = project.cmoNotifications && project.cmoNotifications.monthlyStrategyReview || {};
      if (!force && config.enabled === false) continue;
      const local = getProjectLocalTime(project.timezone || 'UTC', now);
      if (!force && local.dayOfMonth !== Number(config.deliveryDate || 1)) continue;
      if (!force && !isLocalDeliveryDue(local, config.deliveryTime || '08:00')) continue;
      if (!force && config.lastSentAt) {
        const previous = getProjectLocalTime(project.timezone || 'UTC', new Date(config.lastSentAt));
        if (previous.dateString.slice(0, 7) === local.dateString.slice(0, 7)) continue;
      }
      results.push(await sendMonthlyStrategyReview({ project, force }));
    } catch (error) {
      results.push({ success: false, project: project.name, error: error.message });
    }
  }
  return results;
}

module.exports = {
  buildWeeklyBriefingData,
  renderWeeklyBriefingHtml,
  sendWeeklyBriefingEmail,
  sendMonthlyStrategyReview,
  sendProactiveGrowthAlert,
  triggerWeeklyBriefingBatch,
  triggerMonthlyStrategyReviewBatch
};
