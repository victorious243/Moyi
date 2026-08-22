const MONEY_METRICS = new Set([
  'spend', 'budget', 'cpc', 'cpm', 'conversionValue', 'cpa', 'cac',
  'costPerLead', 'attributedRevenue'
]);

const METRIC_NAMES = [
  'spend', 'budget', 'impressions', 'reach', 'clicks', 'ctr', 'cpc', 'cpm',
  'conversions', 'conversionValue', 'cpa', 'cac', 'roas', 'frequency', 'leads',
  'qualifiedLeads', 'costPerLead', 'websiteSessions', 'signups', 'purchases',
  'attributedRevenue'
];

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function divide(numerator, denominator) {
  const top = nullableNumber(numerator);
  const bottom = nullableNumber(denominator);
  if (top === null || bottom === null || bottom === 0) return null;
  return top / bottom;
}

function calculateDerivedMetrics(input = {}) {
  const metrics = METRIC_NAMES.reduce((output, name) => {
    output[name] = nullableNumber(input[name]);
    return output;
  }, {});

  metrics.ctr = metrics.ctr ?? divide(metrics.clicks, metrics.impressions);
  metrics.cpc = metrics.cpc ?? divide(metrics.spend, metrics.clicks);
  metrics.cpm = metrics.cpm ?? (() => {
    const value = divide(metrics.spend, metrics.impressions);
    return value === null ? null : value * 1000;
  })();
  metrics.cpa = metrics.cpa ?? divide(metrics.spend, metrics.conversions);
  metrics.cac = metrics.cac ?? divide(metrics.spend, metrics.purchases ?? metrics.qualifiedLeads);
  metrics.roas = metrics.roas ?? divide(
    metrics.attributedRevenue ?? metrics.conversionValue,
    metrics.spend
  );
  metrics.frequency = metrics.frequency ?? divide(metrics.impressions, metrics.reach);
  metrics.costPerLead = metrics.costPerLead ?? divide(metrics.spend, metrics.leads);
  return metrics;
}

function sumNullable(rows, name) {
  const values = rows.map((row) => nullableNumber((row.metrics || row)[name])).filter((value) => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function aggregateMetrics(rows = []) {
  const additive = [
    'spend', 'budget', 'impressions', 'reach', 'clicks', 'conversions',
    'conversionValue', 'leads', 'qualifiedLeads', 'websiteSessions', 'signups',
    'purchases', 'attributedRevenue'
  ];
  const totals = additive.reduce((output, name) => {
    output[name] = sumNullable(rows, name);
    return output;
  }, {});
  return calculateDerivedMetrics(totals);
}

function percentChange(current, previous) {
  const currentNumber = nullableNumber(current);
  const previousNumber = nullableNumber(previous);
  if (currentNumber === null || previousNumber === null || previousNumber === 0) return null;
  return (currentNumber - previousNumber) / previousNumber;
}

function budgetPacing({ spend, budget, periodStart, periodEnd, asOf = new Date() }) {
  const totalBudget = nullableNumber(budget);
  const actualSpend = nullableNumber(spend);
  if (totalBudget === null || actualSpend === null || totalBudget === 0) {
    return { available: false, expectedSpend: null, paceRatio: null, projectedSpend: null, status: 'unknown' };
  }

  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  const now = new Date(Math.min(Math.max(new Date(asOf).getTime(), start.getTime()), end.getTime()));
  const totalMs = Math.max(1, end.getTime() - start.getTime());
  const elapsedRatio = Math.max(0, Math.min(1, (now.getTime() - start.getTime()) / totalMs));
  const expectedSpend = totalBudget * elapsedRatio;
  const paceRatio = expectedSpend > 0 ? actualSpend / expectedSpend : null;
  const projectedSpend = elapsedRatio > 0 ? actualSpend / elapsedRatio : actualSpend;
  let status = 'on_pace';
  if (paceRatio !== null && paceRatio > 1.15) status = 'overspending';
  if (paceRatio !== null && paceRatio < 0.85) status = 'underspending';

  return { available: true, expectedSpend, paceRatio, projectedSpend, status };
}

function availableMetrics(metrics = {}) {
  return METRIC_NAMES.filter((name) => metrics[name] !== null && metrics[name] !== undefined);
}

function roundMetrics(metrics = {}, digits = 6) {
  return Object.fromEntries(Object.entries(metrics).map(([name, value]) => {
    if (value === null || value === undefined) return [name, null];
    const precision = MONEY_METRICS.has(name) ? Math.min(6, digits) : digits;
    return [name, Number(Number(value).toFixed(precision))];
  }));
}

module.exports = {
  METRIC_NAMES,
  aggregateMetrics,
  availableMetrics,
  budgetPacing,
  calculateDerivedMetrics,
  nullableNumber,
  percentChange,
  roundMetrics
};

