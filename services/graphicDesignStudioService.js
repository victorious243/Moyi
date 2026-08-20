const { buildEnterpriseVisualPrompt, AESTHETIC_PRESETS } = require('../src/prompts/enterprise-graphic-design.prompt');

/**
 * Resolves 60-30-10 brand design tokens and aesthetic theme for a project.
 */
function resolveBrandDesignTokens({ project = {}, draft = {} } = {}) {
  const brandTone = String(project.brandTone || '').toLowerCase();
  const industry = String(project.industry || '').toLowerCase();

  let aestheticTheme = 'documentary-human';
  if (/\b(?:human|warm|authentic|editorial|community|creator|local|personal|approachable)\b/.test(brandTone)) {
    aestheticTheme = 'documentary-human';
  } else if (/\b(?:security|fintech|finance|crypto|devops|data|api)\b/.test(industry) || /\b(?:secure|technical|precise)\b/.test(brandTone)) {
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

/**
 * Generates a direct-response performance ad creative blueprint for paid social campaigns.
 */
function generatePerformanceAdBlueprint({ project = {}, draft = {}, adStyle = 'split-before-after' } = {}) {
  return {
    adStyle,
    layoutStructure: adStyle === 'split-before-after'
      ? '50/50 Horizontal Split Screen: Problem state (Left, muted/red) vs Solution state (Right, vibrant/green)'
      : 'Feature-Benefit Matrix with high-contrast social proof badge and friction-reducing CTA',
    visualHooks: [
      { type: 'pattern_interrupt', description: 'Bold high-contrast outcome statement in top 20% safe zone' },
      { type: 'trust_badge', description: 'Verified customer review rating or benchmark result pill' },
      { type: 'action_trigger', description: 'High-contrast pill CTA button with directional arrow' }
    ],
    targetPlatforms: ['facebook', 'instagram', 'linkedin', 'x']
  };
}

const GRAPHIC_DESIGN_SKILLS = [
  {
    id: 'human-editorial-poster',
    name: 'Human Editorial Poster',
    badge: 'Human-first',
    icon: '📷',
    description: 'Believable campaign visuals with natural light, real-world context, restrained typography, and no obvious AI SaaS poster patterns.',
    bestFor: 'Founder brands, local services, creators, human-led SaaS launches, organic social posts.'
  },
  {
    id: 'corporate-flyer',
    name: 'Corporate Marketing Flyer',
    badge: 'Standard Flyer',
    icon: '🎨',
    description: 'Outcome-focused single-image flyer with integrated logo, Swiss 12-column grid, atomic feature cards, and high-converting CTA.',
    bestFor: 'LinkedIn updates, X/Twitter posts, Facebook announcements, general campaigns.'
  },
  {
    id: 'b2b-carousel-slide',
    name: 'Multi-Slide B2B Carousel Deck',
    badge: '2.1x Engagement',
    icon: '📱',
    description: 'Cohesive multi-slide deck with bold pattern-interrupt hook slide, progressive takeaway cards, swipe indicators (Swipe →), and summary CTA.',
    bestFor: 'LinkedIn document posts, Instagram multi-image carousels, educational guides.'
  },
  {
    id: '3d-device-mockup',
    name: '3D SaaS Product Mockup',
    badge: 'High Conversion',
    icon: '💻',
    description: 'Software UI displayed inside a floating 3D glass display or Apple hardware frame with dark-mode studio lighting and ambient neon rim glow.',
    bestFor: 'Product launches, feature announcements, landing page hero cards, software demos.'
  },
  {
    id: 'data-infographic',
    name: 'Data-Dense Infographic & Matrix',
    badge: 'Most Reposted',
    icon: '📊',
    description: 'McKinsey & Gartner style head-to-head comparison tables, 2x2 strategic grids, step-by-step process diagrams, and bold metric callout badges.',
    bestFor: 'Industry benchmarks, competitor comparisons, case study proof, thought leadership.'
  },
  {
    id: 'performance-ad-creative',
    name: 'Direct-Response Performance Ad',
    badge: 'Paid Ads / Meta',
    icon: '🎯',
    description: 'Conversion-engineered ad visual featuring split-screen Before vs After, problem agitation, verified proof badges, and high-CTR CTA buttons.',
    bestFor: 'Meta Ads (Facebook/Instagram), LinkedIn Sponsored Content, retargeting campaigns.'
  }
];

module.exports = {
  resolveBrandDesignTokens,
  buildEnterpriseVisualPrompt,
  generateCarouselDeckPlan,
  generateInfographicBlueprint,
  generate3dMockupBlueprint,
  generatePerformanceAdBlueprint,
  GRAPHIC_DESIGN_SKILLS,
  AESTHETIC_PRESETS
};
