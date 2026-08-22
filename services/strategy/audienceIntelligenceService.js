const TrackingEvent = require('../../models/TrackingEvent');

function segmentSummary(events = [], knownVisitors = new Set()) {
  const sessions = new Map();
  events.forEach((event) => {
    const item = sessions.get(event.sessionId) || { source: event.utmSource || 'direct', country: event.country || 'unknown', visitorId: event.visitorId || '', pageViews: 0, converted: false };
    if (event.eventType === 'page_view') item.pageViews += 1;
    if (event.eventType === 'conversion') item.converted = true;
    sessions.set(event.sessionId, item);
  });
  const output = { totalSessions: sessions.size, conversions: 0, pageViews: 0, sources: {}, countries: {}, newVisitors: 0, returningVisitors: 0 };
  sessions.forEach((session) => {
    output.conversions += session.converted ? 1 : 0;
    output.pageViews += session.pageViews;
    output.sources[session.source] = (output.sources[session.source] || 0) + 1;
    output.countries[session.country] = (output.countries[session.country] || 0) + 1;
    if (session.visitorId && knownVisitors.has(session.visitorId)) output.returningVisitors += 1;
    else output.newVisitors += 1;
  });
  output.conversionRate = output.totalSessions ? output.conversions / output.totalSessions : 0;
  output.pagesPerSession = output.totalSessions ? output.pageViews / output.totalSessions : 0;
  return output;
}

function materialMixShifts(current = {}, previous = {}, dimension, minimumTotal = 30) {
  if (current.totalSessions < minimumTotal || previous.totalSessions < minimumTotal) return [];
  const keys = new Set([...Object.keys(current[dimension] || {}), ...Object.keys(previous[dimension] || {})]);
  return [...keys].map((key) => {
    const currentShare = (current[dimension][key] || 0) / current.totalSessions;
    const previousShare = (previous[dimension][key] || 0) / previous.totalSessions;
    return { key, currentShare, previousShare, changePoints: (currentShare - previousShare) * 100 };
  }).filter((item) => Math.abs(item.changePoints) >= 10).sort((a, b) => Math.abs(b.changePoints) - Math.abs(a.changePoints));
}

function detectAudienceShifts(current, previous) {
  const signals = [];
  materialMixShifts(current, previous, 'countries').forEach((item) => signals.push({ type: 'geography', segment: item.key, ...item, confidence: 75 }));
  materialMixShifts(current, previous, 'sources').forEach((item) => signals.push({ type: 'channel', segment: item.key, ...item, confidence: 78 }));
  if (current.totalSessions >= 30 && previous.totalSessions >= 30) {
    const conversionChange = current.conversionRate - previous.conversionRate;
    if (Math.abs(conversionChange) >= 0.02) signals.push({ type: 'conversion_behavior', segment: 'all visitors', currentRate: current.conversionRate, previousRate: previous.conversionRate, changePoints: conversionChange * 100, confidence: 80 });
    const returningCurrent = current.totalSessions ? current.returningVisitors / current.totalSessions : 0;
    const returningPrevious = previous.totalSessions ? previous.returningVisitors / previous.totalSessions : 0;
    if (Math.abs(returningCurrent - returningPrevious) >= 0.1) signals.push({ type: 'new_vs_returning', segment: 'returning visitors', currentShare: returningCurrent, previousShare: returningPrevious, changePoints: (returningCurrent - returningPrevious) * 100, confidence: 70 });
    const engagementChange = previous.pagesPerSession
      ? (current.pagesPerSession - previous.pagesPerSession) / previous.pagesPerSession
      : 0;
    if (previous.pagesPerSession && Math.abs(engagementChange) >= 0.2) {
      signals.push({
        type: 'engagement_quality',
        segment: 'pages per session',
        currentValue: current.pagesPerSession,
        previousValue: previous.pagesPerSession,
        changePercent: engagementChange * 100,
        changePoints: engagementChange * 100,
        confidence: 75
      });
    }
  }
  return signals;
}

async function buildAudienceIntelligence(projectId, now = new Date()) {
  const currentStart = new Date(now); currentStart.setUTCDate(currentStart.getUTCDate() - 28);
  const previousStart = new Date(currentStart); previousStart.setUTCDate(previousStart.getUTCDate() - 28);
  const historyStart = new Date(previousStart); historyStart.setUTCDate(historyStart.getUTCDate() - 180);
  const events = await TrackingEvent.find({ projectId, createdAt: { $gte: historyStart, $lte: now } }).lean();
  const knownBeforePrevious = new Set(events.filter((event) => event.createdAt < previousStart).map((event) => event.visitorId).filter(Boolean));
  const previousEvents = events.filter((event) => event.createdAt >= previousStart && event.createdAt < currentStart);
  const knownBeforeCurrent = new Set([...knownBeforePrevious, ...previousEvents.map((event) => event.visitorId).filter(Boolean)]);
  const current = segmentSummary(events.filter((event) => event.createdAt >= currentStart), knownBeforeCurrent);
  const previous = segmentSummary(previousEvents, knownBeforePrevious);
  return { current, previous, signals: detectAudienceShifts(current, previous), limitations: ['Geography is based on available first-party tracker country values.', 'Moyi does not infer age, gender, or other demographics that were not provided.'] };
}

module.exports = { buildAudienceIntelligence, detectAudienceShifts, materialMixShifts, segmentSummary };
