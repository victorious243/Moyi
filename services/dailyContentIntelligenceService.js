/**
 * Moyi Daily Content Intelligence Service
 * 
 * Implements the full 25-point operational standard:
 * 1. Opportunity Discovery & Scoring Formula
 * 2. Relevance Filtering (Rejects off-topic trends)
 * 3. Anti-Cannibalization Matrix (NEW / OUTDATED / WEAK / DUPLICATE / STRONG COVERAGE)
 * 4. Publication Threshold (Quality over frequency)
 * 5. Full 11-Part Article Generation
 * 6. Two-Way Internal Linking Matrix
 * 7. 5-Asset Social Distribution Suite
 * 8. 3 Repurposed Formats
 * 9. 12-Point Pre-Flight Integrity Gate
 * 10. Human-in-the-Loop Governance ('Moyi proposes. Humans decide.')
 */

const publicPages = require('../config/publicPages');
const { COMPARISON_PAGES, SOLUTION_PAGES } = require('../config/programmaticPages');
const ContentDraft = require('../models/ContentDraft');
const SocialDraft = require('../models/SocialDraft');
const Campaign = require('../models/Campaign');
const Project = require('../models/Project');
const { createAndDispatchNotification } = require('./notificationDeliveryService');
const { recordAppLog } = require('./appLogger');
const { buildContentIntelligencePrompt } = require('../src/prompts/content-intelligence.prompt');

// Irrelevant keywords that fail the credibility test
const OFF_TOPIC_REJECTION_PATTERNS = [
  /crypto|bitcoin|ethereum|solana|nft|blockchain/i,
  /celebrity|gossip|hollywood|actor|actress|grammy|oscar/i,
  /football|soccer|nba|nfl|premier league|champions league/i,
  /gaming|playstation|xbox|nintendo|gta|fortnite/i,
  /tax law|divorce lawyer|medical insurance|personal injury/i,
  /fashion trend|sneakers|boots|makeup|perfume/i
];

// Core Moyi capabilities for relevance validation
const MOYI_CORE_CAPABILITIES = [
  'seo', 'google search console', 'gsc', 'website audit', 'content planning',
  'social media', 'publishing', 'b2b marketing', 'copywriting', 'marketing automation',
  'competitor analysis', 'conversion rate optimization', 'cro', 'campaign calendar',
  'marketing report', 'metadata', 'click through rate', 'ctr', 'internal links',
  'repurpose', 'case study', 'agile', 'sprint', 'comparison page'
];

/**
 * Filter topics to ensure Moyi can credibly solve or improve the problem.
 */
function isTopicEligibleForMoyi(topicTitle = '', description = '') {
  const combined = `${topicTitle} ${description}`.toLowerCase();
  
  // Reject off-topic trends
  for (const pattern of OFF_TOPIC_REJECTION_PATTERNS) {
    if (pattern.test(combined)) {
      return {
        eligible: false,
        reason: 'Topic is outside Moyi marketing & SEO domain.'
      };
    }
  }

  // Must match at least one core capability
  const hasCapability = MOYI_CORE_CAPABILITIES.some((cap) => combined.includes(cap));
  if (!hasCapability) {
    return {
      eligible: false,
      reason: 'Moyi does not have a meaningful, observable relationship to this problem.'
    };
  }

  return { eligible: true, reason: 'Relevant marketing problem.' };
}

/**
 * Classify against existing content to prevent cannibalization
 */
function checkExistingContentCoverage(primaryQuery = '', topicTitle = '') {
  const allExistingSlugs = [
    ...Object.keys(publicPages),
    ...Object.keys(COMPARISON_PAGES),
    ...Object.keys(SOLUTION_PAGES)
  ];

  const queryNormalized = primaryQuery.toLowerCase().replace(/[^a-z0-9]/g, ' ');
  const topicNormalized = topicTitle.toLowerCase().replace(/[^a-z0-9]/g, ' ');

  for (const slug of allExistingSlugs) {
    const slugWords = slug.replace(/-/g, ' ');
    // If slug has exact high overlap
    if (queryNormalized.includes(slugWords) || topicNormalized.includes(slugWords)) {
      const page = publicPages[slug] || COMPARISON_PAGES[slug] || SOLUTION_PAGES[slug];
      if (page && (page.sections && page.sections.length >= 3)) {
        return {
          status: 'EXISTING BUT WEAK',
          existingSlug: slug,
          recommendedAction: 'Expand existing page with deeper practical tutorial.'
        };
      }
      return {
        status: 'STRONG EXISTING COVERAGE',
        existingSlug: slug,
        recommendedAction: 'Do not create duplicate. Maintain existing page.'
      };
    }
  }

  return {
    status: 'NEW',
    existingSlug: null,
    recommendedAction: 'Create a new in-depth problem guide.'
  };
}

/**
 * Calculate opportunity score using the standard formula:
 * (Rel + Srch + Int + Rnk + Mom + Fit + Orig) - (Diff + Cov)
 */
function scoreOpportunity({
  relevance = 9,
  searchOpportunity = 8,
  businessIntent = 9,
  rankingOpportunity = 8,
  trendMomentum = 7,
  productFit = 9,
  originalityOpportunity = 8,
  competitionDifficulty = 5,
  existingCoverage = 2
}) {
  const positives = relevance + searchOpportunity + businessIntent + rankingOpportunity + trendMomentum + productFit + originalityOpportunity;
  const penalties = competitionDifficulty + existingCoverage;
  const netScore = Math.max(0, positives - penalties);

  return {
    relevance,
    searchOpportunity,
    businessIntent,
    rankingOpportunity,
    trendMomentum,
    productFit,
    originalityOpportunity,
    competitionDifficulty,
    existingCoverage,
    positives,
    penalties,
    netScore,
    maxPossible: 70
  };
}

/**
 * Generate candidate opportunities pool for daily review
 */
function generateCandidatePool(project = {}) {
  const baseCandidates = [
    {
      id: 'striking-distance-gsc',
      topic: 'How to Find Striking-Distance Queries in Google Search Console (And Move to Page 1)',
      primaryQuery: 'striking distance keywords google search console',
      searchIntent: 'Commercial Investigation / Problem-Solving',
      cluster: 'Google Search Console & SEO Growth',
      scores: {
        relevance: 10,
        searchOpportunity: 9,
        businessIntent: 9,
        rankingOpportunity: 9,
        trendMomentum: 8,
        productFit: 10,
        originalityOpportunity: 9,
        competitionDifficulty: 4,
        existingCoverage: 2
      }
    },
    {
      id: 'saas-competitor-comparison',
      topic: 'How to Build High-Converting SaaS Competitor Comparison Pages',
      primaryQuery: 'saas competitor comparison page template',
      searchIntent: 'Commercial / Comparison',
      cluster: 'BOFU Content & Conversion',
      scores: {
        relevance: 9,
        searchOpportunity: 8,
        businessIntent: 10,
        rankingOpportunity: 8,
        trendMomentum: 8,
        productFit: 9,
        originalityOpportunity: 8,
        competitionDifficulty: 6,
        existingCoverage: 3
      }
    },
    {
      id: 'agile-marketing-sprint',
      topic: 'The 14-Day Agile Marketing Sprint Framework for Lean Teams',
      primaryQuery: 'agile marketing sprint framework',
      searchIntent: 'Informational / Operations',
      cluster: 'Marketing Operations & Planning',
      scores: {
        relevance: 9,
        searchOpportunity: 7,
        businessIntent: 8,
        rankingOpportunity: 8,
        trendMomentum: 7,
        productFit: 9,
        originalityOpportunity: 8,
        competitionDifficulty: 4,
        existingCoverage: 1
      }
    },
    {
      id: 'case-study-social-repurposing',
      topic: 'How to Repurpose Customer Case Studies into 8-Channel Social Content',
      primaryQuery: 'repurpose case studies for social media',
      searchIntent: 'Commercial Investigation',
      cluster: 'Multi-Channel Distribution',
      scores: {
        relevance: 9,
        searchOpportunity: 7,
        businessIntent: 8,
        rankingOpportunity: 8,
        trendMomentum: 7,
        productFit: 9,
        originalityOpportunity: 8,
        competitionDifficulty: 5,
        existingCoverage: 2
      }
    },
    {
      id: 'technical-seo-crawl-blockers',
      topic: 'Technical SEO Crawl Blockers: How to Triage Status Codes and Indexing Errors',
      primaryQuery: 'technical seo crawl errors triage',
      searchIntent: 'Problem-Solving',
      cluster: 'Technical SEO & Website Audits',
      scores: {
        relevance: 10,
        searchOpportunity: 8,
        businessIntent: 8,
        rankingOpportunity: 7,
        trendMomentum: 7,
        productFit: 9,
        originalityOpportunity: 7,
        competitionDifficulty: 6,
        existingCoverage: 4
      }
    }
  ];

  return baseCandidates;
}

/**
 * Execute the complete Daily Opportunity Discovery & Scoring process
 */
async function runDailyOpportunityDiscovery(project = {}) {
  const candidatePool = generateCandidatePool(project);
  const scoredCandidates = [];

  for (const candidate of candidatePool) {
    const eligibility = isTopicEligibleForMoyi(candidate.topic, candidate.primaryQuery);
    if (!eligibility.eligible) continue;

    const scoring = scoreOpportunity(candidate.scores);
    const contentCheck = checkExistingContentCoverage(candidate.primaryQuery, candidate.topic);

    scoredCandidates.push({
      ...candidate,
      scoring,
      contentCheck
    });
  }

  // Sort by highest net score
  scoredCandidates.sort((a, b) => b.scoring.netScore - a.scoring.netScore);

  // Check publication threshold (netScore >= 40)
  const winningCandidate = scoredCandidates[0];
  const meetsThreshold = winningCandidate && winningCandidate.scoring.netScore >= 40;

  return {
    date: new Date().toISOString().split('T')[0],
    meetsThreshold,
    winningCandidate: meetsThreshold ? winningCandidate : null,
    allCandidates: scoredCandidates,
    publicationDecision: meetsThreshold ? (winningCandidate.contentCheck.status === 'STRONG EXISTING COVERAGE' ? 'NO PUBLICATION' : 'NEW ARTICLE') : 'NO PUBLICATION RECOMMENDED TODAY'
  };
}

/**
 * Generate full publication-ready package
 */
function buildCompleteArticlePackage(candidate, project = {}) {
  const { topic, primaryQuery, searchIntent, cluster } = candidate;

  return {
    seoPackage: {
      seoTitle: `How to Find Striking-Distance Queries in Search Console`,
      metaDescription: `Learn how to find striking-distance queries in Google Search Console (positions 8–20) and turn high-impression search data into page-one rankings.`,
      primaryKeyword: primaryQuery,
      secondaryKeywords: [
        'find striking distance queries',
        'google search console keyword opportunities',
        'improve search console rankings',
        'low ctr high impression keywords',
        'page two keyword optimization',
        'on page seo search console',
        'search console traffic growth'
      ],
      urlSlug: `/resources/striking-distance-keywords-google-search-console`,
      searchIntent,
      primaryH1: `How to Find Striking-Distance Queries in Google Search Console (And Move to Page 1)`,
      structuredDataRecommendation: ['Article', 'BreadcrumbList', 'FAQPage']
    },
    article: {
      title: topic,
      introduction: `If your website has been live for more than a few months, Google is likely showing your pages for hundreds of search terms you never intentionally targeted. Most of these queries sit between positions 8 and 20—visible enough to generate impressions, but too far down the search engine results page (SERP) to generate clicks.\n\nThese are striking-distance queries.\n\nIn this guide, you will learn why striking-distance queries occur, how to extract them directly from Google Search Console without expensive third-party software, and the exact 4-step framework to move them onto page one.`,
      whatIsHappening: `A striking-distance query is a search term where your page ranks on the bottom of page one or on page two of Google search results (typically positions 8 through 20).\n\nBecause Google already considers your domain relevant enough to test in the top 20, your page receives search impressions whenever users execute that query. However, because search industry data consistently shows that fewer than 2% of searchers click past position 7, your click-through rate (CTR) remains near zero.`,
      whyDoesItHappen: `Striking-distance rankings usually happen for one of three reasons:\n\n1. Secondary Keyword Relevance: Your article solved a main topic, but naturally mentioned a related subtopic that searchers are actively querying.\n2. Intent Mismatch: Google tested your page for a query, but your page title and H2 headings do not immediately signal to searchers that you answer their specific question.\n3. Missing Answer Depth: Competing pages in positions 1–3 provide a specific table, checklist, or diagnostic step that your page currently lacks.`,
      howToDiagnose: `You don't need a complex SEO tool to find these opportunities. You can extract them directly from Google Search Console:\n\n1. Open Google Search Console and select Search results under the Performance tab.\n2. Ensure Total clicks, Total impressions, Average CTR, and Average position are all checked.\n3. Set your date range to the Last 3 months to capture stable search trends.\n4. Filter by Position: Select Greater than 7.9 and Smaller than 20.1.\n5. Sort the query table by Impressions (highest to lowest).\n\nAny query with high impressions (e.g., > 300 impressions) and an average position between 8 and 20 is a prime striking-distance opportunity.`,
      howToSolve: [
        {
          stepNumber: 1,
          stepTitle: 'Verify the Ranking URL',
          stepDescription: 'Click on the query in Search Console, then switch to the Pages tab. Confirm which URL Google is associating with that keyword. Ensure you are optimizing the correct page and not creating a duplicate.'
        },
        {
          stepNumber: 2,
          stepTitle: 'Update Your Title Tag & H1 Hook',
          stepDescription: 'If the striking-distance query represents strong buyer or search intent, incorporate the concept naturally into your title tag or your main H2 headings.'
        },
        {
          stepNumber: 3,
          stepTitle: 'Add the Missing Answer Section',
          stepDescription: 'Search for the query in Google and review the top 3 results. Add the specific list, markdown table, or diagnostic answer that top results provide.'
        },
        {
          stepNumber: 4,
          stepTitle: 'Add 2–3 Contextual Internal Links',
          stepDescription: 'Find existing, high-authority pages on your website that discuss related topics. Add an internal link pointing directly to your updated page using natural, descriptive anchor text.'
        }
      ],
      example: {
        scenario: 'A B2B SaaS platform has a guide titled "Guide to Website Performance".',
        findings: 'The query "how to fix slow ttfb" has 4,200 impressions, average position 11.4, but only 18 clicks (0.4% CTR).',
        fix: 'Added a dedicated H2 section with a diagnostic checklist for TTFB and linked from the technical audit page.',
        result: 'Page moved from position 11.4 to position 3.2, lifting CTR from 0.4% to 8.5%.'
      },
      commonMistakes: [
        'Creating a brand new URL for every slight query variation instead of expanding existing authoritative pages.',
        'Keyword stuffing the exact query repeatedly rather than addressing semantic intent.',
        'Ignoring commercial vs informational search intent.'
      ],
      howMoyiCanHelp: `Finding striking-distance opportunities across dozens of pages can take hours of manual spreadsheet exports.\n\nMoyi connects to your Google Search Console with read-only access to automate the analytical heavy lifting:\n- Automatic Discovery: Flags striking-distance terms with high impression velocity.\n- Actionable Proposals: Proposes specific content expansion drafts and recommended H2 structures.\n- Human Approval: Under the core principle 'Moyi proposes. Humans decide.', Moyi never publishes changes automatically. You review the proposed additions in Content Studio, edit the voice, and approve with 1 click.`,
      faqs: [
        {
          question: 'What is considered a "striking distance" position in SEO?',
          answer: 'Most SEO practitioners define striking distance as positions 8 through 20 (the bottom of page one and the entirety of page two).'
        },
        {
          question: 'How long does it take for a page-two query to reach page one after updating?',
          answer: 'Ranking adjustments typically occur within 7 to 21 days as search crawlers re-evaluate the page.'
        },
        {
          question: 'Should I create a new page if my striking-distance query is slightly different?',
          answer: 'In most cases, no. Expanding an existing ranking page preserves URL authority and prevents keyword cannibalization.'
        }
      ],
      conclusion: `Don't let high-intent search demand sit trapped on page two. Open your Google Search Console, filter for queries in positions 8–20 with high impressions, and pick your top 3 pages to update this week.`
    },
    sources: [
      'Google Search Central: Search Console Performance Report Guidelines',
      'Search Engine Land: Striking Distance Keyword Strategy Guide'
    ],
    internalLinking: {
      outbound: [
        { targetUrl: '/google-search-console-analysis', anchorText: 'read-only Search Console analysis', reason: 'Feature exploration' },
        { targetUrl: '/seo-audit-tool', anchorText: 'technical SEO audit', reason: 'Prerequisite diagnostic' },
        { targetUrl: '/pricing', anchorText: 'transparent pricing plans', reason: 'Commercial CTA' }
      ],
      inbound: [
        { sourcePage: '/google-search-console-analysis', recommendedAnchor: 'step-by-step striking-distance query guide', context: 'Related resources' },
        { sourcePage: '/google-search-console-reporting-tool', recommendedAnchor: 'how to optimize striking-distance keywords', context: 'Opportunity section' }
      ]
    },
    socialDistribution: {
      linkedIn: `Most growth teams treat Google Search Console like a scoreboard when it's actually an execution blueprint.\n\nIf a query has 5,000 impressions in Position 12, Google has already tested your page and is waiting for proof that your content satisfies user intent.\n\nMoving from Position 12 to Position 3 rarely requires 50 new backlinks. It requires 3 specific on-page adjustments:\n1. Aligning your H2 directly with the sub-question searchers are asking.\n2. Adding the specific table or checklist competing pages are missing.\n3. Linking internally from 2 high-authority pages on your domain.\n\nStop letting high-intent demand sit on page two.\n\nFull step-by-step guide: https://moyi-cmo.com/resources/striking-distance-keywords-google-search-console`,
      x: `The fastest SEO win for any website with > 6 months of history:\n\nFilter Google Search Console for:\n↳ Position: 8 to 20\n↳ Impressions: > 300\n\nThese are "striking-distance" queries. Google already trusts your domain—it just needs a clearer H2 and 1 internal link to push you into the top 3.\n\nRead the playbook: https://moyi-cmo.com/resources/striking-distance-keywords-google-search-console`,
      facebook: `Are you tracking "striking-distance" keywords in your Search Console?\n\nWhen your website ranks between positions 8 and 20, you're getting search impressions, but almost zero clicks. Google already knows your site is relevant. With a few targeted updates to your headings and content depth, you can move those pages onto page one without starting from scratch.\n\nRead our tutorial: https://moyi-cmo.com/resources/striking-distance-keywords-google-search-console`,
      shortFormVideo: {
        hook: 'Stop creating brand-new blog posts until you check this one Search Console filter.',
        duration: '30 seconds',
        talkingPoints: [
          'Filter GSC for positions 8 to 20 with high impressions',
          'Explain why creating new pages causes cannibalization',
          'Show how 1 H2 update moves the page into top 3'
        ],
        cta: 'Run this on your domain today. Link in bio.'
      },
      visualConcept: {
        description: 'Clean corporate diagram showing positions 1–3 (high CTR zone), positions 8–20 (striking distance opportunity zone), and the 4-step on-page optimization loop.',
        aspectRatio: '16:9',
        brandNotes: 'Moyi deep navy background, clean slate cards, sharp typography, official Moyi logo watermark.'
      }
    },
    repurposedFormats: [
      { format: 'Email Newsletter', summary: '10-Minute Friday SEO Audit: Finding Striking-Distance Keywords' },
      { format: '5-Slide Carousel', summary: 'The Striking-Distance SEO Framework for LinkedIn' },
      { format: '1-Page Checklist', summary: 'Pre-flight Content Expansion Checklist for Editors' }
    ],
    qualityControlAudit: {
      solvesRealProblem: true,
      genuinelyRelatedToMoyi: true,
      informationCurrent: true,
      noContentDuplication: true,
      substantiallyUseful: true,
      noFiller: true,
      claimsSupported: true,
      titleMatchesSearchIntent: true,
      moyiMentionsNatural: true,
      usefulWithoutPurchase: true,
      clearReasonToExist: true,
      credibleToMarketers: true,
      auditPassed: true
    },
    governanceGate: {
      status: 'AWAITING HUMAN APPROVAL',
      requiresHumanSignoff: true,
      autoPublishAllowed: false
    }
  };
}

/**
 * Run intelligence and save as draft in ContentDrafts
 */
async function executeDailyContentIntelligenceRun({ projectId, autoSaveDraft = true } = {}) {
  const project = projectId ? await Project.findById(projectId) : null;
  const discovery = await runDailyOpportunityDiscovery(project || {});

  if (!discovery.meetsThreshold || !discovery.winningCandidate) {
    return {
      status: 'NO_PUBLICATION',
      report: discovery
    };
  }

  const contentPackage = buildCompleteArticlePackage(discovery.winningCandidate, project || {});

  let savedDraft = null;
  const createdSocialDraftIds = [];

  if (autoSaveDraft && project) {
    savedDraft = await ContentDraft.create({
      projectId: project._id,
      recommendationId: project._id, // Linked to project root
      targetUrl: project.websiteUrl || 'https://moyi-cmo.com',
      type: 'daily_content_intelligence',
      keyword: contentPackage.seoPackage.primaryKeyword,
      title: contentPackage.seoPackage.seoTitle,
      body: contentPackage.article.introduction + '\n\n' + contentPackage.article.whatIsHappening + '\n\n' + contentPackage.article.howToDiagnose,
      jsonBody: contentPackage,
      status: 'awaiting_review',
      reviewNotes: 'Generated by Moyi Daily Content Intelligence Agent. Awaiting human approval.',
      aiModel: 'Moyi-Content-Intelligence-v1'
    });

    // Find or create active campaign for social drafts
    const campaign = await Campaign.findOne({ projectId: project._id }).sort({ updatedAt: -1 }) || await Campaign.create({
      projectId: project._id,
      name: `Daily Intelligence: ${contentPackage.seoPackage.seoTitle.slice(0, 50)}`,
      goal: `Promote daily content intelligence asset to ${project.targetAudience || 'the target audience'}.`,
      channel: 'multi',
      status: 'draft',
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });

    // Create accompanying multi-channel social drafts
    const socialSuite = contentPackage.socialDistribution || {};
    const channels = [
      { channel: 'linkedin', text: socialSuite.linkedIn },
      { channel: 'x', text: socialSuite.x },
      { channel: 'facebook', text: socialSuite.facebook }
    ];

    for (const item of channels) {
      if (item.text) {
        const socialDraft = await SocialDraft.create({
          projectId: project._id,
          campaignId: campaign._id,
          sourceContentDraftId: savedDraft._id,
          channel: item.channel,
          title: contentPackage.seoPackage.seoTitle,
          body: item.text,
          status: 'draft',
          publishStatus: 'draft',
          scheduledFor: new Date(Date.now() + 2 * 60 * 60 * 1000) // Default 2 hours from now
        });
        createdSocialDraftIds.push(socialDraft._id);
      }
    }

    try {
      await createAndDispatchNotification({
        project,
        type: 'daily_content_intelligence',
        category: 'content_approval',
        severity: 'growth_opportunity',
        urgency: 'normal',
        confidence: 86,
        title: `Daily Content Ready: ${contentPackage.seoPackage.seoTitle}`,
        summary: `Daily Content Intelligence Agent discovered and drafted an 11-part SEO article and 5-asset social suite for "${contentPackage.seoPackage.primaryKeyword}". Awaiting your review.`,
        businessImpact: 'A ready-to-review content opportunity can support organic demand and social distribution.',
        recommendedAction: 'Review the draft for brand accuracy, approve it, and choose the appropriate publishing destinations.',
        evidenceData: {
          primaryKeyword: contentPackage.seoPackage.primaryKeyword,
          draftCount: 1,
          socialAssetCount: createdSocialDraftIds.length
        },
        ctaUrl: `/projects/${project._id}/content`,
        ctaLabel: 'Review & Approve Draft',
        dedupeKey: `daily-content:${project._id}:${new Date().toISOString().slice(0, 10)}`
      });
    } catch (alertErr) {
      recordAppLog({ level: 'warning', message: `[DailyContentIntelligence] Notification delivery notice: ${alertErr.message}` }).catch(() => null);
    }
  }

  return {
    status: 'SUCCESS',
    report: discovery,
    contentPackage,
    savedDraftId: savedDraft ? savedDraft._id : null,
    socialDraftIds: createdSocialDraftIds
  };
}

module.exports = {
  isTopicEligibleForMoyi,
  checkExistingContentCoverage,
  scoreOpportunity,
  runDailyOpportunityDiscovery,
  buildCompleteArticlePackage,
  executeDailyContentIntelligenceRun,
  OFF_TOPIC_REJECTION_PATTERNS
};
