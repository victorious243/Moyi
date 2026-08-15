const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ejs = require('ejs');

const { COMPARISON_PAGES, SOLUTION_PAGES } = require('../config/programmaticPages');

test('COMPARISON_PAGES contains required high-intent comparison metadata', () => {
  assert.ok(COMPARISON_PAGES['moyi-vs-ahrefs']);
  assert.ok(COMPARISON_PAGES['moyi-vs-hootsuite']);

  const ahrefs = COMPARISON_PAGES['moyi-vs-ahrefs'];
  assert.equal(ahrefs.competitorName, 'Ahrefs');
  assert.ok(ahrefs.comparisonTable.length >= 5);
  assert.ok(ahrefs.keyDifferentiators.length >= 3);
  assert.ok(ahrefs.faqList.length >= 2);
});

test('SOLUTION_PAGES contains required industry and solution metadata', () => {
  assert.ok(SOLUTION_PAGES['ai-cmo-for-ecommerce']);
  assert.ok(SOLUTION_PAGES['ai-cmo-for-b2b-saas']);

  const ecom = SOLUTION_PAGES['ai-cmo-for-ecommerce'];
  assert.ok(ecom.title.includes('E-Commerce'));
  assert.ok(ecom.benefits.length >= 3);
  assert.ok(ecom.faqList.length >= 2);
});

test('compare.ejs template renders head-to-head comparison page with valid schema', async () => {
  const page = COMPARISON_PAGES['moyi-vs-ahrefs'];
  const html = await ejs.renderFile(
    path.join(__dirname, '../views/public/compare.ejs'),
    {
      appName: 'Moyi',
      title: page.title,
      currentUser: null,
      page
    }
  );

  assert.match(html, /Moyi vs Ahrefs/);
  assert.match(html, /Feature-by-Feature Matrix/);
  assert.match(html, /schema\.org/);
  assert.match(html, /Frequently Asked Questions/);
});

test('solution.ejs template renders industry solution page with valid schema', async () => {
  const page = SOLUTION_PAGES['ai-cmo-for-b2b-saas'];
  const html = await ejs.renderFile(
    path.join(__dirname, '../views/public/solution.ejs'),
    {
      appName: 'Moyi',
      title: page.title,
      currentUser: null,
      page
    }
  );

  assert.match(html, /Autonomous SEO Strategy/);
  assert.match(html, /Targeted Solutions/);
  assert.match(html, /schema\.org/);
  assert.match(html, /SoftwareApplication/);
});

test('routes/index.js registers /compare/:slug and /solutions/:slug and updates sitemap.xml', () => {
  const indexRouter = require('../routes/index');
  const getPaths = indexRouter.stack
    .filter((layer) => layer.route && layer.route.methods.get)
    .map((layer) => layer.route.path);

  assert.ok(getPaths.includes('/compare/:slug'));
  assert.ok(getPaths.includes('/solutions/:slug'));
  assert.ok(getPaths.includes('/sitemap.xml'));
});
