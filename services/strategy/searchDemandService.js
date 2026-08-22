const SearchMetric = require('../../models/SearchMetric');

function aggregateQueries(rows = []) {
  const map = new Map();
  rows.forEach((row) => {
    if (!row.query) return;
    const item = map.get(row.query) || { query: row.query, impressions: 0, clicks: 0, weightedPosition: 0 };
    item.impressions += Number(row.impressions || 0);
    item.clicks += Number(row.clicks || 0);
    item.weightedPosition += Number(row.position || 0) * Number(row.impressions || 0);
    map.set(row.query, item);
  });
  return [...map.values()].map((item) => ({ ...item, position: item.impressions ? item.weightedPosition / item.impressions : 0 }));
}

function queryCluster(query) {
  return String(query).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((term) => term.length > 2).slice(0, 2).join(' ') || '(other)';
}

function isCommercialQuery(query) {
  return /\b(buy|price|pricing|cost|quote|hire|service|software|platform|agency|near me|best|demo|trial)\b/i.test(String(query || ''));
}

function detectSearchDemandShifts(currentRows = [], previousRows = [], brandName = '') {
  const current = aggregateQueries(currentRows);
  const previous = new Map(aggregateQueries(previousRows).map((item) => [item.query, item]));
  const signals = [];
  current.forEach((item) => {
    const old = previous.get(item.query) || { impressions: 0, clicks: 0, position: item.position };
    const impressionChange = old.impressions ? (item.impressions - old.impressions) / old.impressions : null;
    const positionChange = old.impressions ? old.position - item.position : 0;
    if (!old.impressions && item.impressions >= 50) {
      signals.push({ kind: 'emerging_keyword', query: item.query, cluster: queryCluster(item.query), current: item, previous: old, confidence: item.impressions >= 200 ? 85 : 65, evidence: 'The query had no impressions in the comparison window and reached the minimum current-volume threshold.' });
    } else if (old.impressions >= 30 && Math.abs(positionChange) <= 2 && Math.abs(impressionChange) >= 0.3) {
      signals.push({ kind: impressionChange > 0 ? 'demand_increase' : 'demand_decline', query: item.query, cluster: queryCluster(item.query), current: item, previous: old, changePercent: impressionChange * 100, positionChange, confidence: Math.min(92, 60 + Math.log10(item.impressions + old.impressions) * 10), evidence: 'Impressions changed materially while average position stayed within two positions, reducing the likelihood that ranking alone explains the movement.' });
    } else if (old.impressions >= 30 && Math.abs(positionChange) > 2 && Math.abs(impressionChange || 0) >= 0.3) {
      signals.push({ kind: 'ranking_change', query: item.query, cluster: queryCluster(item.query), current: item, previous: old, changePercent: impressionChange * 100, positionChange, confidence: 80, evidence: 'The impression change coincided with a material average-position change, so Moyi classifies it as ranking movement rather than market demand.' });
    }
  });
  previous.forEach((old, query) => {
    if (current.some((item) => item.query === query) || old.impressions < 50) return;
    signals.push({
      kind: 'demand_decline',
      query,
      cluster: queryCluster(query),
      current: { query, impressions: 0, clicks: 0, position: old.position },
      previous: old,
      changePercent: -100,
      positionChange: 0,
      confidence: old.impressions >= 200 ? 85 : 68,
      evidence: 'The query had meaningful impressions in the prior window and none in the current window. Ranking cannot be compared, so this is a demand-loss candidate rather than a certainty.'
    });
  });
  const brand = String(brandName || '').toLowerCase().trim();
  signals.forEach((signal) => {
    signal.brandDemand = Boolean(brand && signal.query.toLowerCase().includes(brand));
    signal.commercialIntent = isCommercialQuery(signal.query);
  });
  return signals.sort((a, b) => b.confidence - a.confidence);
}

async function buildSearchDemandIntelligence(project, now = new Date()) {
  const currentStart = new Date(now); currentStart.setUTCDate(currentStart.getUTCDate() - 28);
  const previousStart = new Date(currentStart); previousStart.setUTCDate(previousStart.getUTCDate() - 28);
  const boundary = (date) => date.toISOString().slice(0, 10);
  const rows = await SearchMetric.find({ projectId: project._id, date: { $gte: boundary(previousStart), $lte: boundary(now) } }).lean();
  return detectSearchDemandShifts(
    rows.filter((row) => row.date >= boundary(currentStart)),
    rows.filter((row) => row.date < boundary(currentStart)),
    project.name
  );
}

module.exports = { aggregateQueries, buildSearchDemandIntelligence, detectSearchDemandShifts, isCommercialQuery, queryCluster };
