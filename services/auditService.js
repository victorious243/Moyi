function issue({ page, type, severity, title, evidence, recommendation }) {
  return {
    url: page.url,
    type,
    severity,
    title,
    evidence,
    recommendation
  };
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'your', 'you', 'our', 'are', 'that', 'this', 'from',
  'into', 'what', 'how', 'why', 'can', 'will', 'all', 'one', 'use', 'using', 'get',
  'page', 'site', 'website', 'home', 'about', 'contact', 'login', 'register'
]);

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function hasSchemaType(page, patterns) {
  return (page.schemaTypes || []).some((type) => patterns.some((pattern) => pattern.test(String(type))));
}

function topKeywords(page) {
  const source = [
    page.title,
    page.metaDescription,
    ...(page.h1 || []),
    ...(page.headings || [])
  ].join(' ');
  const words = source
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9-]{2,}/g) || [];
  const counts = words.reduce((acc, word) => {
    if (STOPWORDS.has(word)) return acc;
    acc[word] = (acc[word] || 0) + 1;
    return acc;
  }, {});

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([word]) => word);
}

function missingSocialProfiles(page) {
  const profiles = page.socialProfiles || {};
  return Object.entries({
    linkedin: profiles.linkedin,
    instagram: profiles.instagram,
    facebook: profiles.facebook,
    x: profiles.x,
    youtube: profiles.youtube
  })
    .filter(([, exists]) => !exists)
    .map(([network]) => network);
}

function auditPage(page) {
  const issues = [];

  if (page.statusCode >= 400 || page.statusCode === 0) {
    issues.push(issue({
      page,
      type: 'http_status',
      severity: 'critical',
      title: 'Page is not returning a successful HTTP status',
      evidence: { statusCode: page.statusCode },
      recommendation: 'Fix the page response so crawlers and users receive a 2xx status.'
    }));
  }

  if (!page.title) {
    issues.push(issue({
      page,
      type: 'missing_title',
      severity: 'critical',
      title: 'Missing title tag',
      evidence: { title: page.title },
      recommendation: 'Add a concise, descriptive title tag aligned to the page intent.'
    }));
  } else if (page.title.length > 60 || page.title.length < 50) {
    issues.push(issue({
      page,
      type: 'title_length',
      severity: 'warning',
      title: 'Title tag length may reduce search result clarity',
      evidence: { title: page.title, length: page.title.length },
      recommendation: 'Rewrite the title so it is clear, specific, and roughly 50 to 60 characters where possible.'
    }));
  }

  if (!page.metaDescription) {
    issues.push(issue({
      page,
      type: 'missing_meta_description',
      severity: 'warning',
      title: 'Missing meta description',
      evidence: { metaDescription: page.metaDescription },
      recommendation: 'Add a useful meta description that summarizes the page and encourages qualified clicks.'
    }));
  } else if (page.metaDescription.length > 160 || page.metaDescription.length < 70) {
    issues.push(issue({
      page,
      type: 'meta_description_length',
      severity: 'opportunity',
      title: 'Meta description length could be improved',
      evidence: { metaDescription: page.metaDescription, length: page.metaDescription.length },
      recommendation: 'Tune the description to be informative, action-oriented, and roughly 70 to 160 characters.'
    }));
  }

  if (page.h1.length === 0) {
    issues.push(issue({
      page,
      type: 'missing_h1',
      severity: 'warning',
      title: 'Missing H1 heading',
      evidence: { h1: page.h1 },
      recommendation: 'Add one clear H1 that reflects the primary topic of the page.'
    }));
  } else if (page.h1.length > 1) {
    issues.push(issue({
      page,
      type: 'multiple_h1',
      severity: 'opportunity',
      title: 'Multiple H1 headings found',
      evidence: { h1: page.h1, count: page.h1.length },
      recommendation: 'Use a single primary H1 and demote secondary section headings to H2 or H3.'
    }));
  }

  if (!page.lang) {
    issues.push(issue({
      page,
      type: 'missing_lang_attribute',
      severity: 'opportunity',
      title: 'Missing HTML language attribute',
      evidence: { lang: page.lang },
      recommendation: 'Add a lang attribute to the html element so browsers, screen readers, and crawlers understand the page language.'
    }));
  }

  if (!page.viewport) {
    issues.push(issue({
      page,
      type: 'missing_viewport',
      severity: 'warning',
      title: 'Missing mobile viewport tag',
      evidence: { viewport: page.viewport },
      recommendation: 'Add a responsive viewport meta tag so the page renders correctly on mobile devices.'
    }));
  }

  if (!page.hreflangCount) {
    issues.push(issue({
      page,
      type: 'missing_hreflang',
      severity: 'opportunity',
      title: 'No hreflang attributes found',
      evidence: { hreflangCount: page.hreflangCount || 0 },
      recommendation: 'If this site targets multiple languages or regions, add hreflang alternates. If it is single-language only, this can remain a low-priority note.'
    }));
  }

  if (page.imagesMissingAlt > 0) {
    issues.push(issue({
      page,
      type: 'missing_image_alt',
      severity: 'opportunity',
      title: 'Images missing alt text',
      evidence: { imagesCount: page.imagesCount, imagesMissingAlt: page.imagesMissingAlt },
      recommendation: 'Add meaningful alt text for informative images and empty alt text for decorative images.'
    }));
  }

  if (page.wordCount > 0 && page.wordCount < 250) {
    issues.push(issue({
      page,
      type: 'thin_content',
      severity: 'opportunity',
      title: 'Page has limited crawlable text',
      evidence: { wordCount: page.wordCount },
      recommendation: 'Expand the page with genuinely useful information that answers visitor questions.'
    }));
  }

  const keywords = topKeywords(page);
  const titleText = cleanText(page.title).toLowerCase();
  const metaText = cleanText(page.metaDescription).toLowerCase();
  const headingText = cleanText([...(page.h1 || []), ...(page.headings || [])].join(' ')).toLowerCase();
  const weakKeywordAlignment = keywords.length >= 2 && keywords.filter((keyword) => (
    titleText.includes(keyword) && metaText.includes(keyword) && headingText.includes(keyword)
  )).length === 0;

  if (weakKeywordAlignment) {
    issues.push(issue({
      page,
      type: 'keyword_tag_alignment',
      severity: 'warning',
      title: 'Important terms are not aligned across title, meta, and headings',
      evidence: { keywords },
      recommendation: 'Choose the page’s primary search theme and make sure the title, meta description, H1, and section headings reinforce it naturally.'
    }));
  }

  if (/noindex/i.test(page.robotsMeta || '')) {
    issues.push(issue({
      page,
      type: 'noindex',
      severity: 'critical',
      title: 'Page includes a noindex directive',
      evidence: { robotsMeta: page.robotsMeta },
      recommendation: 'Remove noindex if this page should appear in search results.'
    }));
  }

  if (!page.canonical) {
    issues.push(issue({
      page,
      type: 'missing_canonical',
      severity: 'opportunity',
      title: 'Missing canonical URL',
      evidence: { canonical: page.canonical },
      recommendation: 'Add a self-referencing canonical URL unless another canonical target is intentional.'
    }));
  }

  if (!page.schemaTypes || !page.schemaTypes.length) {
    issues.push(issue({
      page,
      type: 'missing_schema',
      severity: 'warning',
      title: 'No Schema.org structured data detected',
      evidence: { schemaTypes: page.schemaTypes || [] },
      recommendation: 'Add relevant JSON-LD structured data such as Organization, WebSite, WebPage, Article, FAQPage, Product, or SoftwareApplication where appropriate.'
    }));
  }

  if (!hasSchemaType(page, [/Organization/i, /Person/i])) {
    issues.push(issue({
      page,
      type: 'missing_identity_schema',
      severity: 'opportunity',
      title: 'No identity schema detected',
      evidence: { schemaTypes: page.schemaTypes || [] },
      recommendation: 'Add Organization or Person schema so search engines and LLMs can identify the entity behind the website.'
    }));
  }

  if (!hasSchemaType(page, [/LocalBusiness/i]) && /local|near me|address|phone|visit|appointment|service area/i.test([
    page.title,
    page.metaDescription,
    ...(page.h1 || []),
    ...(page.headings || [])
  ].join(' '))) {
    issues.push(issue({
      page,
      type: 'missing_local_business_schema',
      severity: 'opportunity',
      title: 'Local intent page lacks LocalBusiness schema',
      evidence: { schemaTypes: page.schemaTypes || [] },
      recommendation: 'If this page represents a local business or location, add LocalBusiness schema with accurate address, phone, opening hours, and service area.'
    }));
  }

  if (!page.openGraph || !page.openGraph.title || !page.openGraph.description || !page.openGraph.image) {
    issues.push(issue({
      page,
      type: 'missing_open_graph',
      severity: 'opportunity',
      title: 'Facebook Open Graph tags are incomplete',
      evidence: { openGraph: page.openGraph || {} },
      recommendation: 'Add og:title, og:description, og:url, and og:image tags so shared links render professionally.'
    }));
  }

  if (!page.twitterCard || !page.twitterCard.card || !page.twitterCard.title || !page.twitterCard.description) {
    issues.push(issue({
      page,
      type: 'missing_x_cards',
      severity: 'opportunity',
      title: 'X card metadata is incomplete',
      evidence: { twitterCard: page.twitterCard || {} },
      recommendation: 'Add twitter:card, twitter:title, twitter:description, and twitter:image tags for better X link previews.'
    }));
  }

  if (!page.analyticsTools || !page.analyticsTools.length) {
    issues.push(issue({
      page,
      type: 'analytics_not_detected',
      severity: 'opportunity',
      title: 'No analytics tool detected',
      evidence: { analyticsTools: page.analyticsTools || [] },
      recommendation: 'Install an analytics tool or Moyi tracking so traffic, conversions, and campaign impact can be measured.'
    }));
  }

  if (page.inlineStyleCount > 0) {
    issues.push(issue({
      page,
      type: 'inline_styles',
      severity: 'opportunity',
      title: 'Inline styles detected',
      evidence: { inlineStyleCount: page.inlineStyleCount },
      recommendation: 'Move repeated inline styles into CSS classes to improve maintainability and reduce HTML noise.'
    }));
  }

  if (page.redirectCount > 1) {
    issues.push(issue({
      page,
      type: 'multiple_redirects',
      severity: 'opportunity',
      title: 'Multiple redirects before final page',
      evidence: { redirectCount: page.redirectCount },
      recommendation: 'Reduce redirect chains so users and crawlers reach the final URL faster.'
    }));
  }

  if (page.httpVersion && /^1\./.test(page.httpVersion)) {
    issues.push(issue({
      page,
      type: 'outdated_http_protocol',
      severity: 'opportunity',
      title: 'HTTP/2 or newer was not detected',
      evidence: { httpVersion: page.httpVersion },
      recommendation: 'Enable HTTP/2 or HTTP/3 at the web server or CDN layer to improve modern browser delivery.'
    }));
  }

  const missingProfiles = missingSocialProfiles(page);
  if (missingProfiles.length) {
    issues.push(issue({
      page,
      type: 'missing_social_profile_links',
      severity: 'opportunity',
      title: 'Some major social profile links were not found',
      evidence: { missingProfiles, socialProfiles: page.socialProfiles || {} },
      recommendation: 'Link only the real active brand profiles that matter to the business, such as LinkedIn, Instagram, Facebook, X, or YouTube.'
    }));
  }

  return issues;
}

function homepageFor(pages) {
  return (pages || []).find((page) => {
    try {
      return new URL(page.url).pathname.replace(/\/$/, '') === '';
    } catch (error) {
      return false;
    }
  }) || (pages || [])[0];
}

function auditSite(pages, siteSignals = {}) {
  const homepage = homepageFor(pages);
  if (!homepage) return [];
  const issues = [];

  if (siteSignals.robotsTxt && !siteSignals.robotsTxt.exists) {
    issues.push(issue({
      page: homepage,
      type: 'missing_robots_txt',
      severity: 'warning',
      title: 'Robots.txt was not detected',
      evidence: siteSignals.robotsTxt,
      recommendation: 'Add a robots.txt file that allows intended crawlers and points to the XML sitemap.'
    }));
  } else if (siteSignals.robotsTxt && siteSignals.robotsTxt.blocksMajorSearch) {
    issues.push(issue({
      page: homepage,
      type: 'robots_blocks_search',
      severity: 'critical',
      title: 'Robots.txt appears to block major search crawling',
      evidence: siteSignals.robotsTxt,
      recommendation: 'Review robots.txt and remove broad disallow rules if the site should be indexed.'
    }));
  }

  if (siteSignals.robotsTxt && siteSignals.robotsTxt.blocksAiCrawlers) {
    issues.push(issue({
      page: homepage,
      type: 'robots_blocks_ai_crawlers',
      severity: 'opportunity',
      title: 'Robots.txt appears to block major AI crawlers',
      evidence: siteSignals.robotsTxt,
      recommendation: 'If AI-search visibility matters, review AI crawler directives and allow the crawlers you trust.'
    }));
  }

  if (siteSignals.sitemap && !siteSignals.sitemap.exists) {
    issues.push(issue({
      page: homepage,
      type: 'missing_xml_sitemap',
      severity: 'warning',
      title: 'XML sitemap was not detected',
      evidence: siteSignals.sitemap,
      recommendation: 'Publish an XML sitemap and reference it from robots.txt so crawlers can discover key pages.'
    }));
  }

  if (siteSignals.llmsTxt && !siteSignals.llmsTxt.exists) {
    issues.push(issue({
      page: homepage,
      type: 'missing_llms_txt',
      severity: 'opportunity',
      title: 'llms.txt was not detected',
      evidence: siteSignals.llmsTxt,
      recommendation: 'Add an llms.txt file that summarizes the business, product, important URLs, and crawler guidance for AI search systems.'
    }));
  }

  return issues;
}

function auditPages(pages, siteSignals = {}) {
  return [
    ...pages.flatMap(auditPage),
    ...auditSite(pages, siteSignals)
  ];
}

function summarizeIssues(issues, pages) {
  return {
    pagesScanned: pages.length,
    issueCount: issues.length,
    criticalCount: issues.filter((item) => item.severity === 'critical').length,
    warningCount: issues.filter((item) => item.severity === 'warning').length,
    opportunityCount: issues.filter((item) => item.severity === 'opportunity').length
  };
}

module.exports = {
  auditPages,
  summarizeIssues
};
