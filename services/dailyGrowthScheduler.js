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
const GrowthAlert = require('../models/GrowthAlert');
const { generateDailyGrowthIntelligenceReport, normalizeDate } = require('./dailyGrowthIntelligenceService');
const { updateProjectGrowthBaselines } = require('./growthBaselineLearningService');

let schedulerInterval = null;

/**
 * Get current hour and date in target timezone
 */
function getProjectLocalTime(timezone = 'UTC', baseDate = new Date()) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      hour: 'numeric',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = formatter.formatToParts(baseDate);
    const hourPart = parts.find((p) => p.type === 'hour');
    const dayPart = parts.find((p) => p.type === 'day');
    const monthPart = parts.find((p) => p.type === 'month');
    const yearPart = parts.find((p) => p.type === 'year');

    const hour = parseInt(hourPart ? hourPart.value : baseDate.getUTCHours(), 10) % 24;
    const dateString = `${yearPart ? yearPart.value : baseDate.getUTCFullYear()}-${monthPart ? monthPart.value : '01'}-${dayPart ? dayPart.value : '01'}`;

    return { hour, dateString, valid: true };
  } catch (err) {
    // Fallback to UTC if timezone is invalid
    return {
      hour: baseDate.getUTCHours(),
      dateString: baseDate.toISOString().slice(0, 10),
      valid: false
    };
  }
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

  // 3. Dispatch Proactive In-App Alert for Opportunities / Risks
  if (report.reportMode === 'opportunity' || report.reportMode === 'performance_alert') {
    const isOpp = report.reportMode === 'opportunity';
    await GrowthAlert.create({
      projectId: project._id,
      type: isOpp ? 'daily_content_intelligence' : 'competitor_spike',
      severity: isOpp ? 'medium' : 'high',
      title: isOpp ? 'Daily Growth Opportunity Detected' : 'Social Performance Alert',
      summary: report.executiveSummary,
      actionUrl: `/projects/${project._id}/growth-intelligence`,
      actionLabel: 'View Diagnosis & Actions',
      metadata: {
        reportId: report._id,
        score: report.performanceScore,
        reportMode: report.reportMode
      }
    });
  }

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
      const reportingHour = typeof config.reportingHour === 'number' ? config.reportingHour : 7;
      const { hour: localHour, dateString } = getProjectLocalTime(timezone, now);

      // In automated scheduled mode, only run if current local hour matches reporting hour
      if (!options.force && localHour !== reportingHour) {
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
  processProjectDailyGrowthRun,
  triggerDailyGrowthBatch,
  startDailyGrowthScheduler,
  stopDailyGrowthScheduler
};
