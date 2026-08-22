const StrategicMetricSnapshot = require('../../models/StrategicMetricSnapshot');
const TrackingEvent = require('../../models/TrackingEvent');
const SearchMetric = require('../../models/SearchMetric');
const PaidMetricSnapshot = require('../../models/PaidMetricSnapshot');

function day(value) {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function dateKey(value) {
  return day(value).toISOString().slice(0, 10);
}

function snapshot({ projectId, date, metric, source, value, numerator = null, denominator = null, unit = '', sampleSize = 0, caveats = [] }) {
  return {
    projectId,
    date: day(date),
    metric,
    source,
    value: Number(value || 0),
    numerator,
    denominator,
    unit,
    dimensionsKey: 'all',
    quality: {
      sampleSize,
      completeness: sampleSize ? 100 : 0,
      confidence: sampleSize >= 30 ? 90 : sampleSize >= 7 ? 70 : sampleSize ? 45 : 0,
      caveats
    }
  };
}

function trackingSnapshots(projectId, events = []) {
  const days = new Map();
  events.forEach((event) => {
    const key = dateKey(event.createdAt);
    if (!days.has(key)) days.set(key, { sessions: new Set(), leads: new Set(), qualified: new Set(), signups: new Set(), conversions: new Set(), revenue: 0 });
    const item = days.get(key);
    item.sessions.add(event.sessionId);
    if (event.funnelStage === 'lead') item.leads.add(event.sessionId);
    if (event.funnelStage === 'qualified_lead') item.qualified.add(event.sessionId);
    if (event.funnelStage === 'signup') item.signups.add(event.sessionId);
    if (event.eventType === 'conversion' || ['purchase', 'revenue'].includes(event.funnelStage)) item.conversions.add(event.sessionId);
    if (event.funnelStage === 'revenue') item.revenue += Number(event.eventValue || 0);
  });
  return [...days.entries()].flatMap(([date, item]) => {
    const sessions = item.sessions.size;
    const conversions = item.conversions.size;
    return [
      snapshot({ projectId, date, metric: 'traffic', source: 'tracking', value: sessions, sampleSize: sessions }),
      snapshot({ projectId, date, metric: 'leads', source: 'tracking', value: item.leads.size, sampleSize: sessions }),
      snapshot({ projectId, date, metric: 'qualified_leads', source: 'tracking', value: item.qualified.size, sampleSize: sessions }),
      snapshot({ projectId, date, metric: 'signups', source: 'tracking', value: item.signups.size, sampleSize: sessions }),
      snapshot({ projectId, date, metric: 'conversions', source: 'tracking', value: conversions, sampleSize: sessions }),
      snapshot({ projectId, date, metric: 'conversion_rate', source: 'tracking', value: sessions ? conversions / sessions : 0, numerator: conversions, denominator: sessions, unit: '%', sampleSize: sessions }),
      snapshot({ projectId, date, metric: 'revenue', source: 'tracking', value: item.revenue, unit: 'currency', sampleSize: conversions, caveats: ['Includes only revenue events received by moyi-tracker.js.'] })
    ];
  });
}

function searchSnapshots(projectId, rows = []) {
  const days = new Map();
  rows.forEach((row) => {
    const item = days.get(row.date) || { clicks: 0, impressions: 0 };
    item.clicks += Number(row.clicks || 0);
    item.impressions += Number(row.impressions || 0);
    days.set(row.date, item);
  });
  return [...days.entries()].flatMap(([date, item]) => [
    snapshot({ projectId, date, metric: 'organic_traffic', source: 'search_console', value: item.clicks, sampleSize: item.impressions }),
    snapshot({ projectId, date, metric: 'search_clicks', source: 'search_console', value: item.clicks, sampleSize: item.impressions }),
    snapshot({ projectId, date, metric: 'search_impressions', source: 'search_console', value: item.impressions, sampleSize: item.impressions, caveats: ['Search Console impressions reflect search visibility and demand together; query-level analysis separates ranking effects.'] })
  ]);
}

function paidSnapshots(projectId, rows = []) {
  const days = new Map();
  rows.forEach((row) => {
    const key = dateKey(row.date);
    const item = days.get(key) || { spend: 0, traffic: 0, leads: 0, qualified: 0, conversions: 0, revenue: 0 };
    const metrics = row.metrics || {};
    item.spend += Number(metrics.spend || 0);
    item.traffic += Number(metrics.websiteSessions || metrics.clicks || 0);
    item.leads += Number(metrics.leads || 0);
    item.qualified += Number(metrics.qualifiedLeads || 0);
    item.conversions += Number(metrics.conversions || 0);
    item.revenue += Number(metrics.attributedRevenue || metrics.conversionValue || 0);
    days.set(key, item);
  });
  return [...days.entries()].flatMap(([date, item]) => {
    const acquisitionCount = item.qualified || item.leads;
    const records = [
      snapshot({ projectId, date, metric: 'spend', source: 'paid_ads', value: item.spend, unit: 'currency', sampleSize: rows.length }),
      snapshot({ projectId, date, metric: 'paid_traffic', source: 'paid_ads', value: item.traffic, sampleSize: item.traffic }),
      snapshot({ projectId, date, metric: 'leads', source: 'paid_ads', value: item.leads, sampleSize: item.traffic }),
      snapshot({ projectId, date, metric: 'qualified_leads', source: 'paid_ads', value: item.qualified, sampleSize: item.traffic }),
      snapshot({ projectId, date, metric: 'conversions', source: 'paid_ads', value: item.conversions, sampleSize: item.traffic }),
      snapshot({ projectId, date, metric: 'revenue', source: 'paid_ads', value: item.revenue, unit: 'currency', sampleSize: item.conversions })
    ];
    if (acquisitionCount) records.push(snapshot({ projectId, date, metric: 'cac', source: 'paid_ads', value: item.spend / acquisitionCount, unit: 'currency', sampleSize: acquisitionCount, caveats: item.qualified ? [] : ['CAC uses attributed leads because no qualified-lead events were available.'] }));
    if (item.conversions) records.push(snapshot({ projectId, date, metric: 'cpa', source: 'paid_ads', value: item.spend / item.conversions, unit: 'currency', sampleSize: item.conversions }));
    if (item.spend) records.push(snapshot({ projectId, date, metric: 'roas', source: 'paid_ads', value: item.revenue / item.spend, unit: 'ratio', sampleSize: item.conversions }));
    return records;
  });
}

async function syncStrategicMetricSnapshots(projectId, days = 90, now = new Date()) {
  const start = day(now);
  start.setUTCDate(start.getUTCDate() - Math.max(7, days - 1));
  const [events, searchRows, paidRows] = await Promise.all([
    TrackingEvent.find({ projectId, createdAt: { $gte: start, $lte: now } }).lean(),
    SearchMetric.find({ projectId, date: { $gte: dateKey(start), $lte: dateKey(now) } }).lean(),
    PaidMetricSnapshot.find({ projectId, level: 'campaign', date: { $gte: start, $lte: now } }).lean()
  ]);
  const records = [
    ...trackingSnapshots(projectId, events),
    ...searchSnapshots(projectId, searchRows),
    ...paidSnapshots(projectId, paidRows)
  ];
  if (records.length) {
    await StrategicMetricSnapshot.bulkWrite(records.map((record) => ({
      updateOne: {
        filter: { projectId: record.projectId, date: record.date, metric: record.metric, source: record.source, dimensionsKey: record.dimensionsKey },
        update: { $set: record },
        upsert: true
      }
    })), { ordered: false });
  }
  return { records: records.length, sources: { tracking: events.length, searchConsole: searchRows.length, paidCampaignRows: paidRows.length } };
}

module.exports = { dateKey, paidSnapshots, searchSnapshots, snapshot, syncStrategicMetricSnapshots, trackingSnapshots };
