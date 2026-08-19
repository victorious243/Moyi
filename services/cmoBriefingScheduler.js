const { triggerWeeklyBriefingBatch } = require('./cmoBriefingService');
const { startDailyGrowthScheduler, stopDailyGrowthScheduler, triggerDailyGrowthBatch } = require('./dailyGrowthScheduler');

let schedulerTimer = null;

function startCmoBriefingScheduler(intervalMs = 60 * 60 * 1000) {
  // Start daily growth intelligence scheduler
  startDailyGrowthScheduler(intervalMs);

  if (schedulerTimer) return;

  // Run initial check after 2 minutes to let database settle
  setTimeout(async () => {
    try {
      await triggerWeeklyBriefingBatch();
    } catch (err) {
      console.error('[CMO Briefing Scheduler] Run error:', err.message);
    }
  }, 120000);

  // Hourly recurring check
  schedulerTimer = setInterval(async () => {
    try {
      await triggerWeeklyBriefingBatch();
    } catch (err) {
      console.error('[CMO Briefing Scheduler] Interval error:', err.message);
    }
  }, intervalMs);
}

function stopCmoBriefingScheduler() {
  stopDailyGrowthScheduler();
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

module.exports = {
  startCmoBriefingScheduler,
  stopCmoBriefingScheduler,
  triggerDailyGrowthBatch
};
