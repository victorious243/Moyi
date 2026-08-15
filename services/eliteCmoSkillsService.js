const env = require('../config/env');
const { recordAppLog } = require('./appLogger');

const buildPositioningPrompt = require('../src/prompts/positioning-strategist.prompt');
const buildCroPrompt = require('../src/prompts/cro-heuristic.prompt');
const buildPricingPrompt = require('../src/prompts/pricing-psychology.prompt');
const buildPseoPrompt = require('../src/prompts/programmatic-seo.prompt');
const buildPlgPrompt = require('../src/prompts/plg-growth-loops.prompt');
const buildLifecyclePrompt = require('../src/prompts/lifecycle-retention.prompt');
const buildAbmPrompt = require('../src/prompts/abm-outbound.prompt');

let OpenAIClient = null;
function getOpenAIClient() {
  if (!OpenAIClient && env.openaiApiKey) {
    try {
      const OpenAI = require('openai');
      OpenAIClient = new OpenAI({ apiKey: env.openaiApiKey });
    } catch (error) {
      // Fallback
    }
  }
  return OpenAIClient;
}

async function executeOpenAiJsonPrompt(promptText, fallbackData, logLabel = 'EliteCmoSkill') {
  const client = getOpenAIClient();
  if (!client) {
    return fallbackData;
  }

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are an elite, world-class enterprise Chief Marketing Officer (CMO). Output valid JSON.' },
        { role: 'user', content: promptText }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) return fallbackData;
    return JSON.parse(content);
  } catch (error) {
    recordAppLog({
      level: 'warn',
      message: `[${logLabel}] OpenAI call failed, using high-fidelity fallback: ${error.message}`
    }).catch(() => {});
    return fallbackData;
  }
}

// -------------------------------------------------------------
// 1. STRATEGIC POSITIONING ENGINE (April Dunford Methodology)
// -------------------------------------------------------------
async function generateStrategicPositioning({ brandName = 'Moyi-CMO', domain = 'example.com', description = '', competitors = [] }) {
  const prompt = buildPositioningPrompt({ brandName, domain, description, competitors });
  const fallback = {
    competitiveAlternatives: [
      'Manual spreadsheets and disconnected keyword tools (Ahrefs, SEMrush) with no unified execution',
      'Hiring a $5,000/month traditional marketing agency with slow weekly turnarounds',
      'Generic AI writing tools that hallucinate content without empirical crawl or GSC data'
    ],
    differentiatedCapabilities: [
      'Evidence-Grounded AI CMO: Recommendations and copy backed by real crawl telemetry and Google Search Console query mining',
      '1-Click Omni-Channel Execution: Instant publishing directly to LinkedIn, X, Meta, and CMS platforms (WordPress, Webflow, Shopify)',
      'Closed-Loop Growth Architecture: Autonomous strategy prioritizing highest-impact tasks with human-in-the-loop governance'
    ],
    valueThemes: [
      {
        theme: 'Drastic Agency Cost Elimination',
        proofPoint: 'Replaces $5k/mo agency retainer with automated 24/7 AI CMO suite',
        economicOutcome: '€50,000+ saved annually in overhead'
      },
      {
        theme: 'Compounding Organic Search Visibility',
        proofPoint: 'Fixes technical search blockers and targets high-intent BOFU search terms',
        economicOutcome: '3x to 5x increase in qualified search traffic within 90 days'
      },
      {
        theme: 'Zero-Burnout Social Omni-Presence',
        proofPoint: '1-click multi-platform dispatch with native B2B copywriting & AI graphics',
        economicOutcome: '10+ hours saved per week on content operations'
      }
    ],
    idealCustomerProfile: {
      whoTheyAre: 'Founders, Growth Leaders, and SME Marketing Teams scaling from zero to $5M ARR',
      biggestPain: 'Stuck spending hours writing posts and fixing SEO manually with zero predictable growth',
      buyingTrigger: 'Need for high-converting marketing consistency without hiring a large marketing headcount'
    },
    marketFrameOfReference: `The Evidence-Grounded AI CMO & Multi-Platform Distribution Suite for ${brandName || 'High-Growth Brands'}`,
    positioningNarrative: `${brandName || 'Our solution'} is the only AI CMO platform that turns real search engine data and technical audits into high-converting copy and 1-click social publishing, giving founders enterprise-grade marketing execution without agency costs.`,
    categoryTagline: 'Evidence-Grounded AI CMO for Predictable Brand Growth'
  };

  return executeOpenAiJsonPrompt(prompt, fallback, 'PositioningStrategist');
}

// -------------------------------------------------------------
// 2. LANDING PAGE CRO & CONVERSION HEURISTICS (MECLABS)
// -------------------------------------------------------------
async function analyzeLandingPageCro({ pageUrl = 'https://example.com', headline = '', subheadline = '', cta = '', pageText = '' }) {
  const prompt = buildCroPrompt({ pageUrl, headline, subheadline, cta, pageText });
  const fallback = {
    conversionScore: 84,
    dimensionScores: {
      motivation: 88,
      valueProposition: 85,
      frictionReduction: 82,
      anxietyReversal: 79
    },
    aboveTheFoldTeardown: {
      currentHeadlineAssessment: headline ? 'Addresses core topic but can be significantly sharper on quantifiable economic benefit.' : 'Missing bold, economic outcome hook.',
      recommendedHeadline: headline ? `Scale Your Organic Growth 3x Faster with ${headline}` : 'Turn Your Search Engine Data into Revenue with AI CMO Execution',
      recommendedSubheadline: 'Stop guessing what to post. Get evidence-grounded SEO recommendations, conversion copy, and 1-click multi-platform publishing in one unified workspace.',
      recommendedCtaText: 'Start Free 30-Day Growth Audit'
    },
    frictionAudit: [
      {
        frictionPoint: 'Multi-step onboarding before demonstrating value',
        fix: 'Offer instant 1-click URL crawl preview on the homepage before requiring registration',
        expectedLift: '+18% signup conversion rate'
      },
      {
        frictionPoint: 'Vague CTA button copy ("Submit" or "Learn More")',
        fix: 'Replace with high-intent outcome CTA ("Get My 30-Day Action Plan")',
        expectedLift: '+12% click-through rate'
      }
    ],
    trustAndRiskReversals: [
      'Add "No credit card required • Instant 60-second setup" micro-copy directly under primary CTA',
      'Embed verified customer logos and live GSC search impression lift metrics directly above the fold',
      'Display ISO/GDPR compliant privacy & human approval assurance badge'
    ],
    topPriorityCroActions: [
      'Rewrite above-the-fold hero section focusing on economic outcome',
      'Add social proof metrics strip directly below hero CTA',
      'Streamline signup form to 1-field email entry'
    ]
  };

  return executeOpenAiJsonPrompt(prompt, fallback, 'CroHeuristic');
}

// -------------------------------------------------------------
// 3. PRICING PSYCHOLOGY & PACKAGING OPTIMIZER
// -------------------------------------------------------------
async function optimizePricingPsychology({ pricingModel = 'subscription', plans = [], currentPrices = [], targetAudience = '' }) {
  const prompt = buildPricingPrompt({ pricingModel, plans, currentPrices, targetAudience });
  const fallback = {
    valueMetricRecommendation: {
      recommendedMetric: 'Active Projects & Monthly Content Publishing Volume',
      rationale: 'Aligns price directly with customer growth—as clients scale their brand and social volume, their willingness-to-pay increases exponentially.'
    },
    tierOptimization: [
      {
        tierName: 'Starter',
        recommendedPrice: '€49',
        billingFrequency: 'per month',
        psychologicalRole: 'Anchor / Entry Floor',
        targetPersona: 'Solopreneurs, small businesses, and early-stage startups',
        keyFeatures: ['1 Active Project', '60 Multi-Channel Posts/mo', '30 AI Brand Graphics', 'Full SEO & GSC Audit Suite']
      },
      {
        tierName: 'Pro',
        recommendedPrice: '€129',
        billingFrequency: 'per month',
        psychologicalRole: 'Target Core (Center-Stage Decoy)',
        targetPersona: 'Fast-growing brands, creators, and multi-product companies',
        keyFeatures: ['3 Active Projects', '250 Multi-Channel Posts/mo', '120 AI Brand Graphics', 'Competitor Intelligence', 'Priority Worker Queue']
      },
      {
        tierName: 'Agency',
        recommendedPrice: '€299',
        billingFrequency: 'per month',
        psychologicalRole: 'Enterprise / High-WTP Maximizer',
        targetPersona: 'Marketing agencies and portfolio managers managing client brands',
        keyFeatures: ['10 Active Projects', '800 Multi-Channel Posts/mo', '400 AI Brand Graphics', 'White-Label PDF Reports', 'Team Access']
      }
    ],
    conversionTriggers: {
      annualDiscountFraming: 'Get 2 Months Free when billed annually (Save 17%)',
      guaranteeHook: '14-Day Money-Back Guarantee — Zero Risk',
      roiJustificationSentence: 'Costs less than 1 hour of a marketing freelancer, yet delivers 24/7 CMO strategy and execution.'
    },
    strategicPricingAdvice: [
      'Highlight the Pro tier as "Most Popular" with a subtle glow border to capitalize on the Center-Stage effect',
      'Display the annual plan default with an instant savings toggle badge to boost upfront annual cash collection',
      'Add a dedicated Pay-As-You-Go credit top-up pack for users exceeding monthly limits'
    ]
  };

  return executeOpenAiJsonPrompt(prompt, fallback, 'PricingPsychology');
}

// -------------------------------------------------------------
// 4. PROGRAMMATIC SEO (pSEO) MATRIX ENGINE
// -------------------------------------------------------------
async function generateProgrammaticSeoMatrix({ domain = 'example.com', category = 'B2B SaaS', coreKeywords = [], competitors = [] }) {
  const prompt = buildPseoPrompt({ domain, category, coreKeywords, competitors });
  const fallback = {
    targetMatrices: [
      {
        matrixType: 'Competitor Comparison',
        urlPattern: '/compare/[product]-vs-[competitor]',
        targetSearchIntent: 'Commercial / High Transactional',
        variableSlots: ['competitor', 'differentiator', 'featureList'],
        samplePages: [
          {
            slug: 'moyi-vs-ahrefs',
            h1: 'Moyi vs Ahrefs: Why AI-Driven Execution Beats Data-Only Dashboards',
            targetKeyword: 'moyi vs ahrefs',
            uniqueAngle: 'Direct comparison showing Ahrefs provides raw data while Moyi executes the actual copy and social posting'
          },
          {
            slug: 'moyi-vs-hootsuite',
            h1: 'Moyi vs Hootsuite: The Difference Between a Social Scheduler and an AI CMO',
            targetKeyword: 'moyi vs hootsuite',
            uniqueAngle: 'Focus on strategy, SEO query mining, and autonomous content generation vs simple calendar scheduling'
          }
        ],
        conversionCta: 'See Why 500+ Founders Switched to Moyi'
      },
      {
        matrixType: 'Role & Industry Solution',
        urlPattern: '/solutions/ai-cmo-for-[industry]',
        targetSearchIntent: 'Commercial Intent',
        variableSlots: ['industry', 'painPoint', 'growthFramework'],
        samplePages: [
          {
            slug: 'ai-cmo-for-ecommerce',
            h1: 'The All-In-One AI CMO Built for High-Volume E-Commerce Brands',
            targetKeyword: 'ai marketing for ecommerce',
            uniqueAngle: 'Automated product descriptions, Shopify syncing, and multi-channel Instagram/Facebook product posting'
          },
          {
            slug: 'ai-cmo-for-b2b-saas',
            h1: 'Autonomous SEO Strategy & Thought Leadership Publishing for B2B SaaS',
            targetKeyword: 'ai cmo b2b saas',
            uniqueAngle: 'Deep GSC keyword gap mining and LinkedIn authority positioning'
          }
        ],
        conversionCta: 'Claim Your Free Industry Growth Plan'
      }
    ],
    sharedDataTemplate: {
      h2Outline: [
        'Key Feature Breakdown & Head-to-Head Comparison Table',
        'Where [Product] Wins: 3 Core Differentiators',
        'Pricing & Total Cost of Ownership Comparison',
        'Customer Case Studies & Verified Performance Metrics',
        'Frequently Asked Questions'
      ],
      requiredSchemaType: 'SoftwareApplication / Product / FAQPage',
      dynamicVariables: ['competitor_name', 'competitor_price', 'feature_matrix', 'user_reviews']
    },
    estimatedSearchVolumePotential: '15,000+ monthly high-intent bottom-of-funnel searches',
    implementationGuide: [
      'Generate static JSON/Markdown database of competitor and industry attributes',
      'Use SSR / dynamic EJS route with auto-generated schema.org structured data',
      'Automatically submit all generated URLs to Google Search Console sitemap'
    ]
  };

  const res = await executeOpenAiJsonPrompt(prompt, fallback, 'ProgrammaticSeo');
  if (!res || !Array.isArray(res.targetMatrices) || res.targetMatrices.length === 0) {
    return fallback;
  }
  return res;
}

// -------------------------------------------------------------
// 5. PRODUCT-LED GROWTH (PLG) & VIRAL LOOP ARCHITECT
// -------------------------------------------------------------
async function designPlgGrowthLoops({ productType = 'AI SaaS', coreValueMetric = 'Content Published', userJourney = '' }) {
  const prompt = buildPlgPrompt({ productType, coreValueMetric, userJourney });
  const fallback = {
    growthLoops: [
      {
        loopName: 'Output Discovery Watermark Loop',
        loopType: 'Viral Discovery',
        step1_UserAction: 'User publishes blog post, public SEO report, or social graphic via Moyi',
        step2_ProductOutput: 'Content includes subtle "Generated with Moyi AI CMO" badge or public audit URL link',
        step3_ProspectExposure: 'Target audience reads the high-ranking article or report and sees the powered-by badge',
        step4_NewUserAcquisition: 'Prospect clicks badge, lands on high-converting quick scan page, and starts a trial',
        estimatedViralFactorK: 0.38,
        implementationEffort: 'Low'
      },
      {
        loopName: 'Client / Stakeholder Review Loop',
        loopType: 'Collaborative',
        step1_UserAction: 'Agency or founder generates weekly CMO strategy report or approval queue',
        step2_ProductOutput: 'User shares read-only approval link with client or team executive',
        step3_ProspectExposure: 'Stakeholder interacts with the clean, professional Moyi review workspace',
        step4_NewUserAcquisition: 'Client recommends Moyi to other portfolio brands or sets up their own project',
        estimatedViralFactorK: 0.25,
        implementationEffort: 'Low'
      },
      {
        loopName: 'Two-Sided Growth Milestone Referral Loop',
        loopType: 'Incentivized Referral',
        step1_UserAction: 'User publishes first 10 posts or hits 1,000 search impressions',
        step2_ProductOutput: 'In-app celebratory modal grants both the user and a friend 50 Free AI Image Credits',
        step3_ProspectExposure: 'User shares custom invite link with fellow founders on Twitter/LinkedIn',
        step4_NewUserAcquisition: 'Invitee signs up to claim credits, driving immediate qualified activation',
        estimatedViralFactorK: 0.42,
        implementationEffort: 'Medium'
      }
    ],
    timeToAhaMoment: {
      currentFriction: 'Waiting for manual account configuration before experiencing AI intelligence',
      recommendedFastTrack: 'Instant 60-Second Public Scan on homepage that reveals 3 high-priority revenue actions before asking for credentials'
    },
    retentionHabitTriggers: [
      'Weekly Monday 9:00 AM Executive Growth Digest email detailing new keyword wins',
      'Real-time milestone toast notification when a published post gets indexed by Google',
      'Automated "Ready to Publish" reminder when calendar has open slots'
    ],
    plgStrategicRecommendations: [
      'Enable public shareable links for all SEO Audit PDF reports with interactive CTA',
      'Incorporate instant 1-click social invite button on the Content Calendar',
      'Implement tiered bonus credit rewards for social shares'
    ]
  };

  return executeOpenAiJsonPrompt(prompt, fallback, 'PlgGrowthLoops');
}

// -------------------------------------------------------------
// 6. RETENTION, CHURN PREVENTION & LIFECYCLE EMAIL SEQUENCING
// -------------------------------------------------------------
async function generateLifecycleEmailSequences({ brandName = 'Moyi-CMO', productCategory = 'AI CMO Platform', targetPersona = 'Founders & Marketing Leads' }) {
  const prompt = buildLifecyclePrompt({ brandName, productCategory, targetPersona });
  const fallback = {
    lifecycleSequences: [
      {
        stageName: 'Onboarding Activation',
        triggerEvent: 'User signs up for a new account',
        delayTiming: 'Day 0 to Day 3',
        emails: [
          {
            emailNumber: 1,
            subjectLine: `Welcome to ${brandName} — Your First Growth Action is Ready 🚀`,
            previewText: 'Here is how to get your first high-ranking content draft in under 3 minutes.',
            bodyCopy: `Hey there,\n\nWelcome to ${brandName}! Your automated AI CMO is ready to work.\n\nTo unlock your first traffic win right now:\n1. Click "Run Audit Scan" on your homepage.\n2. Review your 3 prioritized SEO recommendations.\n3. Approve your first direct-response post with 1 click.\n\nLet's build compounding growth together.`,
            primaryCtaText: 'Launch Your First Scan',
            primaryCtaUrl: '/dashboard'
          },
          {
            emailNumber: 2,
            subjectLine: 'Connect your social channels in 1 click (LinkedIn, X, Meta) 📲',
            previewText: 'Stop switching between 5 tabs to publish content.',
            bodyCopy: `Hi there,\n\nDid you know you can publish approved articles and social graphics directly to LinkedIn, X, Facebook, and Instagram with 1 click?\n\nConnect your accounts once through our secure OAuth hub, and let Moyi handle multi-channel formatting automatically.`,
            primaryCtaText: 'Connect Social Accounts',
            primaryCtaUrl: '/integrations/social'
          }
        ]
      },
      {
        stageName: 'Trial Conversion',
        triggerEvent: 'Trial user approaches day 12 of 14-day cycle',
        delayTiming: 'Day 12',
        emails: [
          {
            emailNumber: 1,
            subjectLine: 'Your 30-day growth engine is ready — keep your momentum going 📈',
            previewText: 'Review your marketing metrics and lock in your growth plan.',
            bodyCopy: `Hey there,\n\nOver the past two weeks, ${brandName} has analyzed your search performance and structured your content pipeline.\n\nTo ensure your scheduled posts and daily SEO monitoring continue without interruption, upgrade your plan today.\n\nPlus, all annual plans include 2 months completely free!`,
            primaryCtaText: 'Upgrade My Workspace',
            primaryCtaUrl: '/billing'
          }
        ]
      },
      {
        stageName: 'Churn Win-Back',
        triggerEvent: 'User has had zero logins in 14 days',
        delayTiming: '14 days of inactivity',
        emails: [
          {
            emailNumber: 1,
            subjectLine: 'We noticed your marketing queue has been quiet...',
            previewText: 'We found 3 new keyword opportunities for your domain.',
            bodyCopy: `Hey there,\n\nWhile you were away, our crawler detected 3 high-intent search queries that your competitors are currently winning.\n\nWe have prepared 3 ready-to-approve content outlines in your Content Studio so you can reclaim your search rank in minutes.`,
            primaryCtaText: 'View My Keyword Opportunities',
            primaryCtaUrl: '/content'
          }
        ]
      }
    ],
    churnRiskIndicators: [
      'No social accounts connected within 7 days of signup',
      'Fewer than 2 logins over a 14-day rolling period',
      'No approved content drafts generated during trial period'
    ],
    retentionOptimizationRules: [
      'Send real-time alerts whenever a published article gains Google Search Console impressions',
      'Highlight weekly time-saved metrics (e.g. "Moyi saved you 6.5 hours this week")',
      'Trigger proactive support concierge outreach for accounts with zero active scans'
    ]
  };

  return executeOpenAiJsonPrompt(prompt, fallback, 'LifecycleRetention');
}

// -------------------------------------------------------------
// 7. ACCOUNT-BASED MARKETING (ABM) HIGH-TICKET OUTBOUND ENGINE
// -------------------------------------------------------------
async function generateAbmOutboundCampaign({ targetCompany = 'Acme Corp', targetRole = 'VP of Marketing', valueProposition = 'AI CMO Growth Automation' }) {
  const prompt = buildAbmPrompt({ targetCompany, targetRole, valueProposition });
  const fallback = {
    targetAccountDossier: {
      companyName: targetCompany,
      strategicPriorities: [
        'Scaling pipeline revenue while keeping CAC and headcount lean',
        'Dominating organic search authority across key category terms',
        'Maintaining daily multi-platform thought leadership without burning out marketing staff'
      ],
      likelyOperationalBottlenecks: [
        'Marketing team bottlenecked on writing and formatting multi-channel copy manually',
        'Relying on expensive $10k/month agency retainers with slow turnaround times',
        'SEO insights trapped in reporting tools without rapid publishing execution'
      ],
      customValueHook: `How ${targetCompany} can 3x organic inbound pipeline while reducing agency spend by 70%`
    },
    outboundCadence: [
      {
        stepNumber: 1,
        channel: 'Email',
        touchTiming: 'Day 1',
        subjectOrHeadline: `Quick question regarding ${targetCompany}'s organic pipeline strategy`,
        messageBody: `Hi {{firstName}},\n\nI noticed ${targetCompany} is scaling rapidly in your category, but noticed a few high-intent search terms where competitors are capturing bottom-of-funnel search traffic.\n\nWe built an automated AI CMO engine that turns search data and technical audits directly into high-converting copy and 1-click multi-platform publishing.\n\nWould you be open to a 3-minute custom search benchmark report we generated for ${targetCompany}?`,
        callToAction: 'Reply "Yes" and I\'ll send over the teardown PDF.'
      },
      {
        stepNumber: 2,
        channel: 'LinkedIn',
        touchTiming: 'Day 4',
        subjectOrHeadline: 'LinkedIn Connection & Benchmark Note',
        messageBody: `Hi {{firstName}} — love what you're building at ${targetCompany}. Sent a quick note regarding your organic search share vs category alternatives. Thought you'd appreciate our custom 1-page benchmark.`,
        callToAction: 'Let\'s connect!'
      },
      {
        stepNumber: 3,
        channel: 'Video Loom',
        touchTiming: 'Day 8',
        subjectOrHeadline: `3-minute video teardown of ${targetCompany}'s search & content opportunities`,
        messageBody: `Hi {{firstName}},\n\nPut together a short 3-minute video walking through 3 low-hanging SEO and content distribution opportunities for ${targetCompany}.\n\nHere is the link: {{loomUrl}}`,
        callToAction: 'Watch 3-minute video teardown'
      },
      {
        stepNumber: 4,
        channel: 'Executive Brief',
        touchTiming: 'Day 14',
        subjectOrHeadline: `Final follow-up: ${targetCompany}'s 30-Day Growth Strategy`,
        messageBody: `Hi {{firstName}},\n\nFollowing up one last time with your complete 30-Day Organic Roadmap for ${targetCompany}. If the timing isn't right, no worries at all.\n\nWhenever you're ready to automate your content distribution and SEO pipeline, our team is here.`,
        callToAction: 'Book a 15-min strategy call'
      }
    ],
    customExploratoryOffer: 'Free 15-Minute Custom Organic Pipeline & Search Gap Audit',
    executiveObjectionPreemptions: [
      {
        objection: '"We already have an in-house team or agency."',
        response: 'Moyi acts as the execution copilot for your in-house team, speeding up their output 5x without adding headcount or replacing creative direction.'
      },
      {
        objection: '"We are skeptical about AI-generated quality."',
        response: 'Moyi enforces a mandatory human approval gate with PAS/AIDA conversion rules and empirical Search Console grounding—nothing goes live without your review.'
      }
    ]
  };

  return executeOpenAiJsonPrompt(prompt, fallback, 'AbmOutbound');
}

// -------------------------------------------------------------
// 8. MASTER EXECUTIVE CMO SUITE AUDIT
// -------------------------------------------------------------
async function generateFullEliteCmoAudit({ brandName = 'Moyi-CMO', domain = 'example.com', description = '', competitors = [] }) {
  const [
    positioning,
    cro,
    pricing,
    pseo,
    plg,
    lifecycle
  ] = await Promise.all([
    generateStrategicPositioning({ brandName, domain, description, competitors }),
    analyzeLandingPageCro({ pageUrl: `https://${domain}`, headline: brandName }),
    optimizePricingPsychology({ targetAudience: 'Founders & Growth Teams' }),
    generateProgrammaticSeoMatrix({ domain, competitors }),
    designPlgGrowthLoops({ productType: 'AI Marketing Platform' }),
    generateLifecycleEmailSequences({ brandName })
  ]);

  return {
    generatedAt: new Date().toISOString(),
    brandName,
    domain,
    positioning,
    cro,
    pricing,
    pseo,
    plg,
    lifecycle
  };
}

module.exports = {
  generateStrategicPositioning,
  analyzeLandingPageCro,
  optimizePricingPsychology,
  generateProgrammaticSeoMatrix,
  designPlgGrowthLoops,
  generateLifecycleEmailSequences,
  generateAbmOutboundCampaign,
  generateFullEliteCmoAudit
};
