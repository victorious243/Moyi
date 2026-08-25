const GrowthAlert = require('../../models/GrowthAlert');
const TrackingEvent = require('../../models/TrackingEvent');

const DAY_MS = 24 * 60 * 60 * 1000;

function uniqueSessions(events) {
  return new Set(events.map((event) => event.sessionId).filter(Boolean)).size;
}

function conversionSessions(events) {
  return new Set(events.filter((event) => event.eventType === 'conversion' || ['lead', 'qualified_lead', 'signup', 'purchase', 'revenue'].includes(event.funnelStage)).map((event) => event.sessionId)).size;
}

function rate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function croSignal(type, title, summary, evidence, recommendedAction, severity = 'warning') {
  return { type, title, summary, evidence, recommendedAction, severity };
}

function detectCroSignals(currentEvents, previousEvents = []) {
  const signals = [];
  const currentSessions = uniqueSessions(currentEvents);
  const currentConversions = conversionSessions(currentEvents);
  const previousSessions = uniqueSessions(previousEvents);
  const previousConversions = conversionSessions(previousEvents);
  const currentRate = rate(currentConversions, currentSessions);
  const previousRate = rate(previousConversions, previousSessions);

  if (currentSessions >= 100 && currentRate !== null && currentRate < 0.01) {
    signals.push(croSignal('funnel_leak_detected', 'High website traffic is not becoming conversions', `${currentSessions} measured sessions produced ${currentConversions} conversions.`, { currentSessions, currentConversions, currentRate }, 'Inspect message match, CTA visibility, form friction, and page speed before adding traffic.'));
  }
  if (currentSessions >= 100 && previousSessions >= 100 && previousRate > 0 && currentRate <= previousRate * 0.7) {
    signals.push(croSignal('website_conversion_drop', 'Website conversion rate dropped materially', `Conversion rate fell from ${(previousRate * 100).toFixed(2)}% to ${(currentRate * 100).toFixed(2)}%.`, { currentRate, previousRate, currentSessions, previousSessions }, 'Check tracking integrity first, then review recent traffic, offer, and page changes.', 'critical'));
  }

  const pageGroups = new Map();
  currentEvents.filter((event) => event.url).forEach((event) => {
    if (!pageGroups.has(event.url)) pageGroups.set(event.url, []);
    pageGroups.get(event.url).push(event);
  });
  pageGroups.forEach((events, url) => {
    const sessions = uniqueSessions(events);
    const conversions = conversionSessions(events);
    if (sessions >= 50 && rate(conversions, sessions) < 0.005) {
      signals.push(croSignal('landing_page_underperforming', 'A landing page has traffic but weak conversion', `${url} received ${sessions} measured sessions and ${conversions} conversions.`, { url, sessions, conversions }, 'Test the offer, proof, CTA, and form journey on this landing page.'));
    }
  });

  const formStarts = new Set(currentEvents.filter((event) => event.eventName === 'form_start').map((event) => event.sessionId));
  const formSubmits = new Set(currentEvents.filter((event) => event.eventName === 'form_submit').map((event) => event.sessionId));
  if (formStarts.size >= 30 && formSubmits.size / formStarts.size < 0.4) {
    signals.push(croSignal('form_abandonment_spike', 'Form abandonment is high', `${formStarts.size} sessions started a form and ${formSubmits.size} submitted it.`, { starts: formStarts.size, submits: formSubmits.size }, 'Review required fields, errors, mobile usability, privacy reassurance, and completion time.'));
  }

  const ctaViews = new Set(currentEvents.filter((event) => event.eventName === 'cta_view').map((event) => event.sessionId));
  const ctaClicks = new Set(currentEvents.filter((event) => event.eventName === 'cta_click').map((event) => event.sessionId));
  if (ctaViews.size >= 100 && ctaClicks.size / ctaViews.size < 0.01) {
    signals.push(croSignal('cta_underperformance', 'CTA response is below the evidence threshold', `${ctaViews.size} measured CTA views produced ${ctaClicks.size} clicks.`, { views: ctaViews.size, clicks: ctaClicks.size }, 'Test CTA clarity, relevance, placement, contrast, and commitment level.'));
  }

  const byDevice = (device) => currentEvents.filter((event) => event.deviceType === device);
  const mobile = byDevice('mobile');
  const desktop = byDevice('desktop');
  const mobileSessions = uniqueSessions(mobile);
  const desktopSessions = uniqueSessions(desktop);
  const mobileRate = rate(conversionSessions(mobile), mobileSessions);
  const desktopRate = rate(conversionSessions(desktop), desktopSessions);
  if (mobileSessions >= 50 && desktopSessions >= 50 && desktopRate > 0 && mobileRate <= desktopRate * 0.7) {
    signals.push(croSignal('funnel_leak_detected', 'Mobile visitors convert materially below desktop', `Mobile conversion is ${(mobileRate * 100).toFixed(2)}% versus ${(desktopRate * 100).toFixed(2)}% on desktop.`, { mobileSessions, desktopSessions, mobileRate, desktopRate }, 'Test mobile layout, speed, form ergonomics, payment flow, and CTA visibility.'));
  }

  const checkoutStarts = new Set(currentEvents.filter((event) => event.eventName === 'checkout_start').map((event) => event.sessionId));
  const purchases = new Set(currentEvents.filter((event) => ['purchase', 'revenue'].includes(event.funnelStage) || event.eventName === 'purchase').map((event) => event.sessionId));
  if (checkoutStarts.size >= 20 && purchases.size / checkoutStarts.size < 0.3) {
    signals.push(croSignal('funnel_leak_detected', 'Checkout drop-off needs attention', `${checkoutStarts.size} sessions started checkout and ${purchases.size} reached purchase.`, { checkoutStarts: checkoutStarts.size, purchases: purchases.size }, 'Inspect payment errors, unexpected costs, account requirements, trust signals, and mobile checkout friction.', 'critical'));
  }
  return signals;
}

async function evaluateProjectCro(projectId, now = new Date(), persist = true) {
  const currentStart = new Date(now.getTime() - (7 * DAY_MS));
  const previousStart = new Date(now.getTime() - (14 * DAY_MS));
  const [current, previous] = await Promise.all([
    TrackingEvent.find({ projectId, createdAt: { $gte: currentStart, $lte: now } }).lean(),
    TrackingEvent.find({ projectId, createdAt: { $gte: previousStart, $lt: currentStart } }).lean()
  ]);
  const signals = detectCroSignals(current, previous);
  if (persist) {
    for (const signal of signals) {
      const dedupeKey = `cro:${signal.type}:${now.toISOString().slice(0, 10)}`;
      await GrowthAlert.findOneAndUpdate(
        { projectId, dedupeKey },
        { $set: {
          type: signal.type,
          severity: signal.severity,
          category: 'experimentation',
          urgency: signal.severity === 'critical' ? 'high' : 'normal',
          confidence: 80,
          title: signal.title,
          summary: signal.summary,
          businessImpact: signal.summary,
          evidenceData: signal.evidence,
          recommendedAction: signal.recommendedAction,
          ctaUrl: `/projects/${projectId}/experiments`,
          ctaLabel: 'Review optimization signals',
          channels: ['in_app'],
          deliveryPolicy: 'in_app_only',
          deliveryStatus: 'sent',
          dedupeKey
        } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
      );
    }
  }
  return signals;
}

module.exports = { detectCroSignals, evaluateProjectCro };
