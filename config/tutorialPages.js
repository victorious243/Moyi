const TUTORIAL_PAGES = {
  'connecting-google-search-console': {
    slug: 'connecting-google-search-console',
    category: 'Integrations & SEO',
    readTime: '4 min read',
    difficulty: 'Beginner',
    title: 'Connecting Google Search Console & Launching Your 1st Audit',
    seoTitle: 'How to Connect Google Search Console to Moyi-CMO (Tutorial)',
    seoDescription: 'Step-by-step guide to connecting your Google Search Console account with Moyi-CMO to unlock striking-distance keyword mining and automated SEO audits.',
    heroHeadline: 'How to Connect Google Search Console & Mine Striking-Distance Keywords',
    heroSubheadline: 'Learn how to connect read-only Search Console access in 2 minutes so Moyi can automatically identify ranking opportunities in positions 8–20.',
    summary: 'Google Search Console is the single most valuable source of first-party organic search data. This tutorial walks you through granting read-only permissions, selecting your domain property, running your first deep crawl, and letting Moyi-CMO uncover instant organic ranking wins.',
    prerequisites: [
      'An active Moyi-CMO account (Free Trial or Pro)',
      'A Google Account with Owner or Full/Restricted permissions to a verified Search Console property',
      'An authorized website URL added to your Moyi workspace'
    ],
    steps: [
      {
        number: 1,
        title: 'Navigate to Workspace Integrations',
        instruction: 'From your main Moyi-CMO dashboard, select your project from the top navigation dropdown and click on "Integrations" in the sidebar menu (or go directly to /integrations).',
        proTip: 'Ensure you are inside the correct project workspace if you manage multiple client domains.',
        actionLink: '/integrations',
        actionText: 'Open Integrations'
      },
      {
        number: 2,
        title: 'Authorize Google Search Console (Read-Only)',
        instruction: 'Find the "Google Search Console" card and click "Connect GSC". You will be redirected to Google\'s secure OAuth consent screen. Sign in with the Google account that manages your website property and grant read-only access (https://www.googleapis.com/auth/webmasters.readonly).',
        proTip: 'Moyi strictly requests read-only search console permissions. We never modify your sitemaps or delete crawl settings.',
        actionLink: null,
        actionText: null
      },
      {
        number: 3,
        title: 'Select Your Verified Website Property',
        instruction: 'Once redirected back to Moyi, choose your verified property from the dropdown list. Both URL-prefix (e.g. https://yourdomain.com/) and Domain properties (sc-domain:yourdomain.com) are fully supported.',
        proTip: 'If your site serves both www and non-www traffic, select the Domain property to capture all query impressions.',
        actionLink: null,
        actionText: null
      },
      {
        number: 4,
        title: 'Run Your First Factual Website Scan',
        instruction: 'Click "Save & Run Initial Scan". Moyi\'s asynchronous crawler will inspect your homepage and key landing pages for metadata, heading hierarchy, content depth, internal links, and technical health while pairing it with live Search Console query velocity.',
        proTip: 'Scans run in the background via Redis workers. You can leave the page and you will receive a notification when the scan completes.',
        actionLink: '/projects',
        actionText: 'View Scan Status'
      },
      {
        number: 5,
        title: 'Review Discovered Striking-Distance Keywords',
        instruction: 'Open the "Recommendations" tab. Moyi will highlight high-impression queries currently ranking between position 8 and 20 ("striking-distance"). Accepting a striking-distance opportunity immediately feeds it into the Content Studio to draft targeted sub-intent sections or dedicated BOFU pages.',
        proTip: 'Updating existing striking-distance pages usually yields 3x faster ranking improvements than writing completely new articles.',
        actionLink: '/dashboard',
        actionText: 'Explore Recommendations'
      }
    ],
    keyTakeaways: [
      'Read-only Google OAuth ensures 100% data security with zero write risk.',
      'Striking-distance queries (positions 8–20) are the fastest path to organic pipeline growth.',
      'Every scan creates an immutable audit trail you can compare over time in Scan History.'
    ],
    faqs: [
      {
        question: 'Does Moyi modify any settings in my Google Search Console account?',
        answer: 'Never. Moyi requests strictly read-only OAuth scopes (webmasters.readonly). We only fetch impressions, clicks, CTR, and average position data.'
      },
      {
        question: 'How often does Moyi sync Search Console data?',
        answer: 'Search Console telemetry is synchronized daily at 05:00 AM local time to prepare your morning Intello Daily briefs and weekly CMO reports.'
      }
    ],
    nextTutorial: {
      slug: 'intello-daily-morning-approvals',
      title: 'Mastering Intello Daily: Reviewing & 1-Click Approving 7:00 AM Packages'
    }
  },
  'intello-daily-morning-approvals': {
    slug: 'intello-daily-morning-approvals',
    category: 'Daily Automation',
    readTime: '5 min read',
    difficulty: 'Beginner',
    title: 'Mastering Intello Daily: Reviewing & 1-Click Approving 7:00 AM Packages',
    seoTitle: 'How to Use Intello Daily for Morning Content Approvals (Tutorial)',
    seoDescription: 'Learn how Intello Daily autonomous content intelligence works, how morning briefs are prepared, and how to review and 1-click approve social drafts.',
    heroHeadline: 'How to Use Intello Daily: From 7:00 AM Brief to 1-Click Publishing',
    heroSubheadline: 'Discover how Moyi autonomously mines queries, writes direct-response copy, formats Swiss carousels, and notifies you for 1-click morning approval.',
    summary: 'Intello Daily is Moyi\'s autonomous morning intelligence engine. Every morning at 7:00 AM, it delivers fresh, ready-to-publish social posts, Swiss carousels, 3D device mockups, and performance ads tailored to your brand. This guide explains how to review, tweak, and schedule today\'s package in 60 seconds.',
    prerequisites: [
      'A Moyi-CMO project with a completed website scan or Search Console integration',
      'At least one connected social channel (LinkedIn, X, Meta, Bluesky, Threads, etc.)',
      'Configured local timezone in Project Settings'
    ],
    steps: [
      {
        number: 1,
        title: 'Configure Your Morning Delivery Time & Timezone',
        instruction: 'Go to Project Settings > Automation. Verify your local timezone (e.g. America/New_York or Europe/London) and set your preferred delivery time (defaults to 07:00 AM). Enter the notification email addresses for team members who should receive morning alerts.',
        proTip: 'Setting delivery to 07:00 AM local time gives you a chance to review drafts with your morning coffee before peak 08:30 AM LinkedIn traffic.',
        actionLink: '/projects',
        actionText: 'Project Settings'
      },
      {
        number: 2,
        title: 'Receive Your Morning Email Alert or In-App Bell',
        instruction: 'Every morning at your scheduled time, Moyi sends a rich HTML brief to your email and illuminates the notification badge in your topbar. Click "Review Today\'s Package" directly from your email on desktop or mobile.',
        proTip: 'You can approve directly from your phone browser with zero login friction.',
        actionLink: null,
        actionText: null
      },
      {
        number: 3,
        title: 'Review the Direct-Response Copy & Framework',
        instruction: 'In the Intello Daily approval queue, check the copy framework (PAS: Problem-Agitate-Solve, AIDA: Attention-Interest-Desire-Action, or BAB: Before-After-Bridge). Verify that the hook, proof points, and call-to-action match your brand standards.',
        proTip: 'Click "Edit Draft" if you want to personalize an anecdote or add a custom founder perspective.',
        actionLink: '/features/daily-content-intelligence',
        actionText: 'View Intello Daily Hub'
      },
      {
        number: 4,
        title: 'Inspect the Attached Swiss Visual Graphic',
        instruction: 'Examine the attached graphic asset. Intello Daily pairs posts with 12-column Swiss carousel slides, 3D glassmorphic mockups, or high-contrast comparison cards featuring your official logo.',
        proTip: 'You can swap visual styles with one click between Minimalist SaaS, Fintech Glass, or High-Voltage Growth.',
        actionLink: null,
        actionText: null
      },
      {
        number: 5,
        title: '1-Click Approve & Schedule',
        instruction: 'Click the green "Approve & Schedule" button. Moyi automatically locks the package, applies tamper-proof first-party UTM parameters, and queues it for distribution into your connected social networks during peak engagement slots.',
        proTip: 'Remember our ironclad governance rule: "Moyi proposes. Humans decide." Nothing ever publishes without your explicit tap.',
        actionLink: '/dashboard',
        actionText: 'Open Operator Queue'
      }
    ],
    keyTakeaways: [
      'Intello Daily replaces 3 hours of daily brainstorming with a 60-second review routine.',
      'Direct-response copywriting frameworks ensure posts drive pipeline, not just likes.',
      'Human-in-the-loop governance guarantees your brand voice and reputation remain 100% protected.'
    ],
    faqs: [
      {
        question: 'What happens if I don\'t approve a draft on a given day?',
        answer: 'Unapproved drafts remain safely in your Content Studio backlog. They will never auto-publish, and you can approve or repurpose them at any time.'
      },
      {
        question: 'Can I regenerate a visual if I want a different format?',
        answer: 'Yes! Click "Regenerate Visual" in the review panel and select from Carousel Deck, 3D Mockup, Infographic, Performance Ad, or Flyer.'
      }
    ],
    nextTutorial: {
      slug: 'graphic-design-studio-carousels-mockups',
      title: 'Graphic Design Studio: Generating Swiss Carousels, 3D Mockups & Infographics'
    }
  },
  'graphic-design-studio-carousels-mockups': {
    slug: 'graphic-design-studio-carousels-mockups',
    category: 'Visual Design',
    readTime: '6 min read',
    difficulty: 'Intermediate',
    title: 'Graphic Design Studio: Generating Swiss Carousels, 3D Mockups & Infographics',
    seoTitle: 'How to Use Moyi Graphic Design Studio for Carousels & 3D Mockups (Tutorial)',
    seoDescription: 'Master the 5 visual design engines in Moyi-CMO: 12-column Swiss carousel decks, 3D isometric device mockups, data infographics, and performance ads.',
    heroHeadline: 'How to Generate High-Converting Visual Assets in Moyi Visual Studio',
    heroSubheadline: 'Learn how to generate professional, on-brand graphics on a Swiss 12-column modular grid with zero Figma or Photoshop experience.',
    summary: 'Generic stock photos get ignored. Moyi\'s Visual Intelligence Studio features 5 specialized graphic design engines engineered for high CTR, strict WCAG contrast compliance, and authentic brand identity. This tutorial shows you how to produce multi-slide carousels, 3D device frames, and conversion flyers.',
    prerequisites: [
      'A transparent PNG logo uploaded in Project Settings (recommended min width: 400px)',
      'Configured primary brand colors in Project Calibration'
    ],
    steps: [
      {
        number: 1,
        title: 'Upload Your Official Transparent PNG Logo',
        instruction: 'Go to Project Settings > Brand Assets and upload your official logo as a transparent PNG. Moyi saves this asset to object storage and overlays it with precise margin padding on all generated visuals.',
        proTip: 'Use a high-resolution white or colored logo on a transparent background for optimal contrast against dark studio backgrounds.',
        actionLink: '/projects',
        actionText: 'Upload Brand Logo'
      },
      {
        number: 2,
        title: 'Choose Your Visual Design Discipline',
        instruction: 'In Content Studio, select your required format: (1) B2B Multi-Slide Carousel Deck, (2) 3D Glassmorphic Device Mockup, (3) Data-Dense Infographic & Matrix, (4) Performance Ad Creative, or (5) Corporate Marketing Flyer.',
        proTip: 'Multi-slide carousels generate 2.1x higher reach on LinkedIn and Instagram compared to single-image posts.',
        actionLink: null,
        actionText: null
      },
      {
        number: 3,
        title: 'Select an Aesthetic Style Preset',
        instruction: 'Choose one of Moyi\'s calibrated style presets: (A) Minimalist SaaS (slate gray, sharp typography), (B) Fintech Glass (deep navy, cyan glow, frosted glass), (C) Warm Editorial (cream, serif typography), or (D) High-Voltage Growth (dark obsidian, neon green accents).',
        proTip: 'Consistent style presets across all weekly posts build strong visual brand recognition in follower feeds.',
        actionLink: null,
        actionText: null
      },
      {
        number: 4,
        title: 'Review Candidate Visuals in the Visual Stage',
        instruction: 'Moyi renders 3 candidate variations side-by-side with your copy draft. Inspect typographic hierarchy, swipe indicators (e.g. "Slide 1 of 5"), contrast ratios, and logo placement.',
        proTip: 'Click on any slide thumbnail to zoom in and preview how it looks on mobile screens.',
        actionLink: null,
        actionText: null
      },
      {
        number: 5,
        title: 'Attach Selected Visual to Your Content Draft',
        instruction: 'Click "Select This Visual" to attach it to your social draft or export it as high-resolution PNG / PDF for external use in marketing decks or newsletters.',
        proTip: 'Approved carousel decks can be downloaded directly as multi-page PDFs ready for LinkedIn document uploads.',
        actionLink: '/features/daily-content-intelligence',
        actionText: 'Explore Visual Studio'
      }
    ],
    keyTakeaways: [
      '12-column Swiss alignment ensures clean, professional hierarchy without design clutter.',
      '3D isometric device mockups give software features tangible, high-value presentation.',
      'All visuals enforce strict 4.5:1+ WCAG contrast ratios for maximum legibility.'
    ],
    faqs: [
      {
        question: 'Can I upload my own custom background images?',
        answer: 'Yes! In the Visual tab, click "Upload Custom Asset" to use your own photography or product screenshots while still letting Moyi format the typography and captions.'
      },
      {
        question: 'What aspect ratios are supported?',
        answer: 'Moyi supports 1:1 (Square for Instagram/LinkedIn), 4:5 / 9:16 (Vertical for Carousels & Stories), and 16:9 (Landscape for X and YouTube thumbnails).'
      }
    ],
    nextTutorial: {
      slug: 'social-media-publishing-utm-attribution',
      title: 'Multi-Channel Social Publishing & Closed-Loop UTM Revenue Attribution'
    }
  },
  'social-media-publishing-utm-attribution': {
    slug: 'social-media-publishing-utm-attribution',
    category: 'Distribution & Analytics',
    readTime: '5 min read',
    difficulty: 'Intermediate',
    title: 'Multi-Channel Social Publishing & Closed-Loop UTM Revenue Attribution',
    seoTitle: 'How to Set Up Social Publishing & UTM Attribution in Moyi (Tutorial)',
    seoDescription: 'Connect LinkedIn, X, Meta, Bluesky, and Threads with first-party UTM conversion tracking to attribute revenue directly to social content.',
    heroHeadline: 'How to Publish Multi-Channel Social Posts with Closed-Loop Attribution',
    heroSubheadline: 'Stop guessing which social posts drive revenue. Connect your social channels and measure first-party conversion paths from post to pipeline.',
    summary: 'Most marketing teams publish blindly without knowing which posts generate signups. Moyi combines native multi-platform distribution (LinkedIn, 𝕏, Instagram, Facebook, Threads, Bluesky, TikTok, YouTube) with first-party UTM tracking and conversion telemetry. This guide shows you how to configure closed-loop attribution.',
    prerequisites: [
      'Admin access to your company social media accounts',
      'Access to add a 1-line script to your website <head>'
    ],
    steps: [
      {
        number: 1,
        title: 'Connect Your Company Social Accounts',
        instruction: 'Navigate to Integrations > Social Accounts. Click "Connect" next to your platforms: LinkedIn (Company Page or Personal Profile), 𝕏 / Twitter, Facebook Page, Instagram Professional, Threads, Bluesky, TikTok, or YouTube.',
        proTip: 'Make sure to grant publishing and read-engagement permissions during the OAuth authorization prompt.',
        actionLink: '/integrations',
        actionText: 'Connect Social Accounts'
      },
      {
        number: 2,
        title: 'Install the Lightweight First-Party Tracking Script',
        instruction: 'Go to Integrations > Tracking Setup. Copy the 1-line JavaScript tracking snippet and paste it into the <head> of your website or via Google Tag Manager.',
        proTip: 'The Moyi tracker is cookie-free, privacy-first, and adds less than 1.8KB to your page load weight.',
        actionLink: '/integrations',
        actionText: 'Get Tracking Code'
      },
      {
        number: 3,
        title: 'Define Your Core Conversion Goals',
        instruction: 'In the Tracking dashboard, create conversion goals for the key actions that matter: (1) Trial Signup (URL match: /dashboard or custom event moyi.track("signup")), (2) Demo Booking, or (3) Paid Subscription.',
        proTip: 'Tracking both micro-conversions (newsletter signups) and macro-conversions (trials) provides clear funnel visibility.',
        actionLink: null,
        actionText: null
      },
      {
        number: 4,
        title: 'Schedule Approved Drafts with Automatic UTMs',
        instruction: 'When you approve a draft in the Content Studio or Intello Daily queue, Moyi automatically attaches structured UTM parameters: utm_source={platform}, utm_medium=social, utm_campaign={campaign_id}, and utm_content={post_slug}.',
        proTip: 'Never manually build UTM links again — Moyi handles parameter injection and shortening automatically.',
        actionLink: '/dashboard',
        actionText: 'View Content Calendar'
      },
      {
        number: 5,
        title: 'Read Closed-Loop Revenue Attribution in CMO Reports',
        instruction: 'Open the Reports tab. Moyi connects social clicks to onsite sessions and conversions, displaying exact customer journeys: e.g. "LinkedIn Thought Leadership Post #14 -> 42 Clicks -> 7 Free Trials -> €343 MRR".',
        proTip: 'Use these attribution insights to double down on the specific hooks and content formats that actually generate revenue.',
        actionLink: '/reports',
        actionText: 'Open CMO Reports'
      }
    ],
    keyTakeaways: [
      'First-party UTM tracking eliminates attribution blind spots across all social channels.',
      'Native OAuth integrations publish text, images, and carousels with zero manual copy-pasting.',
      'Weekly reports connect social reach directly to business pipeline and trial conversions.'
    ],
    faqs: [
      {
        question: 'Does Moyi support scheduling for multiple time zones?',
        answer: 'Yes! The content calendar automatically schedules posts in your project\'s configured target time zone.'
      },
      {
        question: 'Can I edit a scheduled post before it goes live?',
        answer: 'Yes. In the Content Calendar, click any scheduled post to edit text, swap images, change the scheduled time, or cancel publication.'
      }
    ],
    nextTutorial: {
      slug: 'competitor-war-room-battlecards',
      title: 'Competitor War Room: Monitoring Competitors & Winning "vs" Keywords'
    }
  },
  'competitor-war-room-battlecards': {
    slug: 'competitor-war-room-battlecards',
    category: 'Competitive Strategy',
    readTime: '5 min read',
    difficulty: 'Advanced',
    title: 'Competitor War Room: Monitoring Competitors & Winning "vs" Keywords',
    seoTitle: 'How to Use Competitor War Room & Comparison Pages in Moyi (Tutorial)',
    seoDescription: 'Learn how to monitor competitor landing page updates, uncover keyword gaps, and publish high-converting "vs" comparison pages.',
    heroHeadline: 'How to Monitor Competitors & Win High-Intent "vs" Search Queries',
    heroSubheadline: 'Turn competitor research into actionable BOFU comparison pages and feature matrices that convert consideration-stage searchers.',
    summary: 'When prospects search for "[Competitor A] vs [Competitor B]" or "[Competitor] alternatives", they are at the bottom of the funnel and ready to buy. Moyi\'s Competitor War Room crawls rival websites, tracks messaging shifts, and generates balanced, high-converting comparison battlecards.',
    prerequisites: [
      'A list of 2 to 5 primary competitors in your industry',
      'A calibrated Moyi project workspace'
    ],
    steps: [
      {
        number: 1,
        title: 'Add Competitors to Project Calibration',
        instruction: 'Navigate to Project Settings > Calibration. In the "Competitors" field, enter the website URLs of your primary rivals (one per line). Click "Save Calibration".',
        proTip: 'Include both established market leaders and emerging startup competitors for a complete market picture.',
        actionLink: '/projects',
        actionText: 'Edit Competitors'
      },
      {
        number: 2,
        title: 'Launch Automated Competitor Discovery',
        instruction: 'Moyi runs factual crawl diagnostics across competitor public landing pages, pricing tables, and meta tags to build an objective feature comparison matrix.',
        proTip: 'Moyi strictly analyzes public website facts, ensuring compliance with ethical data standards.',
        actionLink: null,
        actionText: null
      },
      {
        number: 3,
        title: 'Accept the "Competitor Comparison Brief" Recommendation',
        instruction: 'Open the Recommendations tab. Look for the "Competitor Comparison Page" card. Review the detected feature differentiators and click "Accept Recommendation".',
        proTip: 'Accepting the recommendation automatically generates an outline in Content Studio based on MECLABS conversion heuristics.',
        actionLink: '/dashboard',
        actionText: 'View Recommendations'
      },
      {
        number: 4,
        title: 'Review the Drafted "vs" Comparison Article',
        instruction: 'In Content Studio, review the drafted comparison page. Moyi structures the content with: (1) Executive Summary, (2) Feature-by-Feature Matrix, (3) Key Differentiators, (4) Ideal Use Cases, and (5) FAQ Accordion with JSON-LD schema.',
        proTip: 'Keep tone objective and factual. Highlighting where a competitor excels builds credibility and increases conversion rates for your ideal use cases.',
        actionLink: '/compare/moyi-vs-ahrefs',
        actionText: 'View Comparison Example'
      },
      {
        number: 5,
        title: 'Publish to Your CMS or Export for Webflow/WordPress',
        instruction: 'Approve the final comparison draft. Use Moyi\'s 1-click CMS integration (WordPress, Webflow, Shopify) or export clean Markdown / HTML with schema markup ready to rank.',
        proTip: 'Add internal links from your footer and pricing page to help search engines index your new comparison assets quickly.',
        actionLink: null,
        actionText: null
      }
    ],
    keyTakeaways: [
      'Comparison and alternatives search queries possess the highest conversion rates in SaaS marketing.',
      'Objective, factual comparison matrices build buyer trust faster than biased sales copy.',
      'Automated competitor monitoring ensures your feature matrices always reflect current pricing and capabilities.'
    ],
    faqs: [
      {
        question: 'Will creating comparison pages violate any trademark laws?',
        answer: 'In most jurisdictions (including US and EU), factual comparative advertising and nominative fair use are legally protected as long as statements are truthful and non-deceptive.'
      },
      {
        question: 'How do I optimize comparison pages for Google Rich Snippets?',
        answer: 'Moyi automatically includes Product, FAQPage, and Table JSON-LD structured data schema on all generated comparison templates.'
      }
    ],
    nextTutorial: {
      slug: 'customizing-brand-voice-governance',
      title: 'Customizing Brand Tone, Logo Safe Margins & Operator Approvals'
    }
  },
  'customizing-brand-voice-governance': {
    slug: 'customizing-brand-voice-governance',
    category: 'Brand & Governance',
    readTime: '4 min read',
    difficulty: 'Beginner',
    title: 'Customizing Brand Tone, Logo Safe Margins & Operator Approvals',
    seoTitle: 'How to Customize Brand Voice & Governance Rules in Moyi (Tutorial)',
    seoDescription: 'Configure custom brand voice guidelines, banned words, logo safe margins, and multi-tenant approval rules in Moyi-CMO.',
    heroHeadline: 'How to Customize Brand Tone, Voice Rules & Approval Workflows',
    heroSubheadline: 'Ensure every piece of AI-generated content sounds authentically like your brand while enforcing strict human approval gates.',
    summary: 'AI tools often sound generic and robotic. Moyi solves this with deeply customizable brand calibration: define your unique voice pillars, ban AI clichés, configure logo safe-space padding, and assign operator review roles so nothing publishes without human consent.',
    prerequisites: [
      'Admin access to your Moyi workspace',
      'Your company brand guidelines or voice descriptors'
    ],
    steps: [
      {
        number: 1,
        title: 'Configure Your Core Brand Tone Pillars',
        instruction: 'Go to Project Settings > Calibration. Set your primary brand tone using 2 to 3 descriptive anchors (e.g. "Direct, Technical, and Energetic" or "Understated, Academic, and Authoritative").',
        proTip: 'Avoid vague terms like "Professional". Instead, use concrete adjectives like "Pragmatic B2B Practitioner".',
        actionLink: '/projects',
        actionText: 'Configure Brand Tone'
      },
      {
        number: 2,
        title: 'Add Banned Words & AI Cliché Filters',
        instruction: 'In the Voice Guardrails section, specify words and phrases Moyi must never use (e.g. "In today\'s fast-paced digital world", "delve", "game-changer", "unleash", "synergy").',
        proTip: 'Moyi has built-in anti-hallucination guardrails, but adding industry-specific jargon bans keeps copy exceptionally sharp.',
        actionLink: null,
        actionText: null
      },
      {
        number: 3,
        title: 'Configure Logo Margins & Visual Brand Space',
        instruction: 'Under Brand Assets, set your logo positioning (Top-Left, Top-Right, or Bottom-Right) and margin padding (16px, 24px, 32px) to ensure proper visual breathing room on all generated graphics.',
        proTip: 'Use a transparent PNG with no baked-in white background for seamless integration on dark and light themes.',
        actionLink: null,
        actionText: null
      },
      {
        number: 4,
        title: 'Set Up Team Member Roles & Approval Permissions',
        instruction: 'In Organizations > Team Members, invite collaborators and assign roles: Admin (can calibrate brand, connect integrations, and approve/publish) or Content Contributor (can draft copy and generate visuals).',
        proTip: 'Separating drafting roles from publishing permissions ensures strict compliance in agency and enterprise settings.',
        actionLink: '/account',
        actionText: 'Manage Team Roles'
      },
      {
        number: 5,
        title: 'Test Your Calibration with a Quick Test Generation',
        instruction: 'Open Content Studio and click "Generate Sample Post". Review the output to verify that your voice guidelines, banned words, and logo formatting are faithfully applied.',
        proTip: 'You can refine calibration rules at any time without affecting previously approved assets.',
        actionLink: '/dashboard',
        actionText: 'Test in Content Studio'
      }
    ],
    keyTakeaways: [
      'Explicit tone pillars and banned word lists prevent generic "AI-sounding" output.',
      'Role-based permissions allow junior writers to draft while senior operators retain approval authority.',
      'Multi-tenant data isolation ensures your custom voice rules and brand data are never shared or leaked.'
    ],
    faqs: [
      {
        question: 'Can I have different brand voices for different projects?',
        answer: 'Yes. Each project workspace has completely isolated calibration settings, brand assets, and tone rules.'
      },
      {
        question: 'Can team members publish directly without admin approval?',
        answer: 'Only users with the Admin or Operator role have publishing permissions. Contributors can create and edit drafts, but cannot schedule or publish.'
      }
    ],
    nextTutorial: {
      slug: 'connecting-google-search-console',
      title: 'Connecting Google Search Console & Launching Your 1st Audit'
    }
  }
};

module.exports = {
  TUTORIAL_PAGES
};
