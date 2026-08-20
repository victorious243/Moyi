const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ejs = require('ejs');

test('Intello Daily Public Landing Page Template & Content Verification', async (t) => {
  const html = await ejs.renderFile(
    path.join(__dirname, '../views/public/intello-daily.ejs'),
    {
      appName: 'Moyi-CMO',
      title: 'Intello Daily — Autonomous Daily Content Intelligence | Moyi-CMO',
      seoDescription: 'Autonomous Daily Content Intelligence engine delivering ready-to-publish social drafts, Swiss-grid carousels, 3D device mockups, and performance ads.',
      currentUser: null
    }
  );

  await t.test('renders headline, value proposition, and morning delivery promise', () => {
    assert.match(html, /Meet Intello Daily/);
    assert.match(html, /Never Stare at a Blank Screen Again/);
    assert.match(html, /Every morning at 7:00 AM/);
  });

  await t.test('renders the 5-stage autonomous morning routine timeline', () => {
    assert.match(html, /The Autonomous 7:00 AM Morning Routine/);
    assert.match(html, /05:00 AM &bull; Step 1/);
    assert.match(html, /Data & Query Mining/);
    assert.match(html, /Direct-Response Copy/);
    assert.match(html, /Swiss-Grid Visuals/);
    assert.match(html, /Morning Delivery/);
    assert.match(html, /1-Click Publishing/);
  });

  await t.test('renders all 6 specialized graphic design studio skill panes', () => {
    assert.match(html, /Human Editorial Posters/);
    assert.match(html, /Multi-Slide B2B Carousel Decks/);
    assert.match(html, /3D Glassmorphic Device Mockups/);
    assert.match(html, /Data-Dense Infographics & Matrices/);
    assert.match(html, /Direct-Response Performance Ad Creatives/);
    assert.match(html, /Corporate Marketing Flyers/);
  });

  await t.test('renders multi-platform native distribution channels', () => {
    assert.match(html, /LinkedIn/);
    assert.match(html, /𝕏 \/ Twitter/);
    assert.match(html, /Instagram/);
    assert.match(html, /Facebook & Meta/);
    assert.match(html, /Threads & Bluesky/);
    assert.match(html, /TikTok & YouTube/);
  });

  await t.test('renders human-in-the-loop governance rule and anti-hallucination guardrails', () => {
    assert.match(html, /"Moyi Proposes\. Humans Decide\."/);
    assert.match(html, /Zero AI Clichés/);
    assert.match(html, /Evidence-Backed Proof/);
    assert.match(html, /Full Multi-Tenant Isolation/);
  });

  await t.test('renders FAQ accordion and valid JSON-LD software application schema', () => {
    assert.match(html, /Frequently Asked Questions/);
    assert.match(html, /How does Intello Daily know what content to generate/);
    assert.match(html, /@context": "https:\/\/schema\.org/);
    assert.match(html, /@type": "SoftwareApplication/);
  });
});
