const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveBrandDesignTokens,
  buildEnterpriseVisualPrompt,
  generateCarouselDeckPlan,
  generateInfographicBlueprint,
  generate3dMockupBlueprint,
  AESTHETIC_PRESETS
} = require('../services/graphicDesignStudioService');

test('resolveBrandDesignTokens selects appropriate enterprise aesthetic preset based on industry and tone', () => {
  // 1. Fintech / Security
  const fintechTokens = resolveBrandDesignTokens({
    project: { industry: 'Cybersecurity & Cloud Infrastructure', brandTone: 'Technical and authoritative' }
  });
  assert.equal(fintechTokens.aestheticTheme, 'fintech-glass');
  assert.ok(fintechTokens.colorDistribution.includes('60%'));

  // 2. Editorial / Consulting
  const editorialTokens = resolveBrandDesignTokens({
    project: { industry: 'Management Consulting & Legal', brandTone: 'Scholarly' }
  });
  assert.equal(editorialTokens.aestheticTheme, 'warm-editorial');

  // 3. E-Commerce / D2C
  const commerceTokens = resolveBrandDesignTokens({
    project: { industry: 'E-Commerce Direct to Consumer', brandTone: 'Bold and energetic' }
  });
  assert.equal(commerceTokens.aestheticTheme, 'clean-commerce');

  const fashionTokens = resolveBrandDesignTokens({
    project: { industry: 'Fashion apparel and beauty', brandTone: 'Premium and human' }
  });
  assert.equal(fashionTokens.aestheticTheme, 'luxury-fashion');

  // 4. Default SaaS now starts with a human editorial look unless the user asks for a stricter technical style.
  const saasTokens = resolveBrandDesignTokens({
    project: { industry: 'B2B Software', brandTone: 'Professional' }
  });
  assert.equal(saasTokens.aestheticTheme, 'documentary-human');
});

test('buildEnterpriseVisualPrompt enforces Swiss 12-column grid, C.R.A.P. principles, and 30% whitespace', () => {
  const prompt = buildEnterpriseVisualPrompt({
    project: { name: 'Acme SaaS', websiteUrl: 'https://acme.com' },
    draft: { title: 'Scale Your Organic Traffic', channel: 'linkedin' },
    visualFormat: 'corporate-flyer',
    aestheticTheme: 'minimalist-saas',
    outputProfile: { width: 1200, height: 1200, orientation: 'square', channel: 'linkedin' }
  });

  assert.ok(prompt.includes('12-Column Grid Alignment'));
  assert.ok(prompt.includes('C.R.A.P. DESIGN'));
  assert.ok(prompt.includes('30% Negative Space'));
  assert.ok(prompt.includes('4.5:1'));
  assert.ok(prompt.includes('1200 by 1200'));
});

test('buildEnterpriseVisualPrompt supports human editorial posters and blocks obvious AI patterns', () => {
  const prompt = buildEnterpriseVisualPrompt({
    project: { name: 'VicPods', websiteUrl: 'https://vicpods.com' },
    draft: { title: 'Start Your Podcast Journey', channel: 'instagram' },
    visualFormat: 'human-editorial-poster',
    aestheticTheme: 'documentary-human',
    outputProfile: { width: 1088, height: 1360, orientation: 'portrait', channel: 'instagram' }
  });

  assert.ok(prompt.includes('IMAGE-FIRST ART DIRECTION'));
  assert.ok(prompt.includes('believable human or real-world brand moment'));
  assert.ok(prompt.includes('Anti-AI visual ban'));
  assert.ok(prompt.includes('no neon orbs'));
  assert.ok(prompt.includes('HUMAN EDITORIAL POSTER SPECIFICATION'));
});

test('buildEnterpriseVisualPrompt supports fashion, ecommerce, minimal, UGC, and art campaign modes', () => {
  const fashion = buildEnterpriseVisualPrompt({
    visualFormat: 'fashion-editorial',
    aestheticTheme: 'luxury-fashion'
  });
  const commerce = buildEnterpriseVisualPrompt({
    visualFormat: 'ecommerce-product-scene',
    aestheticTheme: 'clean-commerce'
  });
  const minimal = buildEnterpriseVisualPrompt({
    visualFormat: 'minimal-product-visual',
    aestheticTheme: 'clean-commerce'
  });
  const ugc = buildEnterpriseVisualPrompt({
    visualFormat: 'ugc-lifestyle',
    aestheticTheme: 'documentary-human'
  });
  const art = buildEnterpriseVisualPrompt({
    visualFormat: 'art-direction-campaign',
    aestheticTheme: 'art-house'
  });

  assert.ok(fashion.includes('FASHION / BEAUTY EDITORIAL SPECIFICATION'));
  assert.ok(commerce.includes('ECOMMERCE PRODUCT SCENE SPECIFICATION'));
  assert.ok(minimal.includes('MINIMAL NO-TEXT PRODUCT VISUAL SPECIFICATION'));
  assert.ok(ugc.includes('UGC / LIFESTYLE SPECIFICATION'));
  assert.ok(art.includes('ART-DIRECTION CAMPAIGN SPECIFICATION'));
});

test('generateCarouselDeckPlan creates structured 5-to-7 slide narrative decks for LinkedIn & Instagram', () => {
  const deck = generateCarouselDeckPlan({
    project: { name: 'Moyi' },
    draft: { title: '3 Steps to Automate SEO', channel: 'linkedin' },
    slideCount: 5
  });

  assert.equal(deck.totalSlides, 5);
  assert.equal(deck.slides.length, 5);
  assert.equal(deck.slides[0].role, 'Hook & Title Slide');
  assert.equal(deck.slides[4].role, 'Executive Summary & CTA Slide');
  assert.ok(deck.slides[0].cta.includes('Swipe'));
});

test('generateInfographicBlueprint produces 12-column Swiss comparison and metric architecture', () => {
  const blueprint = generateInfographicBlueprint({
    project: { name: 'Moyi' },
    draft: { title: 'SEO Benchmark' },
    metrics: [
      { label: 'Rank Position', value: '#1', status: 'positive' }
    ]
  });

  assert.ok(blueprint.gridAlignment.includes('12-Column'));
  assert.equal(blueprint.primaryMetrics[0].value, '#1');
  assert.ok(blueprint.visualHierarchy.dominantHeader);
});

test('generate3dMockupBlueprint formats 3D glassmorphism isometric device layouts', () => {
  const mockup = generate3dMockupBlueprint({
    project: { name: 'Moyi' },
    draft: { title: 'Dashboard View' },
    deviceType: 'macbook-glass'
  });

  assert.equal(mockup.deviceType, 'macbook-glass');
  assert.ok(mockup.cameraPerspective.includes('isometric'));
  assert.ok(mockup.surfaceMaterial.includes('glass'));
});
