const COMPARISON_PAGES = {
  'moyi-vs-ahrefs': {
    slug: 'moyi-vs-ahrefs',
    competitorName: 'Ahrefs',
    title: 'Moyi vs Ahrefs: AI Execution vs SEO Dashboards',
    metaDescription: 'Compare Moyi AI CMO with Ahrefs. Modern growth teams choose autonomous content generation and multi-channel publishing over manual keyword dashboards.',
    heroBadge: 'Head-to-Head Comparison',
    heroHeadline: 'Moyi vs Ahrefs: From Raw SEO Data to Autonomous Execution',
    heroSubheadline: 'Ahrefs shows you what keywords exist. Moyi actually writes the direct-response content, creates the visual assets, and publishes directly to your CMS and social channels in one click.',
    coreSummary: 'Ahrefs is a legacy SEO database tool built for full-time SEO analysts who have 20+ hours a week to research keywords manually. Moyi is an autonomous AI CMO built for founders and growth teams who want ranking articles, visual brand assets, and multi-channel social distribution executed automatically with zero agency overhead.',
    keyDifferentiators: [
      {
        title: 'Autonomous Writing vs Manual Spreadsheets',
        description: 'Ahrefs gives you lists of search volume numbers. Moyi mines your Google Search Console queries and writes complete, high-intent BOFU articles with PAS/AIDA conversion hooks.'
      },
      {
        title: '1-Click Omni-Channel Social Publishing',
        description: 'Ahrefs has zero social media publishing. Moyi connects directly to LinkedIn, X, Meta (Facebook & Instagram), Bluesky, TikTok, YouTube, and Threads with built-in human approval gates.'
      },
      {
        title: 'Automated DALL-E Brand Visual Studio',
        description: 'Moyi automatically designs on-brand promotional flyers with your official logo overlay ready for social distribution.'
      },
      {
        title: '10x Cost Efficiency',
        description: 'Ahrefs charges $99 to $999/mo just for search graphs. Moyi provides a complete AI CMO, crawler, writer, and distributor starting at €49/mo.'
      }
    ],
    comparisonTable: [
      { feature: 'Autonomous Article Generation (TOFU, MOFU, BOFU)', moyi: 'Yes (PAS, AIDA, BAB)', competitor: 'No (Data only)' },
      { feature: 'Google Search Console Keyword Mining', moyi: 'Yes (Live Automated)', competitor: 'Yes (Manual GSC sync)' },
      { feature: '1-Click Social Media Publishing (LinkedIn, X, Meta)', moyi: 'Yes (8 Platforms)', competitor: 'No' },
      { feature: 'Direct CMS Publishing (WordPress, Webflow, Shopify)', moyi: 'Yes (Native)', competitor: 'No' },
      { feature: 'AI Brand Graphic Studio with Logo Watermark', moyi: 'Yes (DALL-E 3)', competitor: 'No' },
      { feature: 'Weekly & Monthly Executive CMO Reports', moyi: 'Yes (Automated)', competitor: 'No (Manual exports)' },
      { feature: 'Human-in-the-Loop Approval Workflow', moyi: 'Yes', competitor: 'N/A' },
      { feature: 'Starting Price', moyi: '€49 / month', competitor: '$99 / month' }
    ],
    faqList: [
      {
        question: 'Can I use Moyi alongside Ahrefs?',
        answer: 'Yes! While Moyi includes its own deep technical crawler and Google Search Console keyword miner, you can use Moyi as the autonomous execution engine that turns any SEO strategy into live published content.'
      },
      {
        question: 'Does Moyi generate generic AI fluff?',
        answer: 'No. Moyi enforces strict content rules, evidence constraints, and direct-response conversion frameworks (Problem-Agitate-Solve, Before-After-Bridge) grounded directly in your domain\'s observable crawl data.'
      },
      {
        question: 'Do I need technical skills to connect my CMS or social media?',
        answer: 'None at all. Moyi uses 1-click OAuth authentication for social platforms and simple API tokens for WordPress, Webflow, and Shopify.'
      }
    ],
    ctaHeadline: 'Ready to Replace Manual Spreadsheets with an AI CMO?',
    ctaSubheadline: 'Start your 30-day growth engine today. No credit card required to run your first technical audit.',
    ctaText: 'Start Free Growth Audit'
  },
  'moyi-vs-hootsuite': {
    slug: 'moyi-vs-hootsuite',
    competitorName: 'Hootsuite',
    title: 'Moyi vs Hootsuite: Social Scheduler vs AI CMO',
    metaDescription: 'Compare Moyi AI CMO with Hootsuite. Discover why growth teams choose an autonomous AI CMO over expensive manual calendar tools.',
    heroBadge: 'Platform Comparison',
    heroHeadline: 'Moyi vs Hootsuite: Why Schedule an Empty Calendar When AI Can Run It?',
    heroSubheadline: 'Hootsuite charges $99/mo for an empty calendar you have to fill out yourself. Moyi mines your high-intent search data, writes the copy, generates the graphics, and schedules high-converting posts autonomously.',
    coreSummary: 'Hootsuite is a legacy social scheduling tool from 2008 that requires a full-time social media manager to write copy, create images, and upload posts manually. Moyi combines deep SEO research, direct-response copywriting, DALL-E image generation, and multi-channel publishing into one unified autonomous AI CMO.',
    keyDifferentiators: [
      {
        title: 'Strategy & Content Creation vs Empty Boxes',
        description: 'Hootsuite provides a blank calendar. Moyi analyzes your brand, extracts customer personas, and drafts high-converting posts automatically.'
      },
      {
        title: 'Integrated SEO & Organic Search Growth',
        description: 'Hootsuite has zero SEO capabilities. Moyi audits your website, identifies technical blockers, and targets keyword gaps that drive high-intent buyers.'
      },
      {
        title: 'Full CMS Integration',
        description: 'Moyi publishes approved blog articles directly to WordPress, Webflow, and Shopify, bridging the gap between website SEO and social thought leadership.'
      },
      {
        title: 'Fair, Transparent Pricing',
        description: 'Hootsuite starts at $99/mo with strict user limits. Moyi includes full SEO, copywriting, image generation, and social publishing starting at €49/mo.'
      }
    ],
    comparisonTable: [
      { feature: 'Autonomous Copywriting & Post Drafting', moyi: 'Yes (AI CMO)', competitor: 'No (Manual input)' },
      { feature: 'Deep SEO Crawling & Technical Audits', moyi: 'Yes (Built-in)', competitor: 'No' },
      { feature: 'Multi-Channel Social Distribution', moyi: 'Yes (8 Platforms)', competitor: 'Yes' },
      { feature: 'CMS Blog Publishing (WordPress/Webflow/Shopify)', moyi: 'Yes', competitor: 'No' },
      { feature: 'AI Image Studio with Logo Watermark', moyi: 'Yes (Built-in)', competitor: 'No (External tools needed)' },
      { feature: 'Google Search Console Integration', moyi: 'Yes', competitor: 'No' },
      { feature: 'Human-in-the-Loop Governance Queue', moyi: 'Yes', competitor: 'Yes (Enterprise plan only)' },
      { feature: 'Starting Price', moyi: '€49 / month', competitor: '$99 / month' }
    ],
    faqList: [
      {
        question: 'Does Moyi support multi-platform posting like Hootsuite?',
        answer: 'Yes! Moyi supports 1-click publishing to LinkedIn, X (Twitter), Facebook Pages, Instagram Business/Creator, Bluesky, TikTok, YouTube, and Threads.'
      },
      {
        question: 'Can I review and edit posts before they go live?',
        answer: 'Yes! Moyi enforces a mandatory Human-in-the-Loop approval gate. Nothing is published until you review and approve the draft in your Content Calendar or Studio.'
      }
    ],
    ctaHeadline: 'Stop Paying for Empty Calendars. Get an AI CMO.',
    ctaSubheadline: 'Join hundreds of high-growth founders scaling organic traffic with Moyi.',
    ctaText: 'Launch Your AI CMO'
  }
};

const SOLUTION_PAGES = {
  'ai-cmo-for-ecommerce': {
    slug: 'ai-cmo-for-ecommerce',
    title: 'Autonomous AI CMO for E-Commerce & Shopify',
    metaDescription: 'Scale your store with an autonomous AI CMO. Automate Shopify blog posts, high-converting social flyers, and organic search rankings in one click.',
    heroBadge: 'E-Commerce Growth Engine',
    heroHeadline: 'The All-In-One AI CMO Built for High-Volume E-Commerce Brands',
    heroSubheadline: 'Turn your Shopify catalog into ranking SEO articles, viral social graphics, and multi-channel promotional campaigns with 1-click execution.',
    coreSummary: 'E-commerce founders spend up to 15 hours a week trying to rank product pages and posting manually on Instagram and Facebook. Moyi acts as your dedicated 24/7 Chief Marketing Officer—crawling your store for SEO issues, crafting direct-response blog articles that rank for buyer-intent keywords, and generating on-brand product flyers with your logo.',
    benefits: [
      {
        title: 'Direct Shopify CMS Publishing',
        description: 'Push SEO-optimized buying guides, product reviews, and comparison articles directly to your Shopify blog with 1 click.'
      },
      {
        title: 'Multi-Channel Instagram & Facebook Distribution',
        description: 'Engage shoppers across Meta, TikTok, and X with automated visual flyers and high-converting product hooks.'
      },
      {
        title: 'Technical E-Commerce SEO Auditing',
        description: 'Detect missing meta tags, broken product schema, and slow crawl assets before they hurt your search rankings.'
      }
    ],
    faqList: [
      {
        question: 'How does Moyi connect to Shopify?',
        answer: 'Moyi integrates directly via secure Shopify Admin API tokens, allowing seamless blog publishing and automated product content distribution.'
      },
      {
        question: 'Can Moyi generate images matching my brand aesthetic?',
        answer: 'Yes. Moyi includes custom brand color styling, font consistency rules, and automatic logo watermark overlays on every generated flyer.'
      }
    ],
    ctaHeadline: 'Scale Your E-Commerce Store\'s Organic Traffic',
    ctaSubheadline: 'Start your automated e-commerce marketing engine in under 60 seconds.',
    ctaText: 'Start E-Commerce Audit'
  },
  'ai-cmo-for-b2b-saas': {
    slug: 'ai-cmo-for-b2b-saas',
    title: 'Autonomous AI CMO for B2B SaaS & Startups',
    metaDescription: 'Scale organic search and LinkedIn thought leadership for B2B SaaS. Moyi mines Search Console data and publishes high-converting BOFU content.',
    heroBadge: 'B2B SaaS Growth Engine',
    heroHeadline: 'Autonomous SEO Strategy & Thought Leadership Publishing for B2B SaaS',
    heroSubheadline: 'Stop relying on expensive $10k/mo agency retainers. Get high-intent comparison pages, technical SEO fixes, and executive LinkedIn thought leadership executed automatically.',
    coreSummary: 'B2B SaaS buyers don\'t convert on generic fluff—they search for competitor comparisons, integration guides, and specific solutions to workflow bottlenecks. Moyi mines your domain\'s Google Search Console data, builds targeted BOFU outlines, and distributes thought leadership copy across LinkedIn and Webflow.',
    benefits: [
      {
        title: 'Bottom-of-Funnel (BOFU) Comparison Engine',
        description: 'Target high-intent decision makers searching for alternatives and competitor comparisons with evidence-backed copy.'
      },
      {
        title: 'LinkedIn Authority & Executive Ghostwriting',
        description: 'Publish authoritative, insight-driven B2B posts directly to company pages and executive profiles.'
      },
      {
        title: 'Webflow & WordPress Native Sync',
        description: 'Publish ranking technical guides and case studies directly to your SaaS marketing site without developer bottlenecks.'
      }
    ],
    faqList: [
      {
        question: 'Is the content tailored for technical B2B audiences?',
        answer: 'Yes. Moyi uses direct-response frameworks (PAS, BAB) and strict evidence constraints that cite real technical facts and domain telemetry without hallucinating.'
      },
      {
        question: 'Can my team review drafts before publishing?',
        answer: 'Always. Moyi provides a complete Human-in-the-Loop Content Studio where marketing managers can edit, adjust tone, and approve with 1 click.'
      }
    ],
    ctaHeadline: 'Accelerate Your B2B SaaS Pipeline with an AI CMO',
    ctaSubheadline: 'Eliminate agency retainers and unlock predictable organic pipeline.',
    ctaText: 'Start B2B SaaS Audit'
  }
};

module.exports = {
  COMPARISON_PAGES,
  SOLUTION_PAGES
};
