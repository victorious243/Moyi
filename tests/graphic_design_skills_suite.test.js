const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveBrandDesignTokens,
  buildEnterpriseVisualPrompt,
  generateCarouselDeckPlan,
  generateInfographicBlueprint,
  generate3dMockupBlueprint,
  generatePerformanceAdBlueprint,
  GRAPHIC_DESIGN_SKILLS,
  AESTHETIC_PRESETS
} = require('../services/graphicDesignStudioService');

const {
  detectVisualFormat,
  imagePrompt,
  resolveImageOutputProfile
} = require('../services/contentImageService');

test('Graphic Design Skills Suite: Blueprints & Design Tokens', async (t) => {
  const mockProject = {
    name: 'Moyi-CMO',
    websiteUrl: 'https://moyi-cmo.com',
    industry: 'SaaS Marketing',
    brandTone: 'Authoritative, technical, precise'
  };

  const mockDraft = {
    title: 'Autonomous Digital CMO vs Agency Retainers',
    type: 'social_post',
    channel: 'linkedin',
    body: 'Why modern founders replace €5k/mo agency retainers with automated growth intelligence.'
  };

  await t.test('GRAPHIC_DESIGN_SKILLS catalog lists all 6 enterprise design disciplines', () => {
    assert.equal(GRAPHIC_DESIGN_SKILLS.length, 6);
    const skillIds = GRAPHIC_DESIGN_SKILLS.map((s) => s.id);
    assert.ok(skillIds.includes('human-editorial-poster'));
    assert.ok(skillIds.includes('corporate-flyer'));
    assert.ok(skillIds.includes('b2b-carousel-slide'));
    assert.ok(skillIds.includes('3d-device-mockup'));
    assert.ok(skillIds.includes('data-infographic'));
    assert.ok(skillIds.includes('performance-ad-creative'));
  });

  await t.test('generateCarouselDeckPlan produces structured multi-slide progressive narrative', () => {
    const deck = generateCarouselDeckPlan({ project: mockProject, draft: mockDraft, slideCount: 5 });
    assert.equal(deck.totalSlides, 5);
    assert.equal(deck.slides.length, 5);
    assert.equal(deck.slides[0].role, 'Hook & Title Slide');
    assert.match(deck.slides[0].cta, /Swipe Next/);
    assert.equal(deck.slides[4].role, 'Executive Summary & CTA Slide');
  });

  await t.test('generateInfographicBlueprint generates 12-column Swiss matrix with metric badges', () => {
    const blueprint = generateInfographicBlueprint({ project: mockProject, draft: mockDraft });
    assert.equal(blueprint.gridAlignment, '12-Column Swiss Modular Grid');
    assert.ok(blueprint.primaryMetrics.length >= 3);
    assert.match(blueprint.visualHierarchy.dominantHeader, /Autonomous Digital CMO/);
  });

  await t.test('generate3dMockupBlueprint generates 15-degree isometric dark-mode studio parameters', () => {
    const mockup = generate3dMockupBlueprint({ project: mockProject, draft: mockDraft, deviceType: 'macbook-glass' });
    assert.equal(mockup.deviceType, 'macbook-glass');
    assert.match(mockup.cameraPerspective, /15-degree isometric tilt/);
    assert.match(mockup.ambientLighting, /Dark-mode studio setup/);
  });

  await t.test('generatePerformanceAdBlueprint generates high-converting direct-response layout', () => {
    const ad = generatePerformanceAdBlueprint({ project: mockProject, draft: mockDraft, adStyle: 'split-before-after' });
    assert.equal(ad.adStyle, 'split-before-after');
    assert.match(ad.layoutStructure, /50\/50 Horizontal Split Screen/);
    assert.ok(ad.visualHooks.length >= 3);
    assert.ok(ad.targetPlatforms.includes('facebook'));
    assert.ok(ad.targetPlatforms.includes('instagram'));
  });
});

test('Graphic Design Skills Suite: Prompt Synthesis & Format Detection', async (t) => {
  const mockProject = {
    name: 'Moyi',
    websiteUrl: 'https://moyi-cmo.com',
    industry: 'Marketing Software'
  };

  const mockDraft = {
    title: 'Top 5 SEO Bottlenecks',
    channel: 'linkedin'
  };

  await t.test('detectVisualFormat respects explicit requestedFormat override', () => {
    assert.equal(detectVisualFormat({ requestedFormat: 'b2b-carousel-slide' }), 'b2b-carousel-slide');
    assert.equal(detectVisualFormat({ requestedFormat: '3d-device-mockup' }), '3d-device-mockup');
    assert.equal(detectVisualFormat({ requestedFormat: 'data-infographic' }), 'data-infographic');
    assert.equal(detectVisualFormat({ requestedFormat: 'performance-ad-creative' }), 'performance-ad-creative');
    assert.equal(detectVisualFormat({ requestedFormat: 'corporate-flyer' }), 'corporate-flyer');
    assert.equal(detectVisualFormat({ requestedFormat: 'human-editorial-poster' }), 'human-editorial-poster');
    assert.equal(detectVisualFormat({ guidance: 'make a poster with human vibe and natural light' }), 'human-editorial-poster');
    assert.equal(detectVisualFormat({ guidance: 'make a poster for this launch' }), 'human-editorial-poster');
  });

  await t.test('imagePrompt incorporates Swiss grid, C.R.A.P. principles, and color material rules', () => {
    const prompt = imagePrompt({
      project: mockProject,
      draft: mockDraft,
      visualFormat: 'performance-ad-creative',
      aestheticTheme: 'fintech-glass',
      guidance: 'Create a high-converting ad with Before vs After comparison.'
    });

    assert.match(prompt, /SWISS TYPOGRAPHIC GRID & COMPOSITION RULES/);
    assert.match(prompt, /12-Column Grid Alignment/);
    assert.match(prompt, /C\.R\.A\.P\. DESIGN & ACCESSIBILITY PRINCIPLES/);
    assert.match(prompt, /COLOR & MATERIAL DIRECTION/);
    assert.match(prompt, /DIRECT-RESPONSE PERFORMANCE AD CREATIVE SPECIFICATION/);
    assert.match(prompt, /Before-vs-After split-screen/);
  });

  await t.test('resolveImageOutputProfile enforces PNG output for all graphic design skills', () => {
    const formats = ['human-editorial-poster', 'corporate-flyer', 'b2b-carousel-slide', '3d-device-mockup', 'data-infographic', 'performance-ad-creative'];
    for (const fmt of formats) {
      const profile = resolveImageOutputProfile({ draft: mockDraft, visualFormat: fmt });
      assert.equal(profile.outputFormat, 'png');
      assert.equal(profile.outputCompression, null);
    }
  });
});
