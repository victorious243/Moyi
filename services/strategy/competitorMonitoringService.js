const crypto = require('crypto');
const CompetitorPage = require('../../models/CompetitorPage');
const CompetitorSnapshot = require('../../models/CompetitorSnapshot');

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'your', 'from', 'that', 'this', 'our', 'you', 'are', 'into', 'how', 'what']);

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function textFor(page) {
  return [page.title, page.metaDescription, ...(page.h1 || []), ...(page.headings || [])].filter(Boolean).join(' ');
}

function pageRecord(page) {
  const text = textFor(page);
  return {
    url: page.url,
    title: page.title || '',
    metaDescription: page.metaDescription || '',
    h1: page.h1 || [],
    headings: page.headings || [],
    wordCount: Number(page.wordCount || 0),
    fingerprint: hash({ title: page.title, metaDescription: page.metaDescription, h1: page.h1, headings: page.headings, wordCount: page.wordCount }),
    signals: {
      pricing: /\b(pricing|price|plans?|subscription|per month|per year)\b/i.test(`${page.url} ${text}`),
      offer: /\b(offer|free trial|demo|discount|book a call|get started|guarantee)\b/i.test(text),
      campaign: /\b(campaign|webinar|event|launch|limited time|register now)\b/i.test(`${page.url} ${text}`)
    }
  };
}

function positioningTerms(pages) {
  const counts = new Map();
  pages.forEach((page) => textFor(page).toLowerCase().match(/[a-z][a-z0-9-]{2,}/g)?.forEach((term) => {
    if (!STOP_WORDS.has(term)) counts.set(term, (counts.get(term) || 0) + 1);
  }));
  return [...counts.entries()].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([term]) => term);
}

function detectCompetitorChanges(previous, currentPages) {
  if (!previous) return [];
  const oldMap = new Map((previous.pages || []).map((page) => [page.url, page]));
  const newMap = new Map(currentPages.map((page) => [page.url, page]));
  const changes = [];
  currentPages.forEach((page) => {
    const old = oldMap.get(page.url);
    if (!old) {
      changes.push({ type: page.signals.campaign ? 'new_campaign' : 'new_page', url: page.url, summary: `A new public page appeared: ${page.title || page.url}.`, after: page.title, confidence: 95 });
      return;
    }
    if (old.fingerprint === page.fingerprint) return;
    const before = [old.title, ...(old.h1 || [])].filter(Boolean).join(' | ');
    const after = [page.title, ...(page.h1 || [])].filter(Boolean).join(' | ');
    const type = (old.signals && old.signals.pricing) || page.signals.pricing
      ? 'pricing_change'
      : (old.signals && old.signals.offer) || page.signals.offer
        ? 'offer_change'
        : 'messaging_change';
    changes.push({ type, url: page.url, summary: `Public ${type.replace(/_/g, ' ')} detected on ${page.url}.`, before: before.slice(0, 500), after: after.slice(0, 500), confidence: 82 });
  });
  (previous.pages || []).forEach((page) => {
    if (!newMap.has(page.url)) changes.push({ type: 'removed_page', url: page.url, summary: `A previously observed public page was not found in the latest bounded crawl: ${page.url}.`, before: page.title, confidence: 60 });
  });
  const oldTerms = new Set((previous.summary && previous.summary.positioningTerms) || []);
  const newTerms = positioningTerms(currentPages);
  const introduced = newTerms.filter((term) => !oldTerms.has(term));
  if (introduced.length >= 3) changes.push({ type: 'positioning_change', summary: `New recurring positioning terms appeared: ${introduced.slice(0, 6).join(', ')}.`, after: introduced.join(', '), confidence: 70 });
  return changes;
}

async function captureCompetitorSnapshot({ projectId, competitorId, now = new Date() }) {
  const [pages, previous] = await Promise.all([
    CompetitorPage.find({ projectId, competitorId }).sort({ url: 1 }).lean(),
    CompetitorSnapshot.findOne({ projectId, competitorId }).sort({ capturedAt: -1 }).lean()
  ]);
  if (!pages.length) return null;
  const records = pages.map(pageRecord);
  const fingerprint = hash(records.map((page) => [page.url, page.fingerprint]));
  if (previous && previous.fingerprint === fingerprint) return previous;
  const terms = positioningTerms(records);
  return CompetitorSnapshot.create({
    projectId,
    competitorId,
    capturedAt: now,
    fingerprint,
    pages: records,
    summary: {
      pageCount: records.length,
      contentVelocity30d: pages.filter((page) => new Date(page.createdAt) >= new Date(now.getTime() - 30 * 86400000)).length,
      pricingPageCount: records.filter((page) => page.signals.pricing).length,
      offerPageCount: records.filter((page) => page.signals.offer).length,
      campaignPageCount: records.filter((page) => page.signals.campaign).length,
      positioningTerms: terms
    },
    changes: detectCompetitorChanges(previous, records),
    limitations: ['Only public pages permitted by robots.txt and reached by Moyi\'s bounded crawl are compared.', 'A removed-page signal may reflect crawl scope or temporary availability and is assigned lower confidence.']
  });
}

module.exports = { captureCompetitorSnapshot, detectCompetitorChanges, pageRecord, positioningTerms };
