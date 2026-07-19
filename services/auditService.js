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
  } else if (page.title.length > 65 || page.title.length < 20) {
    issues.push(issue({
      page,
      type: 'title_length',
      severity: 'warning',
      title: 'Title tag length may reduce search result clarity',
      evidence: { title: page.title, length: page.title.length },
      recommendation: 'Rewrite the title so it is clear, specific, and roughly 20 to 65 characters.'
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

  return issues;
}

function auditPages(pages) {
  return pages.flatMap(auditPage);
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
