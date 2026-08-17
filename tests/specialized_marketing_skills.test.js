const test = require('node:test');
const assert = require('node:assert/strict');

const {
  generateCustomerAdvocacyAndCaseStudy,
  generateAlliancesCoMarketing,
  generateEventLifecycleCampaign,
  generateMarketingSprintAndQa,
  generateCroExperimentationPlan
} = require('../services/eliteCmoSkillsService');

test('Specialized Marketing Skills Suite (Customer, Alliances, Events, Project Management, CRO)', async (t) => {
  await t.test('generateCustomerAdvocacyAndCaseStudy produces high-converting case studies and review invites', async () => {
    const result = await generateCustomerAdvocacyAndCaseStudy({
      brandName: 'Moyi-CMO',
      customerName: 'FinTech Pulse',
      customerIndustry: 'B2B Payments',
      coreChallenge: 'Expensive agency retainers with zero visibility into SEO blockers',
      resultsAchieved: '4.2x organic search velocity and €60,000 saved annually',
      keyQuote: 'Moyi transformed our marketing from guesswork to autonomous execution.'
    });

    assert.ok(result.caseStudy);
    assert.ok(result.caseStudy.headline);
    assert.ok(result.caseStudy.quantifiedImpact.length >= 2);
    assert.ok(result.advocacyReviewCampaign.emailInviteSubject);
    assert.ok(result.customerExpansionNurture.upsellHook);
  });

  await t.test('generateAlliancesCoMarketing builds joint value propositions and partner battlecards', async () => {
    const result = await generateAlliancesCoMarketing({
      brandName: 'Moyi-CMO',
      partnerName: 'Webflow',
      partnerCategory: 'CMS & Visual Development',
      integrationHighlights: 'Direct 1-click blog drafting and publishing',
      sharedAudience: 'Growth Agencies and Webflow Creators'
    });

    assert.ok(result.jointValueProposition);
    assert.ok(result.jointValueProposition.headline);
    assert.ok(result.coBrandedWebinar.title);
    assert.ok(result.partnerSalesBattlecard.commonObjectionsAndResponses.length >= 1);
    assert.ok(result.jointAnnouncementPR.headline);
  });

  await t.test('generateEventLifecycleCampaign generates 4-phase event marketing campaigns', async () => {
    const result = await generateEventLifecycleCampaign({
      brandName: 'Moyi-CMO',
      eventName: 'AI Growth Summit 2026',
      eventDate: 'November 20, 2026',
      eventLocation: 'Berlin & Livestream',
      keySpeakers: ['Elena Rostova (Head of Growth)'],
      targetAudience: 'CMOs and Agency Owners'
    });

    assert.ok(result.phase1PreEventLaunch);
    assert.ok(result.phase1PreEventLaunch.socialTeaserPosts.length >= 1);
    assert.ok(result.phase2CountdownAndSpeakers.speakerSpotlightHooks.length >= 1);
    assert.ok(result.phase3LiveEventCoverage.realTimeQuoteTemplates.length >= 1);
    assert.ok(result.phase4PostEventRepurposing.onDemandRecordingPage.headline);
  });

  await t.test('generateMarketingSprintAndQa creates 14-day agile sprint plans and pre-flight QA checklists', async () => {
    const result = await generateMarketingSprintAndQa({
      brandName: 'Moyi-CMO',
      initiativeName: 'Q4 Pipeline Acceleration',
      acceptedPriorities: ['Fix canonical tags', 'Publish 4 comparison pages'],
      targetSprintDays: 14,
      teamCapacity: '1 Lead, 1 Copywriter'
    });

    assert.ok(result.sprintOverview);
    assert.ok(result.sprintOverview.sprintGoal);
    assert.ok(result.sprintWorkBreakdown.length >= 2);
    assert.ok(result.preFlightCampaignQaChecklist.length >= 3);
    assert.ok(result.riskAndBlockerMitigation.length >= 1);
  });

  await t.test('generateCroExperimentationPlan produces MECLABS heuristic analyses and A/B test variants', async () => {
    const result = await generateCroExperimentationPlan({
      brandName: 'Moyi-CMO',
      pageUrl: 'https://moyi-cmo.com/pricing',
      currentConversionRate: '2.8%',
      targetGoal: 'Boost Free Trial Conversions by 40%',
      observedFriction: 'Users hesitate over credit card requirement and setup complexity'
    });

    assert.ok(result.meclabsHeuristicAnalysis);
    assert.ok(result.experimentHypothesis.ifThenStatement);
    assert.ok(result.copyTestingVariants.length >= 2);
    assert.ok(result.microFrictionFixes.length >= 1);
  });
});
