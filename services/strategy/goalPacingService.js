function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function evaluateGoalPacing(goal, now = new Date()) {
  const start = new Date(goal.periodStart);
  const end = new Date(goal.periodEnd);
  const totalMs = Math.max(1, end - start);
  const elapsedRatio = clamp((Math.min(now, end) - start) / totalMs, 0, 1);
  const target = Number(goal.targetValue || 0);
  const current = Number(goal.currentValue || 0);
  const expectedProgress = goal.direction === 'decrease' ? null : target * elapsedRatio;
  const gapPercent = expectedProgress > 0 ? ((current - expectedProgress) / expectedProgress) * 100 : null;
  const remainingDays = Math.max(0, Math.ceil((end - now) / 86400000));
  const requiredPace = goal.direction === 'decrease' || remainingDays === 0 ? null : Math.max(0, target - current) / remainingDays;
  const elapsedDays = Math.max(1, Math.ceil((Math.min(now, end) - start) / 86400000));
  const currentPace = goal.direction === 'decrease' ? null : current / elapsedDays;
  let status = 'observing';
  if (elapsedRatio >= 0 && goal.direction === 'increase' && expectedProgress !== null) {
    status = current >= target ? 'achieved' : gapPercent < -15 ? 'at_risk' : gapPercent > 10 ? 'ahead' : 'on_track';
  }
  return { currentProgress: current, elapsedPercent: Math.round(elapsedRatio * 1000) / 10, expectedProgress, gapPercent: gapPercent === null ? null : Math.round(gapPercent * 10) / 10, requiredPace, currentPace, remainingDays, status };
}

module.exports = { evaluateGoalPacing };
