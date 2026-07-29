// AI-CMO SPEC COMPLIANCE: Subsystem C - closed-loop multi-touch attribution
// ties first-party touch events to actual payment revenue with confidence bands.
const TrackingEvent = require('../models/TrackingEvent');

function touchKey(touch) {
  return [touch.utmSource || 'direct', touch.utmMedium || 'none', touch.utmCampaign || 'uncategorized'].join(' / ');
}

function confidenceFor(payment, touches) {
  if (payment.utmSource || payment.utmCampaign || touches.some((touch) => touch.stripeCustomerId && touch.stripeCustomerId === payment.stripeCustomerId)) {
    return { score: 90, band: 'High', reason: 'Explicit UTM or Stripe customer match.' };
  }
  if (touches.some((touch) => touch.ipHash && touch.ipHash === payment.ipHash)) {
    return { score: 60, band: 'Medium', reason: 'Visit matched by IP/window.' };
  }
  return { score: 25, band: 'Low', reason: 'Modeled correlation only.' };
}

function addCredit(summary, model, key, amount) {
  summary[model][key] = (summary[model][key] || 0) + amount;
}

function attributePayment(payment, touches) {
  const ordered = touches.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const amount = Number(payment.amount || payment.amountPaid || 0);
  if (!ordered.length || amount <= 0) {
    return {
      paymentId: payment.id || payment.paymentId || '',
      amount,
      confidence: { score: 0, band: 'Low', reason: 'No matching touch history.' },
      credits: { firstTouch: {}, lastTouch: {}, linear: {}, wShaped: {} }
    };
  }

  const credits = { firstTouch: {}, lastTouch: {}, linear: {}, wShaped: {} };
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  addCredit(credits, 'firstTouch', touchKey(first), amount);
  addCredit(credits, 'lastTouch', touchKey(last), amount);
  ordered.forEach((touch) => addCredit(credits, 'linear', touchKey(touch), amount / ordered.length));

  if (ordered.length === 1) {
    addCredit(credits, 'wShaped', touchKey(first), amount);
  } else if (ordered.length === 2) {
    addCredit(credits, 'wShaped', touchKey(first), amount * 0.5);
    addCredit(credits, 'wShaped', touchKey(last), amount * 0.5);
  } else {
    const mid = ordered[Math.floor((ordered.length - 1) / 2)];
    addCredit(credits, 'wShaped', touchKey(first), amount * 0.3);
    addCredit(credits, 'wShaped', touchKey(mid), amount * 0.3);
    addCredit(credits, 'wShaped', touchKey(last), amount * 0.3);
    const remainder = amount * 0.1;
    ordered
      .filter((touch) => touch !== first && touch !== mid && touch !== last)
      .forEach((touch, _, others) => addCredit(credits, 'wShaped', touchKey(touch), remainder / others.length));
  }

  return {
    paymentId: payment.id || payment.paymentId || '',
    amount,
    confidence: confidenceFor(payment, ordered),
    credits
  };
}

function mergeCredits(results) {
  const totals = { firstTouch: {}, lastTouch: {}, linear: {}, wShaped: {} };
  results.forEach((result) => {
    Object.keys(totals).forEach((model) => {
      Object.entries(result.credits[model]).forEach(([key, value]) => addCredit(totals, model, key, value));
    });
  });
  return totals;
}

async function buildAttributionDashboard(projectId, payments = []) {
  const results = [];
  for (const payment of payments) {
    const query = {
      projectId,
      createdAt: { $lte: payment.createdAt || new Date() },
      $or: [
        { resolvedCustomerId: payment.customerId || payment.resolvedCustomerId || '' },
        { stripeCustomerId: payment.stripeCustomerId || '' },
        { resolvedEmail: payment.email || '' }
      ].filter((item) => Object.values(item)[0])
    };
    const touches = query.$or.length ? await TrackingEvent.find(query).sort({ createdAt: 1 }).limit(50).lean() : [];
    results.push(attributePayment(payment, touches));
  }

  const revenue = results.reduce((sum, result) => sum + result.amount, 0);
  const confidenceScore = results.length ? Math.round(results.reduce((sum, result) => sum + result.confidence.score, 0) / results.length) : 0;
  return {
    hasRevenueData: results.length > 0,
    revenue,
    conversions: results.length,
    confidenceScore,
    results,
    totals: mergeCredits(results)
  };
}

module.exports = {
  attributePayment,
  buildAttributionDashboard,
  mergeCredits,
  touchKey
};
