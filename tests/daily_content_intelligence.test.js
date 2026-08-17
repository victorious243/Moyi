const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isTopicEligibleForMoyi,
  checkExistingContentCoverage,
  scoreOpportunity,
  runDailyOpportunityDiscovery,
  buildCompleteArticlePackage,
  executeDailyContentIntelligenceRun
} = require('../services/dailyContentIntelligenceService');

test('Daily Content Intelligence: Section 3 Relevance Filter', async (t) => {
  await t.test('rejects off-topic trending queries (crypto, celebrity, sports, gaming)', () => {
    const cryptoCheck = isTopicEligibleForMoyi('Bitcoin ETF Surges to New Highs', 'crypto price predictions');
    assert.equal(cryptoCheck.eligible, false);

    const celebrityCheck = isTopicEligibleForMoyi('Hollywood Actor Signs Multi-Million Deal', 'celebrity news');
    assert.equal(celebrityCheck.eligible, false);

    const gamingCheck = isTopicEligibleForMoyi('Fortnite New Season Release Date', 'gaming update');
    assert.equal(gamingCheck.eligible, false);
  });

  await t.test('accepts relevant marketing and SEO problem topics', () => {
    const seoCheck = isTopicEligibleForMoyi('How to Fix Low-CTR Queries in Google Search Console', 'search console optimization');
    assert.equal(seoCheck.eligible, true);

    const auditCheck = isTopicEligibleForMoyi('Technical Website Audit Guide', 'detect crawl errors');
    assert.equal(auditCheck.eligible, true);
  });
});

test('Daily Content Intelligence: Section 5 Opportunity Scoring Formula', () => {
  const result = scoreOpportunity({
    relevance: 10,
    searchOpportunity: 9,
    businessIntent: 9,
    rankingOpportunity: 9,
    trendMomentum: 8,
    productFit: 10,
    originalityOpportunity: 9,
    competitionDifficulty: 4,
    existingCoverage: 2
  });

  // Positives: 10+9+9+9+8+10+9 = 64
  // Penalties: 4+2 = 6
  // Net: 64 - 6 = 58
  assert.equal(result.positives, 64);
  assert.equal(result.penalties, 6);
  assert.equal(result.netScore, 58);
});

test('Daily Content Intelligence: Section 6 Anti-Cannibalization Matrix', () => {
  const duplicateCheck = checkExistingContentCoverage('seo-growth-software', 'SEO growth software');
  assert.ok(['EXISTING BUT WEAK', 'STRONG EXISTING COVERAGE'].includes(duplicateCheck.status));

  const newTopicCheck = checkExistingContentCoverage('striking distance keywords google search console', 'Finding Striking Distance Queries');
  assert.equal(newTopicCheck.status, 'NEW');
});

test('Daily Content Intelligence: Section 11 & 14 Complete Article & SEO Package', () => {
  const mockCandidate = {
    id: 'striking-distance-gsc',
    topic: 'How to Find Striking-Distance Queries in Google Search Console (And Move to Page 1)',
    primaryQuery: 'striking distance keywords google search console',
    searchIntent: 'Commercial Investigation / Problem-Solving',
    cluster: 'Google Search Console & SEO Growth'
  };

  const pkg = buildCompleteArticlePackage(mockCandidate);

  // Validate SEO Package
  assert.ok(pkg.seoPackage.seoTitle.length >= 40 && pkg.seoPackage.seoTitle.length <= 60);
  assert.ok(pkg.seoPackage.metaDescription.length >= 120 && pkg.seoPackage.metaDescription.length <= 160);
  assert.equal(pkg.seoPackage.primaryKeyword, 'striking distance keywords google search console');
  assert.ok(pkg.seoPackage.secondaryKeywords.length >= 5);
  assert.ok(pkg.seoPackage.structuredDataRecommendation.includes('Article'));

  // Validate 11-Part Article Structure
  assert.ok(pkg.article.title);
  assert.ok(pkg.article.introduction);
  assert.ok(pkg.article.whatIsHappening);
  assert.ok(pkg.article.whyDoesItHappen);
  assert.ok(pkg.article.howToDiagnose);
  assert.equal(pkg.article.howToSolve.length, 4);
  assert.ok(pkg.article.example.findings);
  assert.ok(pkg.article.commonMistakes.length >= 3);
  assert.ok(pkg.article.howMoyiCanHelp.includes('Moyi proposes. Humans decide.'));
  assert.ok(pkg.article.faqs.length >= 3);
  assert.ok(pkg.article.conclusion);

  // Validate Two-Way Internal Links
  assert.ok(pkg.internalLinking.outbound.length >= 3);
  assert.ok(pkg.internalLinking.inbound.length >= 2);

  // Validate 5-Asset Social Distribution Suite
  assert.ok(pkg.socialDistribution.linkedIn);
  assert.ok(pkg.socialDistribution.x);
  assert.ok(pkg.socialDistribution.facebook);
  assert.ok(pkg.socialDistribution.shortFormVideo.hook);
  assert.ok(pkg.socialDistribution.visualConcept.description);

  // Validate Repurposing & 12-Point Quality Gate
  assert.equal(pkg.repurposedFormats.length, 3);
  assert.equal(pkg.qualityControlAudit.auditPassed, true);
  assert.equal(pkg.governanceGate.requiresHumanSignoff, true);
  assert.equal(pkg.governanceGate.autoPublishAllowed, false);
});

test('Daily Content Intelligence: Discovery Execution', async () => {
  const discovery = await runDailyOpportunityDiscovery();
  assert.equal(discovery.meetsThreshold, true);
  assert.ok(discovery.allCandidates.length >= 5);
  assert.equal(discovery.winningCandidate.id, 'striking-distance-gsc');
  assert.ok(discovery.winningCandidate.scoring.netScore >= 40);
});
