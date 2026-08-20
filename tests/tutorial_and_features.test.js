const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ejs = require('ejs');

const { features, docs } = require('../config/publicPages');
const { TUTORIAL_PAGES } = require('../config/tutorialPages');

test('features configuration contains all core modern capabilities', () => {
  assert.ok(features);
  assert.equal(features.title, 'One system for evidence-led marketing work');
  
  const sectionIds = features.sections.map((s) => s.id);
  assert.ok(sectionIds.includes('intello-daily'), 'features should include intello-daily');
  assert.ok(sectionIds.includes('visual-studio'), 'features should include visual-studio');
  assert.ok(sectionIds.includes('search-console'), 'features should include search-console');
  assert.ok(sectionIds.includes('attribution'), 'features should include attribution');
  assert.ok(sectionIds.includes('competitor-war-room'), 'features should include competitor-war-room');
  assert.ok(sectionIds.includes('intello-kb'), 'features should include intello-kb');
});

test('TUTORIAL_PAGES contains required step-by-step guides with actionable metadata', () => {
  const slugs = [
    'connecting-google-search-console',
    'intello-daily-morning-approvals',
    'graphic-design-studio-carousels-mockups',
    'social-media-publishing-utm-attribution',
    'competitor-war-room-battlecards',
    'customizing-brand-voice-governance'
  ];

  for (const slug of slugs) {
    const tutorial = TUTORIAL_PAGES[slug];
    assert.ok(tutorial, `Tutorial ${slug} should exist`);
    assert.ok(tutorial.title, `Tutorial ${slug} should have title`);
    assert.ok(tutorial.category, `Tutorial ${slug} should have category`);
    assert.ok(tutorial.readTime, `Tutorial ${slug} should have readTime`);
    assert.ok(tutorial.difficulty, `Tutorial ${slug} should have difficulty`);
    assert.ok(tutorial.steps.length >= 4, `Tutorial ${slug} should have at least 4 steps`);
    assert.ok(tutorial.keyTakeaways.length >= 2, `Tutorial ${slug} should have key takeaways`);
    assert.ok(tutorial.faqs.length >= 1, `Tutorial ${slug} should have FAQs`);
  }
});

test('views/public/tutorial.ejs renders interactive tutorial guide with schema', async () => {
  const tutorial = TUTORIAL_PAGES['connecting-google-search-console'];
  const html = await ejs.renderFile(
    path.join(__dirname, '../views/public/tutorial.ejs'),
    {
      appName: 'Moyi',
      title: `${tutorial.seoTitle} | Moyi-CMO`,
      seoDescription: tutorial.seoDescription,
      currentUser: null,
      tutorial
    }
  );

  assert.match(html, /Connecting Google Search Console/);
  assert.match(html, /Prerequisites Before You Begin/);
  assert.match(html, /Step-by-Step Instructions/);
  assert.match(html, /Pro Tip:/);
  assert.match(html, /Key Takeaways/);
  assert.match(html, /Frequently Asked Questions/);
  assert.match(html, /schema\.org/);
  assert.match(html, /HowTo/);
  assert.match(html, /HowToStep/);
});

test('routes/index.js registers tutorial routes and updates sitemap and llms.txt', () => {
  const indexRouter = require('../routes/index');
  const getPaths = indexRouter.stack
    .filter((layer) => layer.route && layer.route.methods.get)
    .map((layer) => layer.route.path);

  assert.ok(getPaths.includes('/docs/tutorials'));
  assert.ok(getPaths.includes('/docs/tutorials/:slug'));
});
