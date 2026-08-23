const Project = require('../models/Project');
const {
  triggerMonthlyStrategyReviewBatch,
  triggerWeeklyBriefingBatch
} = require('./cmoBriefingService');
const { triggerDailyContentBatch } = require('./dailyContentScheduler');
const { triggerDailyGrowthBatch } = require('./dailyGrowthScheduler');
const { evaluateProjectGoals } = require('./goalIntelligenceService');
const { refreshExpiringSocialAccounts } = require('./socialTokenRefreshService');
const { collectDueMetrics } = require('./engagementMetricsService');

let schedulerTimer = null;
let initialTimer = null;
let runInProgress = false;

async function triggerGoalEvaluationBatch() {
  const projects = await Project.find({ status: 'approved' }).select('_id').lean();
  const results = [];
  for (const project of projects) {
    try {
      const evaluations = await evaluateProjectGoals(project._id);
      results.push({ projectId: project._id, evaluated: evaluations.length });
    } catch (error) {
      results.push({ projectId: project._id, error: error.message });
    }
  }
  return results;
}

async function runOperationalSchedules() {
  if (runInProgress) return { skipped: true, reason: 'Previous operational schedule run is still active.' };
  runInProgress = true;
  try {
    const [dailyGrowth, dailyContent, weeklyBriefs, monthlyReviews, goals, tokenRefresh, metricsCollection] = await Promise.all([
      triggerDailyGrowthBatch(),
      triggerDailyContentBatch(),
      triggerWeeklyBriefingBatch(),
      triggerMonthlyStrategyReviewBatch(),
      triggerGoalEvaluationBatch(),
      refreshExpiringSocialAccounts({ withinMs: 48 * 60 * 60 * 1000 }).catch((error) => ({ error: error.message })),
      collectDueMetrics().catch((error) => ({ error: error.message }))
    ]);
    return { dailyGrowth, dailyContent, weeklyBriefs, monthlyReviews, goals, tokenRefresh, metricsCollection };
  } finally {
    runInProgress = false;
  }
}

function startCmoBriefingScheduler(intervalMs = 15 * 60 * 1000) {
  if (schedulerTimer) return;
  initialTimer = setTimeout(() => {
    runOperationalSchedules().catch((error) => console.error('[CMO Operations Scheduler] Initial run error:', error.message));
  }, 120000);
  schedulerTimer = setInterval(() => {
    runOperationalSchedules().catch((error) => console.error('[CMO Operations Scheduler] Run error:', error.message));
  }, intervalMs);
}

function stopCmoBriefingScheduler() {
  if (initialTimer) clearTimeout(initialTimer);
  if (schedulerTimer) clearInterval(schedulerTimer);
  initialTimer = null;
  schedulerTimer = null;
  runInProgress = false;
}

module.exports = {
  runOperationalSchedules,
  startCmoBriefingScheduler,
  stopCmoBriefingScheduler,
  triggerDailyGrowthBatch,
  triggerGoalEvaluationBatch
};
