const { aggregateMetrics, budgetPacing, percentChange } = require('./metrics');

function scoreBand(value, thresholds, inverse = false) {
  if (value === null || value === undefined) return null;
  const [poor, good] = thresholds;
  if (inverse) {
    if (value <= good) return 100;
    if (value >= poor) return 20;
    return Math.round(100 - ((value - good) / (poor - good)) * 80);
  }
  if (value >= good) return 100;
  if (value <= poor) return 20;
  return Math.round(20 + ((value - poor) / (good - poor)) * 80);
}

function campaignHealth(metrics, context = {}) {
  const pace = context.pacing || { status: 'unknown', paceRatio: null };
  const dimensions = {
    spendEfficiency: scoreBand(metrics.cpa ?? metrics.costPerLead, [100, 20], true),
    conversionQuality: metrics.leads
      ? scoreBand((metrics.qualifiedLeads ?? metrics.conversions ?? 0) / metrics.leads, [0.1, 0.5])
      : null,
    roas: scoreBand(metrics.roas, [0.5, 3]),
    budgetPacing: pace.status === 'unknown' ? null : scoreBand(Math.abs(1 - pace.paceRatio), [0.5, 0], true),
    creativeFreshness: context.creativeAgeDays === undefined ? null : scoreBand(context.creativeAgeDays, [60, 14], true),
    audienceSaturation: metrics.frequency === null ? null : scoreBand(metrics.frequency, [5, 1.5], true),
    landingPagePerformance: metrics.websiteSessions
      ? scoreBand((metrics.conversions ?? 0) / metrics.websiteSessions, [0.01, 0.08])
      : null
  };
  const known = Object.values(dimensions).filter((value) => value !== null);
  const score = known.length ? Math.round(known.reduce((sum, value) => sum + value, 0) / known.length) : null;
  return {
    score,
    grade: score === null ? 'Awaiting data' : (score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F'),
    dimensions,
    coverage: Math.round((known.length / Object.keys(dimensions).length) * 100)
  };
}

function alert(type, severity, title, summary, evidenceData, recommendedAction) {
  return { type, severity, title, summary, evidenceData, recommendedAction };
}

function detectAlerts({ current, previous = {}, pacing = {}, entityName = 'Campaign', level = 'campaign' }) {
  const alerts = [];
  const spendChange = percentChange(current.spend, previous.spend);
  const cpcChange = percentChange(current.cpc, previous.cpc);
  const cpmChange = percentChange(current.cpm, previous.cpm);
  const ctrChange = percentChange(current.ctr, previous.ctr);
  const cpaChange = percentChange(current.cpa, previous.cpa);
  const cacChange = percentChange(current.cac, previous.cac);
  const roasChange = percentChange(current.roas, previous.roas);
  const evidence = { current, previous, pacing, level, entityName };

  if (spendChange !== null && spendChange >= 0.5) alerts.push(alert('ad_spend_spike', 'warning', `${entityName} spend increased sharply`, `Spend rose ${(spendChange * 100).toFixed(0)}% versus the previous period.`, evidence, 'Verify that the increase is intentional and matched by qualified outcomes.'));
  if ((current.spend || 0) >= 50 && (current.conversions || 0) === 0) alerts.push(alert('ad_spend_no_conversion', 'critical', `${entityName} is spending without conversions`, `${entityName} spent ${Number(current.spend).toFixed(2)} with no measured conversions.`, evidence, 'Inspect targeting, conversion tracking, and landing-page friction before adding budget.'));
  if (pacing.status === 'overspending' || pacing.status === 'underspending') alerts.push(alert('budget_pacing', 'warning', `${entityName} is ${pacing.status}`, `Projected spend is ${pacing.projectedSpend === null ? 'unavailable' : Number(pacing.projectedSpend).toFixed(2)} against the period budget.`, evidence, 'Review delivery settings and budget allocation; keep changes human-approved.'));
  if (cpcChange !== null && cpcChange >= 0.3) alerts.push(alert('cpc_spike', 'warning', `${entityName} CPC increased`, `CPC rose ${(cpcChange * 100).toFixed(0)}% period over period.`, evidence, 'Review query quality, auction pressure, audience overlap, and creative relevance.'));
  if (cpmChange !== null && cpmChange >= 0.3) alerts.push(alert('cpm_spike', 'warning', `${entityName} CPM increased`, `CPM rose ${(cpmChange * 100).toFixed(0)}% period over period.`, evidence, 'Check audience saturation, placements, seasonality, and auction competition.'));
  if (ctrChange !== null && ctrChange <= -0.25) alerts.push(alert('ctr_drop', 'warning', `${entityName} CTR declined`, `CTR fell ${Math.abs(ctrChange * 100).toFixed(0)}% period over period.`, evidence, 'Test a fresher message or creative while preserving the current control.'));
  if (cpaChange !== null && cpaChange >= 0.3) alerts.push(alert('cpa_spike', 'critical', `${entityName} CPA increased`, `CPA rose ${(cpaChange * 100).toFixed(0)}% period over period.`, evidence, 'Reduce waste and inspect conversion quality before scaling.'));
  if (cacChange !== null && cacChange >= 0.3) alerts.push(alert('cac_spike', 'critical', `${entityName} CAC increased`, `CAC rose ${(cacChange * 100).toFixed(0)}% period over period.`, evidence, 'Compare customer quality and payback against the approved CAC ceiling.'));
  if (roasChange !== null && roasChange <= -0.25) alerts.push(alert('roas_drop', 'critical', `${entityName} ROAS declined`, `ROAS fell ${Math.abs(roasChange * 100).toFixed(0)}% period over period.`, evidence, 'Inspect conversion value, attribution quality, and spend concentration.'));
  if (roasChange !== null && roasChange >= 0.3 && (current.conversions || 0) >= 3) alerts.push(alert('roas_breakout', 'growth_opportunity', `${entityName} ROAS is breaking out`, `ROAS improved ${(roasChange * 100).toFixed(0)}% with ${current.conversions} conversions.`, evidence, 'Consider a controlled budget increase after checking conversion quality.'));
  if ((current.frequency || 0) >= 3.5 && ctrChange !== null && ctrChange <= -0.2) alerts.push(alert(level === 'audience' ? 'audience_saturation' : 'creative_fatigue', 'warning', `${entityName} shows fatigue`, `Frequency reached ${Number(current.frequency).toFixed(1)} while CTR declined.`, evidence, 'Rotate creative or broaden the audience without discarding the current benchmark.'));
  if ((current.roas || 0) >= 2.5 && (current.conversions || 0) >= 3) alerts.push(alert(level === 'campaign' ? 'campaign_breakout' : 'winning_ad_detected', 'growth_opportunity', `${entityName} is a measured winner`, `${entityName} produced ${Number(current.roas).toFixed(2)}x ROAS across ${current.conversions} conversions.`, evidence, 'Validate lead or customer quality, then test a controlled scale increase.'));
  if ((current.spend || 0) >= 100 && ((current.roas !== null && current.roas < 0.75) || ((current.conversions || 0) === 0))) alerts.push(alert('campaign_underperforming', 'critical', `${entityName} is underperforming`, 'Material spend is not producing sufficient measured business value.', evidence, 'Pause further scaling and diagnose the funnel before changing budget.'));
  return alerts;
}

function buildBudgetRecommendations(channels = [], window = {}) {
  const eligible = channels.filter((channel) => (
    (channel.metrics.qualifiedLeads || channel.metrics.conversions || 0) >= 3 &&
    channel.metrics.spend > 0 &&
    (channel.metrics.cpa !== null || channel.metrics.costPerLead !== null)
  ));
  if (eligible.length < 2) return [];
  const ranked = eligible.slice().sort((a, b) => (
    (a.metrics.cpa ?? a.metrics.costPerLead) - (b.metrics.cpa ?? b.metrics.costPerLead)
  ));
  const winner = ranked[0];
  const loser = ranked[ranked.length - 1];
  const winnerCost = winner.metrics.cpa ?? winner.metrics.costPerLead;
  const loserCost = loser.metrics.cpa ?? loser.metrics.costPerLead;
  if (!winnerCost || loserCost < winnerCost * 1.25) return [];
  const improvement = 1 - (winnerCost / loserCost);
  const shift = improvement >= 0.5 ? 20 : 15;
  return [{
    type: 'budget_reallocation',
    title: `Shift a controlled share from ${loser.name} to ${winner.name}`,
    evidence: [
      `${winner.name} generated measured results at ${winnerCost.toFixed(2)} cost per outcome.`,
      `${loser.name} generated measured results at ${loserCost.toFixed(2)} cost per outcome.`,
      `The measured cost gap is ${(improvement * 100).toFixed(0)}%.`
    ],
    confidence: Math.min(95, 65 + Math.min(30, ((winner.metrics.conversions || winner.metrics.qualifiedLeads || 0) * 3))),
    businessImpact: 'Potentially produce more qualified outcomes from the same total media budget.',
    proposedChange: `Consider moving ${shift}% of the testable budget from ${loser.name} to ${winner.name}.`,
    risk: 'Channel mix effects and attribution bias may make recent performance temporary; use a controlled test.',
    expectedOutcome: `If current efficiency holds, the shifted budget should lower blended acquisition cost toward ${winnerCost.toFixed(2)} per outcome.`,
    sourceProvider: loser.provider,
    destinationProvider: winner.provider,
    proposedShiftPercent: shift,
    evidenceWindow: window
  }];
}

function compareGroups(rows, key) {
  const groups = new Map();
  rows.forEach((row) => {
    const id = row[key] || 'unknown';
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  });
  return Array.from(groups.entries()).map(([name, values]) => ({ name, metrics: aggregateMetrics(values) }));
}

module.exports = {
  buildBudgetRecommendations,
  campaignHealth,
  compareGroups,
  detectAlerts
};
