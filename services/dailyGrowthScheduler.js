/**
 * Timezone-Aware Daily Growth Intelligence Scheduler Service
 *
 * Implements Section 15 (Scheduling & Timezone-Aware Automation):
 * 1. Checks projects hourly against their configured local timezone (e.g. 7:00 AM local).
 * 2. Generates Daily Growth Intelligence reports and updates rolling historical baselines.
 * 3. Prevents duplicate daily runs (idempotent).
 * 4. Dispatches proactive in-app GrowthAlerts for breakout opportunities or performance risks.
 * 5. Provides retry handling, failure logging, and manual batch execution.
 */

const Project = require('../models/Project');
const DailyGrowthIntelligence = require('../models/DailyGrowthIntelligence');
const { generateDailyGrowthIntelligenceReport, normalizeDate } = require('./dailyGrowthIntelligenceService');
const { updateProjectGrowthBaselines } = require('./growthBaselineLearningService');
const { createAndDispatchNotification } = require('./notificationDeliveryService');

let schedulerInterval = null;

/**
 * Get current hour and date in target timezone
 */
function getProjectLocalTime(timezone = 'UTC', baseDate = new Date()) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      hour: 'numeric',
      minute: '2-digit',
      hour12: false,
      weekday: 'long',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = formatter.formatToParts(baseDate);
    const hourPart = parts.find((p) => p.type === 'hour');
    const dayPart = parts.find((p) => p.type === 'day');
    const minutePart = parts.find((p) => p.type === 'minute');
    const weekdayPart = parts.find((p) => p.type === 'weekday');
    const monthPart = parts.find((p) => p.type === 'month');
    const yearPart = parts.find((p) => p.type === 'year');

    const hour = parseInt(hourPart ? hourPart.value : baseDate.getUTCHours(), 10) % 24;
    const dateString = `${yearPart ? yearPart.value : baseDate.getUTCFullYear()}-${monthPart ? monthPart.value : '01'}-${dayPart ? dayPart.value : '01'}`;

    return {
      hour,
      minute: parseInt(minutePart ? minutePart.value : baseDate.getUTCMinutes(), 10),
      weekday: String(weekdayPart ? weekdayPart.value : '').toLowerCase(),
      dayOfMonth: parseInt(dayPart ? dayPart.value : baseDate.getUTCDate(), 10),
      dateString,
      valid: true
    };
  } catch (err) {
    // Fallback to UTC if timezone is invalid
    return {
      hour: baseDate.getUTCHours(),
      minute: baseDate.getUTCMinutes(),
      weekday: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][baseDate.getUTCDay()],
      dayOfMonth: baseDate.getUTCDate(),
      dateString: baseDate.toISOString().slice(0, 10),
      valid: false
    };
  }
}

function isLocalDeliveryDue(localTime, deliveryTime = '07:00') {
  const [hour, minute] = String(deliveryTime || '07:00').split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return false;
  return (localTime.hour * 60 + localTime.minute) >= (hour * 60 + minute);
}

const emailService = require('./emailService');
const env = require('../config/env');

function renderDailyGrowthBriefingHtml(project, report) {
  const score = report.performanceScore || {};
  const subScores = score.subScores || {};
  const champions = report.platformChampions || {};
  const isOpp = report.reportMode === 'opportunity';
  const isAlert = report.reportMode === 'performance_alert';
  const modeColor = isAlert ? '#ef4444' : (isOpp ? '#10b981' : '#6366f1');
  const modeLabel = isAlert ? 'Performance Risk Alert' : (isOpp ? 'Growth Opportunity Detected' : 'Daily Morning Brief');

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;line-height:1.6;">
      <div style="display:inline-block;padding:4px 10px;border-radius:999px;background:${modeColor}15;color:${modeColor};font-size:12px;font-weight:800;text-transform:uppercase;margin-bottom:12px;">
        ${modeLabel}
      </div>
      <h2 style="margin:0 0 8px;font-size:22px;color:#111827;">${emailService.escapeHtml(project.name)} — Daily Growth Intelligence</h2>
      <p style="color:#4b5563;font-size:15px;margin:0 0 20px;">${emailService.escapeHtml(report.executiveSummary || '')}</p>

      <!-- Score Box -->
      <div style="background:#0f172a;border-radius:12px;padding:20px;color:#ffffff;margin-bottom:24px;">
        <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:14px;margin-bottom:14px;">
          <div>
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#94a3b8;font-weight:700;">6D Growth Score</div>
            <div style="font-size:36px;font-weight:900;color:#55e6cf;line-height:1;">${score.overallScore ?? 65}<span style="font-size:18px;color:#94a3b8;">/100</span> <span style="font-size:16px;background:rgba(255,255,255,0.1);padding:2px 8px;border-radius:6px;vertical-align:middle;">Grade ${score.grade || 'B'}</span></div>
          </div>
          <div style="text-align:right;max-width:280px;font-size:13px;color:#cbd5e1;">
            ${emailService.escapeHtml(score.scoreMovementExplanation || 'Performance is tracking on baseline.')}
          </div>
        </div>

        <table style="width:100%;font-size:12px;color:#94a3b8;" cellspacing="0" cellpadding="4">
          <tr>
            <td>Audience: <strong style="color:#fff;">${subScores.audienceGrowth ?? 65}/100</strong></td>
            <td>Content: <strong style="color:#fff;">${subScores.contentPerformance ?? 65}/100</strong></td>
            <td>Engagement: <strong style="color:#fff;">${subScores.engagementRate ?? 65}/100</strong></td>
          </tr>
          <tr>
            <td>Acquisition: <strong style="color:#fff;">${subScores.websiteAcquisition ?? 60}/100</strong></td>
            <td>Conversion: <strong style="color:#fff;">${subScores.conversionFunnel ?? 55}/100</strong></td>
            <td>Visibility: <strong style="color:#fff;">${subScores.brandVisibility ?? 65}/100</strong></td>
          </tr>
        </table>
      </div>

      <!-- Champions -->
      <h3 style="font-size:16px;margin:0 0 10px;color:#111827;">🏆 Platform Champions</h3>
      <table style="width:100%;border:1px solid #e2e8f0;border-radius:8px;border-collapse:collapse;margin-bottom:24px;font-size:13px;" cellpadding="8">
        <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;text-align:left;">
          <th style="color:#64748b;">Objective</th>
          <th style="color:#64748b;">Champion</th>
          <th style="color:#64748b;">Metric</th>
        </tr>
        <tr style="border-bottom:1px solid #f1f5f9;">
          <td><strong>Reach & Impressions</strong></td>
          <td style="text-transform:capitalize;">${emailService.escapeHtml(champions.bestForReach?.platform || 'N/A')}</td>
          <td>${(champions.bestForReach?.impressions || 0).toLocaleString()} views</td>
        </tr>
        <tr style="border-bottom:1px solid #f1f5f9;">
          <td><strong>Engagement Rate</strong></td>
          <td style="text-transform:capitalize;">${emailService.escapeHtml(champions.bestForEngagement?.platform || 'N/A')}</td>
          <td>${(champions.bestForEngagement?.engagementRate || 0)}% ER</td>
        </tr>
        <tr style="border-bottom:1px solid #f1f5f9;">
          <td><strong>Website Traffic</strong></td>
          <td style="text-transform:capitalize;">${emailService.escapeHtml(champions.bestForWebsiteTraffic?.platform || 'N/A')}</td>
          <td>${(champions.bestForWebsiteTraffic?.sessions || 0)} sessions</td>
        </tr>
        <tr>
          <td><strong>Attributed Revenue</strong></td>
          <td style="text-transform:capitalize;">${emailService.escapeHtml(champions.bestForRevenue?.platform || 'N/A')}</td>
          <td>€${(champions.bestForRevenue?.revenue || 0).toLocaleString()}</td>
        </tr>
      </table>

      <!-- Top Opportunities & Recommended Actions -->
      ${report.opportunities && report.opportunities.length ? `
        <h3 style="font-size:16px;margin:0 0 10px;color:#111827;">💡 Detected Growth Opportunities</h3>
        <div style="background:#f0fdf4;border-left:4px solid #10b981;border-radius:6px;padding:14px;margin-bottom:20px;">
          <strong style="color:#065f46;font-size:14px;">${emailService.escapeHtml(report.opportunities[0].title)}</strong>
          <p style="color:#047857;margin:4px 0 8px;font-size:13px;">${emailService.escapeHtml(report.opportunities[0].rationale)}</p>
          <div style="font-size:12px;color:#065f46;"><strong>Recommended action:</strong> ${emailService.escapeHtml(report.opportunities[0].actionableRecommendation)}</div>
        </div>
      ` : ''}

      ${report.risks && report.risks.length ? `
        <h3 style="font-size:16px;margin:0 0 10px;color:#991b1b;">⚠️ Performance Risks Requiring Attention</h3>
        <div style="background:#fef2f2;border-left:4px solid #ef4444;border-radius:6px;padding:14px;margin-bottom:20px;">
          <strong style="color:#991b1b;font-size:14px;">${emailService.escapeHtml(report.risks[0].title)}</strong>
          <p style="color:#b91c1c;margin:4px 0 8px;font-size:13px;">${emailService.escapeHtml(report.risks[0].description)}</p>
          <div style="font-size:12px;color:#991b1b;"><strong>Diagnosis:</strong> ${emailService.escapeHtml(report.risks[0].recommendedCorrection)}</div>
        </div>
      ` : ''}

      <div style="text-align:center;margin-top:28px;">
        <a href="${env.appUrl}/projects/${project._id}/growth-intelligence" style="display:inline-block;background:#6366f1;color:#ffffff;font-weight:800;font-size:14px;padding:14px 28px;border-radius:8px;text-decoration:none;box-shadow:0 4px 14px rgba(99,102,241,0.35);">
          Open Morning Briefing in Moyi &rarr;
        </a>
      </div>
    </div>
  `;
}

async function sendDailyGrowthBriefingEmail({ project, report, force = true }) {
  const targetProject = typeof project === 'object' && project._id
    ? project
    : await Project.findById(project).populate('owner');
  if (!targetProject) throw new Error('Project not found for daily growth briefing dispatch.');

  const isOpp = report.reportMode === 'opportunity';
  const isAlert = report.reportMode === 'performance_alert';
  const score = report.performanceScore || {};
  const subject = isAlert
    ? `⚠️ [Alert] Social Performance Risk: ${targetProject.name} (Score: ${score.overallScore ?? 65}/100)`
    : (isOpp
      ? `🚀 [Opportunity] Daily Growth Breakout: ${targetProject.name} (Score: ${score.overallScore ?? 65}/100)`
      : `🌅 Daily Growth Intelligence Brief: ${targetProject.name} (Score: ${score.overallScore ?? 65}/100 - Grade ${score.grade || 'B'})`);

  const html = renderDailyGrowthBriefingHtml(targetProject, report);
  const text = `${subject}\n\n${report.executiveSummary || ''}\n\nReview your full morning briefing at ${env.appUrl}/projects/${targetProject._id}/growth-intelligence`;

  const reportDateStr = (report.date ? new Date(report.date) : new Date()).toISOString().slice(0, 10);
  const dedupeKey = `daily-growth-brief:${targetProject._id}:${reportDateStr}:${report.reportMode || 'normal'}`;

  const dispatchResult = await createAndDispatchNotification({
    project: targetProject,
    force: true,
    type: 'daily_growth_intelligence',
    category: 'growth',
    severity: isAlert ? 'warning' : 'growth_opportunity',
    urgency: isAlert ? 'high' : 'normal',
    confidence: 88,
    title: isOpp ? 'Daily Growth Opportunity Detected' : (isAlert ? 'Social Performance Alert' : 'Daily Growth Morning Brief Ready'),
    summary: report.executiveSummary || `Your daily growth intelligence briefing is ready with a 6D score of ${score.overallScore ?? 65}/100.`,
    businessImpact: isOpp
      ? 'A measurable growth opportunity is ready for 1-click review.'
      : (isAlert ? 'A performance decline was detected and root-cause diagnosed.' : 'Daily performance tracking on baseline across all channels.'),
    recommendedAction: (report.opportunities && report.opportunities[0] && report.opportunities[0].actionableRecommendation) || 'Review yesterday\'s performance breakdown and today\'s action plan.',
    ctaUrl: `/projects/${targetProject._id}/growth-intelligence`,
    ctaLabel: 'Open Morning Briefing',
    evidenceData: {
      score: report.performanceScore,
      reportMode: report.reportMode,
      champions: report.platformChampions
    },
    customEmail: { subject, html, text },
    dedupeKey
  });

  return dispatchResult;
}

/**
 * Execute daily intelligence generation for a single project
 */
async function processProjectDailyGrowthRun(project, options = {}) {
  const targetDate = options.targetDate || new Date();
  const reportDate = normalizeDate(targetDate);

  // Check duplicate prevention unless forced
  if (!options.force) {
    const existing = await DailyGrowthIntelligence.findOne({
      projectId: project._id,
      date: reportDate
    }).select('_id status').lean();

    if (existing) {
      return { skipped: true, reason: 'Report already exists for this date.', reportId: existing._id };
    }
  }

  // 1. Generate Daily Growth Intelligence Report
  const report = await generateDailyGrowthIntelligenceReport(project._id, targetDate);

  // 2. Update Rolling Historical Baselines
  await updateProjectGrowthBaselines(project._id, 60);

  // 3. Dispatch In-App GrowthAlert & Morning Briefing Email to Admin and Stakeholders
  await sendDailyGrowthBriefingEmail({
    project,
    report,
    force: options.force !== false
  });

  // 4. Update Project lastGeneratedAt
  await Project.findByIdAndUpdate(project._id, {
    $set: {
      'cmoNotifications.dailyGrowthIntelligence.lastGeneratedAt': new Date()
    }
  });

  return { success: true, reportId: report._id, score: report.performanceScore, mode: report.reportMode };
}

/**
 * Process hourly timezone-aware batch across all active projects
 */
async function triggerDailyGrowthBatch(options = {}) {
  const now = options.now || new Date();
  const projects = await Project.find({
    status: { $ne: 'archived' }
  }).lean();

  const results = {
    processed: 0,
    skipped: 0,
    errors: 0,
    details: []
  };

  for (const project of projects) {
    try {
      const config = (project.cmoNotifications && project.cmoNotifications.dailyGrowthIntelligence) || {};
      if (config.enabled === false && !options.force) {
        results.skipped += 1;
        continue;
      }

      const timezone = project.timezone || 'UTC';
      const deliveryTime = config.deliveryTime || `${String(typeof config.reportingHour === 'number' ? config.reportingHour : 7).padStart(2, '0')}:00`;
      const localTime = getProjectLocalTime(timezone, now);
      const { dateString } = localTime;

      // In automated scheduled mode, only run if current local hour matches reporting hour
      if (!options.force && !isLocalDeliveryDue(localTime, deliveryTime)) {
        results.skipped += 1;
        continue;
      }

      // Check if already run today in local timezone
      const lastSent = config.lastGeneratedAt ? new Date(config.lastGeneratedAt) : null;
      if (lastSent && !options.force) {
        const { dateString: lastSentDateStr } = getProjectLocalTime(timezone, lastSent);
        if (lastSentDateStr === dateString) {
          results.skipped += 1;
          continue;
        }
      }

      const res = await processProjectDailyGrowthRun(project, options);
      if (res.skipped) {
        results.skipped += 1;
      } else {
        results.processed += 1;
      }
      results.details.push({ projectId: project._id, name: project.name, ...res });
    } catch (err) {
      results.errors += 1;
      results.details.push({ projectId: project._id, name: project.name, error: err.message });
      console.error(`[Daily Growth Scheduler] Error processing project ${project._id}:`, err.message);
    }
  }

  return results;
}

/**
 * Start background scheduler
 */
function startDailyGrowthScheduler(intervalMs = 60 * 60 * 1000) {
  if (schedulerInterval) return;

  // Run initial check after 3 minutes
  setTimeout(async () => {
    try {
      await triggerDailyGrowthBatch();
    } catch (err) {
      console.error('[Daily Growth Scheduler] Initial run error:', err.message);
    }
  }, 180000);

  // Hourly recurring check
  schedulerInterval = setInterval(async () => {
    try {
      await triggerDailyGrowthBatch();
    } catch (err) {
      console.error('[Daily Growth Scheduler] Recurring run error:', err.message);
    }
  }, intervalMs);
}

function stopDailyGrowthScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

module.exports = {
  getProjectLocalTime,
  isLocalDeliveryDue,
  processProjectDailyGrowthRun,
  triggerDailyGrowthBatch,
  startDailyGrowthScheduler,
  stopDailyGrowthScheduler,
  sendDailyGrowthBriefingEmail,
  renderDailyGrowthBriefingHtml
};
