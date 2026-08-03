const MAX_TEXT_LENGTH = 1800;

function cleanText(value, limit = MAX_TEXT_LENGTH) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function pdfEscape(value) {
  return cleanText(value, 5000)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '');
}

function safeFilename(value) {
  return cleanText(value, 100)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'moyi-scan-report';
}

function countBy(items, key) {
  return (Array.isArray(items) ? items : []).reduce((acc, item) => {
    const value = item && item[key] ? item[key] : 'unknown';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function issueSeverityRank(severity) {
  return { critical: 0, warning: 1, opportunity: 2 }[severity] ?? 3;
}

function wrapText(text, maxChars) {
  const words = cleanText(text, 5000).split(' ').filter(Boolean);
  const lines = [];
  let current = '';

  words.forEach((word) => {
    const chunks = [];
    for (let index = 0; index < word.length; index += maxChars) {
      chunks.push(word.slice(index, index + maxChars));
    }

    chunks.forEach((chunk) => {
      if (!current) {
        current = chunk;
      } else if ((current.length + chunk.length + 1) <= maxChars) {
        current = `${current} ${chunk}`;
      } else {
        lines.push(current);
        current = chunk;
      }
    });
  });

  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function formatDate(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return date.toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC'
  });
}

function buildScanNarrative({ project, scan, issues, recommendations, competitorInsights }) {
  const issueCounts = countBy(issues, 'severity');
  const totalIssues = issues.length;
  const projectName = cleanText(project.name, 140);

  if (scan.status !== 'completed') {
    return `${projectName} has a ${scan.status} scan. This report uses partial evidence already saved by Moyi and should be refreshed after a completed crawl.`;
  }

  if (!totalIssues) {
    return `${projectName} completed a website scan with ${scan.pagesScanned || 0} pages scanned and no stored SEO issues. Review the page register and rerun the scan after major site changes.`;
  }

  const parts = [
    `${projectName} completed a factual website scan with ${scan.pagesScanned || 0} pages scanned and ${scan.pagesFound || 0} pages found.`,
    `Moyi recorded ${totalIssues} issues: ${issueCounts.critical || 0} critical, ${issueCounts.warning || 0} warnings, and ${issueCounts.opportunity || 0} opportunities.`,
    recommendations.length
      ? `${recommendations.length} prioritized scan actions are ready for review.`
      : 'No saved recommendations were found for this scan yet.',
    competitorInsights.length
      ? `${competitorInsights.length} competitor comparison gaps are available as directional evidence.`
      : 'No competitor comparison gaps were attached to this scan report.'
  ];

  return parts.join(' ');
}

function buildReportModel({ project, scan, issueSummary = {}, issues = [], recommendations = [], competitorInsights = [], pages = [], failedPages = [] }) {
  const sortedIssues = [...issues].sort((a, b) => {
    const severity = issueSeverityRank(a.severity) - issueSeverityRank(b.severity);
    if (severity) return severity;
    return cleanText(a.url).localeCompare(cleanText(b.url));
  });
  const sortedRecommendations = [...recommendations].sort((a, b) => {
    const priority = Number(b.priority || 0) - Number(a.priority || 0);
    if (priority) return priority;
    return cleanText(a.title).localeCompare(cleanText(b.title));
  });
  const sortedPages = [...pages].sort((a, b) => cleanText(a.url).localeCompare(cleanText(b.url)));
  const issuesByType = countBy(issues, 'type');
  const topIssueTypes = Object.entries(issuesByType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([type, count]) => ({ type: type.replace(/_/g, ' '), count }));

  return {
    generatedAt: new Date(),
    project,
    scan,
    summary: {
      issueCount: issueSummary.issueCount ?? issues.length,
      criticalCount: issueSummary.criticalCount ?? (countBy(issues, 'severity').critical || 0),
      warningCount: issueSummary.warningCount ?? (countBy(issues, 'severity').warning || 0),
      opportunityCount: issueSummary.opportunityCount ?? (countBy(issues, 'severity').opportunity || 0),
      pagesFound: scan.pagesFound || sortedPages.length,
      pagesScanned: scan.pagesScanned || sortedPages.length,
      failedPages: failedPages.length
    },
    narrative: buildScanNarrative({ project, scan, issues, recommendations, competitorInsights }),
    issues: sortedIssues,
    recommendations: sortedRecommendations,
    competitorInsights,
    pages: sortedPages,
    topIssueTypes
  };
}

function createPdf() {
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 42;
  const pages = [];
  let commands = [];
  let y = pageHeight - margin;
  let pageNumber = 0;

  function color(hex) {
    const normalized = String(hex || '#ffffff').replace('#', '');
    const r = parseInt(normalized.slice(0, 2), 16) / 255;
    const g = parseInt(normalized.slice(2, 4), 16) / 255;
    const b = parseInt(normalized.slice(4, 6), 16) / 255;
    return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`;
  }

  function command(value) {
    commands.push(value);
  }

  function textAt(value, x, textY, options = {}) {
    const font = options.bold ? 'F2' : 'F1';
    const size = options.size || 10;
    const fill = color(options.color || '#1f2937');
    command(`BT /${font} ${size} Tf ${fill} rg ${x.toFixed(2)} ${textY.toFixed(2)} Td (${pdfEscape(value)}) Tj ET`);
  }

  function rect(x, rectY, width, height, options = {}) {
    if (options.fill) {
      command(`${color(options.fill)} rg ${x.toFixed(2)} ${rectY.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`);
    }
    if (options.stroke) {
      command(`${color(options.stroke)} RG ${x.toFixed(2)} ${rectY.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`);
    }
  }

  function line(x1, y1, x2, y2, stroke = '#d1d5db') {
    command(`${color(stroke)} RG ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }

  function footer() {
    line(margin, 38, pageWidth - margin, 38, '#d1d5db');
    textAt('Moyi-CMO evidence report', margin, 22, { size: 8, color: '#6b7280' });
    textAt(`Page ${pageNumber}`, pageWidth - margin - 42, 22, { size: 8, color: '#6b7280' });
  }

  function newPage() {
    if (commands.length) {
      footer();
      pages.push(commands.join('\n'));
    }
    pageNumber += 1;
    commands = [];
    y = pageHeight - margin;
    rect(0, 0, pageWidth, pageHeight, { fill: '#ffffff' });
    rect(0, pageHeight - 92, pageWidth, 92, { fill: '#05070a' });
    rect(0, pageHeight - 94, pageWidth, 2, { fill: '#1fd7c5' });
    textAt('MOYI-CMO', margin, pageHeight - 38, { bold: true, size: 18, color: '#ffffff' });
    textAt('Website evidence translated into marketing action', margin, pageHeight - 58, { size: 9, color: '#d1d5db' });
    y = pageHeight - 124;
  }

  function ensureSpace(height) {
    if (y - height < 64) newPage();
  }

  function heading(value) {
    ensureSpace(44);
    textAt(value, margin, y, { bold: true, size: 18, color: '#111827' });
    y -= 12;
    line(margin, y, pageWidth - margin, y, '#e5e7eb');
    y -= 18;
  }

  function paragraph(value, options = {}) {
    const maxChars = options.maxChars || 92;
    const size = options.size || 10;
    const lines = wrapText(value, maxChars);
    ensureSpace(lines.length * (size + 4) + 8);
    lines.forEach((lineText) => {
      textAt(lineText, options.x || margin, y, { size, color: options.color || '#374151', bold: options.bold });
      y -= size + 4;
    });
    y -= options.after ?? 8;
  }

  function bullet(value, options = {}) {
    const x = options.x || margin;
    const lines = wrapText(value, options.maxChars || 86);
    ensureSpace(lines.length * 13 + 8);
    textAt('-', x, y, { size: 10, color: options.color || '#374151' });
    lines.forEach((lineText, index) => {
      textAt(lineText, x + 14, y - (index * 13), { size: 10, color: options.color || '#374151' });
    });
    y -= lines.length * 13 + 5;
  }

  function metricCard(label, value, x, cardY, width) {
    rect(x, cardY, width, 58, { fill: '#f3f4f6', stroke: '#d1d5db' });
    textAt(label.toUpperCase(), x + 12, cardY + 37, { bold: true, size: 8, color: '#6b7280' });
    textAt(String(value), x + 12, cardY + 14, { bold: true, size: 20, color: '#111827' });
  }

  function keyValue(label, value) {
    const lines = wrapText(`${label}: ${value}`, 84);
    ensureSpace(lines.length * 12 + 6);
    lines.forEach((lineText, index) => {
      textAt(lineText, margin, y - (index * 12), { size: 9, color: '#374151', bold: index === 0 && label.length < 26 });
    });
    y -= lines.length * 12 + 5;
  }

  function finish() {
    if (commands.length) {
      footer();
      pages.push(commands.join('\n'));
    }

    const objects = [];
    const addObject = (body) => {
      objects.push(body);
      return objects.length;
    };

    const catalogId = addObject('<< /Type /Catalog /Pages 2 0 R >>');
    const pagesId = addObject('');
    const fontRegularId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const fontBoldId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

    const pageIds = [];
    pages.forEach((content) => {
      const contentBuffer = Buffer.from(content, 'utf8');
      const contentId = addObject(`<< /Length ${contentBuffer.length} >>\nstream\n${content}\nendstream`);
      const pageId = addObject([
        '<< /Type /Page',
        `/Parent ${pagesId} 0 R`,
        `/MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}]`,
        `/Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >>`,
        `/Contents ${contentId} 0 R`,
        '>>'
      ].join('\n'));
      pageIds.push(pageId);
    });

    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

    const chunks = ['%PDF-1.4\n'];
    const offsets = [0];
    objects.forEach((body, index) => {
      offsets.push(Buffer.byteLength(chunks.join(''), 'utf8'));
      chunks.push(`${index + 1} 0 obj\n${body}\nendobj\n`);
    });
    const xrefOffset = Buffer.byteLength(chunks.join(''), 'utf8');
    chunks.push(`xref\n0 ${objects.length + 1}\n`);
    chunks.push('0000000000 65535 f \n');
    offsets.slice(1).forEach((offset) => {
      chunks.push(`${String(offset).padStart(10, '0')} 00000 n \n`);
    });
    chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

    return Buffer.from(chunks.join(''), 'utf8');
  }

  newPage();
  return {
    bullet,
    heading,
    keyValue,
    metricCard,
    newPage,
    pageWidth,
    paragraph,
    finish,
    get y() {
      return y;
    },
    set y(value) {
      y = value;
    },
    margin,
    textAt
  };
}

function generateScanPdfReport(input) {
  const report = buildReportModel(input);
  const pdf = createPdf();
  const cardWidth = 120;
  const cardGap = 10;
  const startX = pdf.margin;

  pdf.textAt('Website Scan Report', pdf.margin, pdf.y, { bold: true, size: 30, color: '#111827' });
  pdf.y -= 24;
  pdf.paragraph(report.narrative, { size: 11, maxChars: 86, color: '#374151' });
  pdf.keyValue('Project', report.project.name);
  pdf.keyValue('Website', report.project.websiteUrl || 'Not supplied');
  pdf.keyValue('Scan status', report.scan.status);
  pdf.keyValue('Started', formatDate(report.scan.startedAt || report.scan.createdAt));
  pdf.keyValue('Completed', formatDate(report.scan.completedAt));
  pdf.y -= 8;

  const metricY = pdf.y - 58;
  [
    ['Pages scanned', report.summary.pagesScanned],
    ['Pages found', report.summary.pagesFound],
    ['Issues', report.summary.issueCount],
    ['Actions', report.recommendations.length]
  ].forEach(([label, value], index) => {
    pdf.metricCard(label, value, startX + (index * (cardWidth + cardGap)), metricY, cardWidth);
  });
  pdf.y = metricY - 24;

  pdf.heading('Evidence Snapshot');
  pdf.bullet(`${report.summary.criticalCount} critical issues, ${report.summary.warningCount} warnings, ${report.summary.opportunityCount} opportunities.`);
  pdf.bullet(`${report.summary.failedPages} failed pages recorded.`);
  if (report.topIssueTypes.length) {
    pdf.bullet(`Most common issue types: ${report.topIssueTypes.map((item) => `${item.type} (${item.count})`).join(', ')}.`);
  }

  pdf.heading('Priority Actions');
  if (!report.recommendations.length) {
    pdf.paragraph('No saved scan recommendations were available. Review the issue register and generate recommendations from the scan evidence.');
  } else {
    report.recommendations.slice(0, 12).forEach((item, index) => {
      pdf.paragraph(`${index + 1}. Priority ${item.priority || '-'} - ${cleanText(item.title, 140)}`, { bold: true, maxChars: 84, after: 2 });
      pdf.bullet(cleanText(item.reason, 420), { maxChars: 82 });
      if (item.expectedImpact) pdf.bullet(`Expected impact: ${cleanText(item.expectedImpact, 240)}`, { maxChars: 82 });
    });
  }

  pdf.heading('Competitor Gaps');
  if (!report.competitorInsights.length) {
    pdf.paragraph('No competitor gaps were attached to this scan report. Add competitors or run competitor discovery to compare metadata, structure, schema, and content depth.');
  } else {
    report.competitorInsights.slice(0, 10).forEach((item, index) => {
      pdf.paragraph(`${index + 1}. Priority ${item.priority || '-'} - ${cleanText(item.title, 160)}`, { bold: true, maxChars: 84, after: 2 });
      if (item.insight) pdf.bullet(`What they do better: ${cleanText(item.insight, 360)}`, { maxChars: 82 });
      if (item.opportunity) pdf.bullet(`What to improve: ${cleanText(item.opportunity, 360)}`, { maxChars: 82 });
    });
  }

  pdf.heading('Issue Register');
  if (!report.issues.length) {
    pdf.paragraph('No SEO issues were stored for this scan.');
  } else {
    report.issues.forEach((issue, index) => {
      pdf.paragraph(`${index + 1}. ${cleanText(issue.severity, 40).toUpperCase()} - ${cleanText(issue.title, 150)}`, { bold: true, maxChars: 86, after: 2 });
      pdf.keyValue('Page', issue.url);
      pdf.keyValue('Recommendation', issue.recommendation);
    });
  }

  pdf.heading('Page Audit Register');
  if (!report.pages.length) {
    pdf.paragraph('No crawled pages were stored for this scan.');
  } else {
    report.pages.forEach((page, index) => {
      pdf.paragraph(`${index + 1}. ${cleanText(page.title || page.url, 160)}`, { bold: true, maxChars: 86, after: 2 });
      pdf.keyValue('URL', page.url);
      pdf.keyValue('Status / words / missing alt', `${page.statusCode || 0} / ${page.wordCount || 0} / ${page.imagesMissingAlt || 0}`);
      pdf.keyValue('Meta description', page.metaDescription || 'Missing');
      pdf.keyValue('H1', Array.isArray(page.h1) && page.h1.length ? page.h1.join(' | ') : 'Missing');
    });
  }

  return {
    buffer: pdf.finish(),
    filename: `${safeFilename(report.project.name)}-${safeFilename(report.scan._id)}-scan-report.pdf`
  };
}

module.exports = {
  buildReportModel,
  generateScanPdfReport,
  safeFilename
};
