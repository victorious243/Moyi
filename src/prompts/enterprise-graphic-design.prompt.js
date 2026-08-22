const RULES = require('./content-rules');

const AESTHETIC_PRESETS = {
  'minimalist-saas': {
    name: 'Minimalist Enterprise SaaS',
    styleDescriptor: 'Stripe/Linear-grade clean dark aesthetic, deep slate background (#0b0c10), subtle 1px border lines (rgba(255,255,255,0.08)), electric indigo accent glow, crisp sans-serif typography, generous whitespace.',
    colorRule: '60% deep slate (#0b0c10), 30% structural muted cards, 10% electric indigo (#6366f1) focal accent.',
    mood: 'Authoritative, technical, refined, modern.'
  },
  'warm-editorial': {
    name: 'Warm Editorial Corporate',
    styleDescriptor: 'McKinsey/Harvard Business Review clean editorial style, architectural warm cream or crisp white background, deep charcoal typography, refined serif display headlines paired with geometric sans body, structured column layouts.',
    colorRule: '60% warm ivory/paper white, 30% deep charcoal text, 10% warm amber or royal navy accent.',
    mood: 'Intellectual, premium, executive, trustworthy.'
  },
  'fintech-glass': {
    name: 'Fintech & Cybersecurity Glass',
    styleDescriptor: 'High-end fintech dark glassmorphism, floating frosted glass cards with subtle specular edge reflections, neon emerald or cyan data highlights, technical HUD grid elements, soft ambient occlusion.',
    colorRule: '60% deep obsidian (#07090e), 30% translucent frosted glass cards, 10% radiant emerald (#10b981) or cyan.',
    mood: 'Secure, high-tech, cutting-edge, institutional.'
  },
  'high-voltage-growth': {
    name: 'High-Voltage Growth',
    styleDescriptor: 'Bold high-contrast marketing aesthetic, vibrant gradient accents, high-energy display typography, tactile floating sticker badges, bold metric callouts, clean diagonal composition.',
    colorRule: '60% deep midnight, 30% stark white cards, 10% vibrant electric violet and coral gradient accents.',
    mood: 'Dynamic, high-converting, punchy, energetic.'
  },
  'documentary-human': {
    name: 'Documentary Human Brand',
    styleDescriptor: 'Human editorial advertising style with believable photography, candid composition, natural light, tactile real-world surfaces, imperfect-but-intentional framing, understated typography, and quiet brand placement.',
    colorRule: 'Use colors from the supplied brand identity as restrained accents inside a real scene; avoid one-note neon palettes and synthetic gradients.',
    mood: 'Human, credible, warm, useful, lived-in.'
  },
  'luxury-fashion': {
    name: 'Luxury Fashion Editorial',
    styleDescriptor: 'Magazine-quality fashion campaign art direction: considered styling, tactile fabrics, skin-real lighting, editorial poses, controlled negative space, refined color restraint, and premium photographic texture.',
    colorRule: 'Use a restrained editorial palette from wardrobe, product, and environment. Avoid loud synthetic gradients, fake neon, and SaaS blue-purple defaults.',
    mood: 'Aspirational, tasteful, cinematic, human, premium.'
  },
  'clean-commerce': {
    name: 'Clean Commerce Studio',
    styleDescriptor: 'Modern ecommerce product photography: believable product scale, clean styling, realistic shadows, tactile packaging, clear purchase context, and simple composition that lets the product do the selling.',
    colorRule: 'Let product and brand colors lead. Use neutral backgrounds, natural shadows, and one restrained accent color.',
    mood: 'Clear, shoppable, trustworthy, modern.'
  },
  'art-house': {
    name: 'Art-House Campaign',
    styleDescriptor: 'Gallery-grade campaign imagery with symbolism, material texture, expressive composition, unusual but tasteful cropping, and minimal copy. Feels designed by an art director, not an ad template.',
    colorRule: 'Use expressive but controlled color relationships. Avoid default tech gradients and decorative glow effects.',
    mood: 'Original, cultural, memorable, tactile.'
  },
  'earthy-wellness': {
    name: 'Earthy Wellness Lifestyle',
    styleDescriptor: 'Natural lifestyle photography with soft daylight, human routine, plant/wood/linen texture, approachable styling, and quiet brand presence. Avoid sterile stock-photo perfection.',
    colorRule: 'Use grounded natural colors from the environment and product. Keep accents soft and believable.',
    mood: 'Calm, trustworthy, personal, warm.'
  }
};

function buildEnterpriseVisualPrompt({
  project = {},
  draft = {},
  visualFormat = 'corporate-flyer',
  aestheticTheme = 'minimalist-saas',
  slideIndex = 1,
  totalSlides = 1,
  exactPosterText = '',
  guidance = '',
  outputProfile = null,
  brandTokens = {}
}) {
  const theme = AESTHETIC_PRESETS[aestheticTheme] || AESTHETIC_PRESETS['minimalist-saas'];
  const isCarousel = visualFormat === 'b2b-carousel-slide';
  const isInfographic = visualFormat === 'data-infographic';
  const isMockup = visualFormat === '3d-device-mockup';
  const isAd = visualFormat === 'performance-ad-creative';
  const isHumanEditorial = visualFormat === 'human-editorial-poster';
  const isFashionEditorial = visualFormat === 'fashion-editorial';
  const isEcommerceProduct = visualFormat === 'ecommerce-product-scene';
  const isMinimalProduct = visualFormat === 'minimal-product-visual';
  const isUgcLifestyle = visualFormat === 'ugc-lifestyle';
  const isArtCampaign = visualFormat === 'art-direction-campaign';
  const isImageFirst = isHumanEditorial || isFashionEditorial || isEcommerceProduct || isMinimalProduct || isUgcLifestyle || isArtCampaign;
  const isFlyer = visualFormat === 'corporate-flyer' || (!isCarousel && !isInfographic && !isMockup && !isAd && !isImageFirst);

  return [
    'Act as an elite Enterprise Art Director and Senior Production Designer.',
    `Design an agency-grade marketing visual asset in the ${theme.name} aesthetic.`,
    isImageFirst
      ? `--- IMAGE-FIRST ART DIRECTION ---
1. Build the image around one believable human or real-world brand moment: a workspace, founder desk, customer environment, product-in-use scene, street-level business context, or documentary-style detail.
2. Use natural light, subtle grain, real camera depth, tactile surfaces, imperfect framing, and human warmth. It should feel photographed or assembled by a thoughtful creative team, not generated from a template.
3. If text is requested, use sparse editorial typography like a magazine ad or small caption. Keep copy minimal, grounded, and easy to read.
4. Brand presence should feel real: a laptop sticker, printed note, small screen, package label, office wall, or tasteful lower-corner mark. Do not make the logo the entire concept unless explicitly requested.`
      : `--- SWISS TYPOGRAPHIC GRID & COMPOSITION RULES ---
1. 12-Column Grid Alignment: Align all cards, text blocks, and visual anchors to a strict modular grid. Never scatter elements arbitrarily.
2. Golden Ratio Hierarchy (1:1.618): Establish one single dominant focal point (Headline or Hero Asset), followed by secondary structured information.
3. 8pt Baseline Vertical Rhythm: Use uniform vertical spacing (8px, 16px, 24px, 32px) between headlines, subtitles, feature groups, and button controls.
4. The 30% Negative Space Rule: Maintain at least 30% unobstructed whitespace/breathing room across the canvas. Avoid clutter, random geometric floaters, and crowded margins.

--- C.R.A.P. DESIGN & ACCESSIBILITY PRINCIPLES ---
1. Contrast: Ensure a minimum 4.5:1 WCAG contrast ratio for all text against backgrounds. The primary message must be immediately readable in under 2 seconds.
2. Repetition: Use identical corner radii (14px), consistent card borders, and uniform iconography styling throughout the visual composition.
3. Alignment: Body copy and descriptive text must be flush-left aligned with clean vertical left-side margin lines. Avoid centered multi-line body paragraphs with ragged edges.
4. Proximity: Group related data points, icons, and labels into atomic visual cards separated by clean whitespace.`,

    '--- COLOR & MATERIAL DIRECTION ---',
    `Color Distribution Rule: ${theme.colorRule}`,
    theme.styleDescriptor,
    'Anti-AI visual ban: no neon orbs, abstract orbit rings, glowing 3D arrows, fake holographic dashboards, floating feature-card clusters, generic purple-blue SaaS gradients, plastic stock-photo people, over-symmetric layouts, warped hands, or decorative tech swirls.',
    
    isCarousel
      ? `--- B2B CAROUSEL SLIDE SPECIFICATION (Slide ${slideIndex} of ${totalSlides}) ---
- Top recurring subtle progress indicator (e.g. minimalist dot or line tracker for slide ${slideIndex}/${totalSlides}).
- Single, high-impact takeaway on this slide. Do not overload one slide with multiple competing concepts.
- Large, bold hook headline at the top, followed by 1 supporting evidence card or key visual.
- Clean slide branding in the bottom corner with safe margin clearance.`
      : '',

    isInfographic
      ? `--- DATA-DENSE INFOGRAPHIC & COMPARISON MATRIX ---
- Render clean, scannable data comparison cards or a 2-column head-to-head matrix.
- Use distinct green checkmark badges and muted cross indicators for capability rows.
- Display large, bold metric badges with high-contrast numerical callouts (e.g. "+300% Growth", "€50k Saved").
- Ensure all text and labels are crisp, correctly spelled, and easy to read at a glance.`
      : '',

    isMockup
      ? `--- 3D PHOTOREALISTIC DEVICE MOCKUP SPECIFICATION ---
- Present the software user interface inside a sleek, floating 3D glass display or matte-finished Apple hardware frame.
- Use subtle isometric perspective (15-degree tilt) with soft specular reflections and ambient occlusion shadows.
- Studio dark-mode lighting with a subtle directional neon rim glow behind the device.`
      : '',

    isAd
      ? `--- DIRECT-RESPONSE PERFORMANCE AD CREATIVE SPECIFICATION ---
- High-converting direct-response layout engineered for Meta Ads / LinkedIn Sponsored posts.
- Clear visual hierarchy with a bold pattern-interrupt hook or Before-vs-After split-screen problem/solution contrast.
- Visual trust indicators (verified checkmarks, rating star badges, or client proof callouts).
- High-contrast, friction-reducing CTA button with clear action text.`
      : '',

    isHumanEditorial
      ? `--- HUMAN EDITORIAL POSTER SPECIFICATION ---
- Make the scene emotionally credible before it is promotional.
- Prefer one strong photographic subject or environmental detail over many UI cards.
- Use restrained brand typography and no more than one concise headline or CTA when copy is requested.
- Show the product or offer through context, not through invented interface screens unless the supplied reference supports it.
- Leave room for social-platform cropping while keeping the composition natural.`
      : '',

    isFashionEditorial
      ? `--- FASHION / BEAUTY EDITORIAL SPECIFICATION ---
- Create a tasteful fashion-campaign image, not a sales flyer.
- Prioritize styling, fabric, body language, light, mood, and believable skin/hair detail.
- Use one subject, product detail, or styled scene with premium magazine restraint.
- Do not place long feature copy, icons, app UI, or comparison cards on the image.
- If the brand sells apparel, accessories, beauty, or lifestyle goods, make the product feel desirable through photography and styling rather than explanation.`
      : '',

    isEcommerceProduct
      ? `--- ECOMMERCE PRODUCT SCENE SPECIFICATION ---
- Make the product or offer immediately inspectable and shoppable.
- Use realistic product scale, natural shadows, packaging detail, shelf/table/hand context, or an in-use moment.
- Keep the background simple enough for paid social and storefront reuse.
- Avoid cluttered text blocks, fake testimonial badges, feature grids, and invented product labels.
- Do not invent product claims or show products that contradict the supplied business.`
      : '',

    isMinimalProduct
      ? `--- MINIMAL NO-TEXT PRODUCT VISUAL SPECIFICATION ---
- Create a simple, premium, image-led composition with strong negative space and almost no visual noise.
- Prefer one product, one human detail, or one symbolic object.
- No headline, no paragraph, no CTA button, no feature cards, and no infographic elements unless explicitly requested.
- Make it suitable as a clean Instagram/X/LinkedIn visual where the caption carries the explanation.`
      : '',

    isUgcLifestyle
      ? `--- UGC / LIFESTYLE SPECIFICATION ---
- Make it feel like a high-quality creator shot or founder/customer moment, not a glossy template.
- Use real-life framing, natural imperfections, handheld perspective, believable environment, and human emotion.
- Avoid overly perfect stock models, plastic smiles, synthetic lighting, and fake screenshot collages.
- Keep brand/product presence organic and credible.`
      : '',

    isArtCampaign
      ? `--- ART-DIRECTION CAMPAIGN SPECIFICATION ---
- Create a memorable conceptual campaign image using symbolism, texture, unusual composition, or visual metaphor.
- Keep it tasteful and brand-relevant, with restraint rather than maximal effects.
- No generic tech orbs, glowing arrows, 3D letters, dashboard collages, or template feature cards.
- The image should feel like a cultural ad campaign, not a prompt-generated poster.`
      : '',

    isFlyer
      ? `--- CORPORATE MARKETING FLYER SPECIFICATION ---
- Top integrated brand identity with clear safe-margin spacing.
- Compelling, high-converting display headline focused on quantifiable business outcomes.
- Structured 2-to-3 feature group cards with clean icons and concise benefits.
- High-contrast primary Call-to-Action button at the bottom.`
      : '',

    outputProfile && outputProfile.width && outputProfile.height
      ? `Canvas dimensions: ${outputProfile.width} by ${outputProfile.height} pixels (${outputProfile.orientation}). Keep all content strictly inside an inner 8% safe margin.`
      : '',

    exactPosterText
      ? `Render this exact primary text once, spelled precisely as written: "${exactPosterText}".`
      : '',

    guidance ? `Specific Art Direction: ${guidance}` : '',

    'Return ONLY the final finished artwork without wireframes, crop marks, or unfinished labels.',
    ...RULES
  ].filter(Boolean).join('\n');
}

module.exports = {
  buildEnterpriseVisualPrompt,
  AESTHETIC_PRESETS
};
