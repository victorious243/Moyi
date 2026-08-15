const test = require('node:test');
const assert = require('node:assert/strict');

const {
  generateStrategicPositioning,
  analyzeLandingPageCro,
  optimizePricingPsychology,
  generateProgrammaticSeoMatrix,
  designPlgGrowthLoops,
  generateLifecycleEmailSequences,
  generateAbmOutboundCampaign,
  generateFullEliteCmoAudit
} = require('../services/eliteCmoSkillsService');

test('Skill 1: generateStrategicPositioning produces April Dunford positioning framework', async () => {
  const result = await generateStrategicPositioning({
    brandName: 'TestBrand',
    domain: 'testbrand.com',
    description: 'An AI-powered developer tool for automated code audits.',
    competitors: ['CompA', 'CompB']
  });

  assert.ok(result);
  assert.ok(Array.isArray(result.competitiveAlternatives));
  assert.ok(result.competitiveAlternatives.length >= 1);
  assert.ok(Array.isArray(result.differentiatedCapabilities));
  assert.ok(result.differentiatedCapabilities.length >= 1);
  assert.ok(Array.isArray(result.valueThemes));
  assert.ok(result.valueThemes[0].theme);
  assert.ok(result.idealCustomerProfile.whoTheyAre);
  assert.ok(result.marketFrameOfReference);
  assert.ok(result.positioningNarrative);
});

test('Skill 2: analyzeLandingPageCro evaluates MECLABS conversion heuristic', async () => {
  const result = await analyzeLandingPageCro({
    pageUrl: 'https://testbrand.com',
    headline: 'Build Faster with AI',
    subheadline: 'The easiest way to audit your code.',
    cta: 'Get Started'
  });

  assert.ok(result);
  assert.ok(typeof result.conversionScore === 'number');
  assert.ok(result.dimensionScores.motivation > 0);
  assert.ok(result.dimensionScores.valueProposition > 0);
  assert.ok(result.aboveTheFoldTeardown.recommendedHeadline);
  assert.ok(Array.isArray(result.frictionAudit));
  assert.ok(Array.isArray(result.trustAndRiskReversals));
});

test('Skill 3: optimizePricingPsychology delivers behavioral pricing and WTP recommendations', async () => {
  const result = await optimizePricingPsychology({
    pricingModel: 'subscription',
    plans: ['Starter', 'Pro', 'Enterprise'],
    targetAudience: 'Early-stage tech founders'
  });

  assert.ok(result);
  assert.ok(result.valueMetricRecommendation.recommendedMetric);
  assert.ok(Array.isArray(result.tierOptimization));
  assert.ok(result.tierOptimization.length >= 3);
  assert.ok(result.tierOptimization[0].psychologicalRole);
  assert.ok(result.conversionTriggers.annualDiscountFraming);
});

test('Skill 4: generateProgrammaticSeoMatrix creates multi-dimensional search matrices', async () => {
  const result = await generateProgrammaticSeoMatrix({
    domain: 'testbrand.com',
    category: 'Developer Tools',
    coreKeywords: ['code audit', 'security scan'],
    competitors: ['Snyk', 'SonarQube']
  });

  assert.ok(result);
  assert.ok(Array.isArray(result.targetMatrices));
  assert.ok(result.targetMatrices.length >= 1);
  assert.ok(result.targetMatrices[0].urlPattern);
  assert.ok(Array.isArray(result.targetMatrices[0].samplePages));
  assert.ok(result.sharedDataTemplate.h2Outline.length >= 3);
});

test('Skill 5: designPlgGrowthLoops outputs Reforge-style viral and collaborative growth loops', async () => {
  const result = await designPlgGrowthLoops({
    productType: 'B2B SaaS',
    coreValueMetric: 'Scans Run',
    userJourney: 'Signup -> Run Scan -> Share Report'
  });

  assert.ok(result);
  assert.ok(Array.isArray(result.growthLoops));
  assert.ok(result.growthLoops.length >= 3);
  assert.ok(result.growthLoops[0].step1_UserAction);
  assert.ok(result.growthLoops[0].step4_NewUserAcquisition);
  assert.ok(result.timeToAhaMoment.recommendedFastTrack);
});

test('Skill 6: generateLifecycleEmailSequences creates 5-stage retention and win-back emails', async () => {
  const result = await generateLifecycleEmailSequences({
    brandName: 'TestBrand',
    productCategory: 'Developer Security',
    targetPersona: 'Engineering Leads'
  });

  assert.ok(result);
  assert.ok(Array.isArray(result.lifecycleSequences));
  assert.ok(result.lifecycleSequences.length >= 3);
  assert.ok(result.lifecycleSequences[0].emails.length >= 1);
  assert.ok(result.lifecycleSequences[0].emails[0].subjectLine);
  assert.ok(result.lifecycleSequences[0].emails[0].bodyCopy);
});

test('Skill 7: generateAbmOutboundCampaign crafts 1-to-1 enterprise multi-touch campaigns', async () => {
  const result = await generateAbmOutboundCampaign({
    targetCompany: 'Enterprise Corp',
    targetRole: 'Chief Information Security Officer',
    valueProposition: 'Automated Code Audit Suite'
  });

  assert.ok(result);
  assert.ok(result.targetAccountDossier.companyName === 'Enterprise Corp');
  assert.ok(Array.isArray(result.targetAccountDossier.strategicPriorities));
  assert.ok(Array.isArray(result.outboundCadence));
  assert.ok(result.outboundCadence.length >= 1);
  assert.ok(result.outboundCadence[0].channel);
  assert.ok(result.outboundCadence[0].messageBody);
});

test('Skill 8: generateFullEliteCmoAudit generates cohesive master executive audit', async () => {
  const masterAudit = await generateFullEliteCmoAudit({
    brandName: 'Moyi-CMO',
    domain: 'moyi-cmo.com',
    description: 'Evidence-grounded AI CMO',
    competitors: ['Ahrefs', 'Hootsuite']
  });

  assert.ok(masterAudit);
  assert.equal(masterAudit.brandName, 'Moyi-CMO');
  assert.ok(masterAudit.positioning.marketFrameOfReference);
  assert.ok(masterAudit.cro.conversionScore > 0);
  assert.ok(masterAudit.pricing.tierOptimization.length >= 3);
  assert.ok(masterAudit.pseo.targetMatrices.length >= 1);
  assert.ok(masterAudit.plg.growthLoops.length >= 3);
  assert.ok(masterAudit.lifecycle.lifecycleSequences.length >= 3);
});
