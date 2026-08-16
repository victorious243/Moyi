const { buildEnterpriseVisualPrompt, AESTHETIC_PRESETS } = require('../src/prompts/enterprise-graphic-design.prompt');

/**
 * Resolves 60-30-10 brand design tokens and aesthetic theme for a project.
 */
function resolveBrandDesignTokens({ project = {}, draft = {} } = {}) {
  const brandTone = String(project.brandTone || '').toLowerCase();
  const industry = String(project.industry || '').toLowerCase();

  let aestheticTheme = 'minimalist-saas';
  if (/\b(?:security|fintech|finance|crypto|devops|data|api)\b/.test(industry) || /\b(?:secure|technical|precise)\b/.test(brandTone)) {
    aestheticTheme = 'fintech-glass';
  } else if (/\b(?:consulting|legal|editorial|journalism|executive|healthcare)\b/.test(industry) || /\b(?:authoritative|scholarly|editorial)\b/.test(brandTone)) {
    aestheticTheme = 'warm-editorial';
  } else if (/\b(?:ecommerce|d2c|creator|growth|social|marketing)\b/.test(industry) || /\b(?:bold|energetic|punchy)\b/.test(brandTone)) {
    aestheticTheme = 'high-voltage-growth';
  }

  const preset = AESTHETIC_PRESETS[aestheticTheme] || AESTHETIC_PRESETS['minimalist-saas'];

  return {
    aestheticTheme,
    presetName: preset.name,
    colorDistribution: preset.colorRule,
    mood: preset.mood,
    styleDescriptor: preset.styleDescriptor
  };
}

/**
 * Generates a structured 5-to-7 slide narrative plan for LinkedIn / Instagram B2B Carousels.
 */
function generateCarouselDeckPlan({ project = {}, draft = {}, slideCount = 5 } = {}) {
  const count = Math.min(Math.max(slideCount, 3), 7);
  const title = draft.title || 'Mastering Organic Growth';
  const brandName = project.name || 'Moyi';

  const slides = [
    {
      slideNumber: 1,
      role: 'Hook & Title Slide',
      visualFocus: 'Bold high-contrast display typography with a compelling curiosity teaser.',
      headline: title,
      subheadline: `Swipe to discover the 3-step breakdown by ${brandName} &bull; 1 / ${count}`,
      cta: 'Swipe Next 👉'
    }
  ];

  for (let i = 2; i < count; i++) {
    slides.push({
      slideNumber: i,
      role: `Core Insight ${i - 1}`,
      visualFocus: 'Single clear takeaway with a supporting metric badge or clean 12-column card.',
      headline: `Step 0${i - 1}: Eliminate Bottlenecks in ${draft.channel || 'Marketing'}`,
      subheadline: `How leading brands scale execution without manual overhead.`,
      cta: `Slide ${i} of ${count}`
    });
  }

  slides.push({
    slideNumber: count,
    role: 'Executive Summary & CTA Slide',
    visualFocus: 'Scannable 3-point recap card with a primary action button.',
    headline: `Ready to Scale Your ${draft.channel || 'Growth'} Engine?`,
    subheadline: `Automate your SEO and multi-channel publishing with ${brandName}.`,
    cta: 'Claim Your Free Workspace at moyi-cmo.com'
  });

  return {
    totalSlides: count,
    deckTitle: title,
    brandName,
    slides
  };
}

/**
 * Generates an infographic blueprint for comparison tables and metric callouts.
 */
function generateInfographicBlueprint({ project = {}, draft = {}, metrics = [] } = {}) {
  return {
    layoutType: '2-Column Head-to-Head Comparison & Metric Badges',
    gridAlignment: '12-Column Swiss Modular Grid',
    primaryMetrics: metrics.length ? metrics : [
      { label: 'Organic Search Impressions', value: '+340%', status: 'positive' },
      { label: 'Time Saved per Week', value: '12.5 hrs', status: 'positive' },
      { label: 'Agency Retainer Reduction', value: '€5,000/mo', status: 'positive' }
    ],
    visualHierarchy: {
      dominantHeader: draft.title || 'Performance & Capability Benchmark',
      badgeStyle: 'Pill-shaped contrast badge with emerald indicator',
      tableLayout: 'Alternating high-contrast row cards with 14px border-radius'
    }
  };
}

/**
 * Generates a 3D glassmorphism device mockup blueprint.
 */
function generate3dMockupBlueprint({ project = {}, draft = {}, deviceType = 'macbook-glass' } = {}) {
  return {
    deviceType,
    cameraPerspective: '15-degree isometric tilt with soft ambient depth',
    surfaceMaterial: 'Matte glass display with subtle specular reflections',
    ambientLighting: 'Dark-mode studio setup with violet and emerald directional rim glow',
    compositionGrid: 'Golden Ratio focal alignment on the active software dashboard'
  };
}

module.exports = {
  resolveBrandDesignTokens,
  buildEnterpriseVisualPrompt,
  generateCarouselDeckPlan,
  generateInfographicBlueprint,
  generate3dMockupBlueprint,
  AESTHETIC_PRESETS
};
