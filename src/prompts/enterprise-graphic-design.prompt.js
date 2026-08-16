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
  const isFlyer = visualFormat === 'corporate-flyer';

  return [
    'Act as an elite Enterprise Art Director and Senior Production Designer.',
    `Design an agency-grade marketing visual asset in the ${theme.name} aesthetic.`,
    
    '--- SWISS TYPOGRAPHIC GRID & COMPOSITION RULES ---',
    '1. 12-Column Grid Alignment: Align all cards, text blocks, and visual anchors to a strict modular grid. Never scatter elements arbitrarily.',
    '2. Golden Ratio Hierarchy (1:1.618): Establish one single dominant focal point (Headline or Hero Asset), followed by secondary structured information.',
    '3. 8pt Baseline Vertical Rhythm: Use uniform vertical spacing (8px, 16px, 24px, 32px) between headlines, subtitles, feature groups, and button controls.',
    '4. The 30% Negative Space Rule: Maintain at least 30% unobstructed whitespace/breathing room across the canvas. Avoid clutter, random geometric floaters, and crowded margins.',
    
    '--- C.R.A.P. DESIGN & ACCESSIBILITY PRINCIPLES ---',
    '1. Contrast: Ensure a minimum 4.5:1 WCAG contrast ratio for all text against backgrounds. The primary message must be immediately readable in under 2 seconds.',
    '2. Repetition: Use identical corner radii (14px), consistent card borders, and uniform iconography styling throughout the visual composition.',
    '3. Alignment: Body copy and descriptive text must be flush-left aligned with clean vertical left-side margin lines. Avoid centered multi-line body paragraphs with ragged edges.',
    '4. Proximity: Group related data points, icons, and labels into atomic visual cards separated by clean whitespace.',
    
    '--- 60-30-10 COLOR HARMONIZATION ---',
    `Color Distribution Rule: ${theme.colorRule}`,
    theme.styleDescriptor,
    
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
