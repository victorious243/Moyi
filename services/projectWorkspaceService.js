function priorityWeight(recommendation) {
  const statusRank = {
    in_progress: 0,
    accepted: 1,
    pending: 2,
    done: 3,
    rejected: 4
  };
  return [
    statusRank[recommendation.status] ?? 5,
    Number(recommendation.priority || 5),
    recommendation.createdAt ? new Date(recommendation.createdAt).getTime() : 0
  ];
}

function compareRecommendations(a, b) {
  const left = priorityWeight(a);
  const right = priorityWeight(b);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function titleCase(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function summaryText(value, fallback) {
  const clean = String(value || '').trim();
  return clean || fallback;
}

function buildScorecards({
  project,
  latestScan,
  latestReport,
  connectedProperty,
  telemetry,
  recommendationCounts,
  draftCounts
}) {
  const evidenceScore = latestScan
    ? clamp(34 + Math.min(Number(latestScan.pagesScanned || 0), 140) * 0.35 + (latestScan.status === 'completed' ? 18 : 6))
    : 14;
  const strategyScore = latestReport && latestReport.status !== 'failed'
    ? 86
    : (latestScan && latestScan.status === 'completed' ? 56 : 18);
  const measurementScore = Math.round((((connectedProperty ? 88 : 26) + Number(telemetry.score || 0)) / 2));
  const executionScore = clamp(
    18 +
    recommendationCounts.inProgress * 10 +
    recommendationCounts.done * 8 +
    (draftCounts.awaitingReview + draftCounts.needsRevision) * 6 +
    draftCounts.approved * 7
  );

  return [
    {
      label: 'Evidence',
      score: evidenceScore,
      detail: latestScan
        ? `${latestScan.pagesScanned || 0} pages scanned and available for decision-making.`
        : 'No factual website evidence collected yet.'
    },
    {
      label: 'Strategy',
      score: strategyScore,
      detail: latestReport && latestReport.status !== 'failed'
        ? 'An AI CMO plan exists and can drive weekly priorities.'
        : 'Strategy is still waiting on a completed scan and plan.'
    },
    {
      label: 'Measurement',
      score: measurementScore,
      detail: connectedProperty
        ? `Search Console is connected and telemetry quality is ${telemetry.score || 0}% by Moyi's internal measurement checklist.`
        : `Telemetry quality is ${telemetry.score || 0}% by Moyi's internal measurement checklist, and Search Console is still disconnected.`
    },
    {
      label: 'Execution',
      score: executionScore,
      detail: recommendationCounts.open || draftCounts.awaitingReview || draftCounts.needsRevision || draftCounts.approved
        ? `${recommendationCounts.open} open recommendations and ${draftCounts.awaitingReview + draftCounts.needsRevision} drafts need attention.`
        : `Execution is quiet for ${project.name}; there is no active work queue yet.`
    }
  ];
}

function buildRecommendationCounts(recommendations) {
  return recommendations.reduce((summary, recommendation) => {
    if (recommendation.status === 'accepted') summary.accepted += 1;
    if (recommendation.status === 'pending') summary.pending += 1;
    if (recommendation.status === 'in_progress') summary.inProgress += 1;
    if (recommendation.status === 'done') summary.done += 1;
    if (!['done', 'rejected'].includes(recommendation.status)) summary.open += 1;
    return summary;
  }, {
    accepted: 0,
    pending: 0,
    inProgress: 0,
    done: 0,
    open: 0
  });
}

function buildDraftCounts(drafts) {
  return drafts.reduce((summary, draft) => {
    if (draft.status === 'draft' || draft.status === 'awaiting_review') summary.awaitingReview += 1;
    if (draft.status === 'needs_revision') summary.needsRevision += 1;
    if (draft.status === 'approved') summary.approved += 1;
    if (draft.status === 'published_manually') summary.published += 1;
    return summary;
  }, {
    awaitingReview: 0,
    needsRevision: 0,
    approved: 0,
    published: 0
  });
}

function buildPrimaryAction({ project, latestScan, latestReport, connectedProperty, telemetry, recommendationCounts, draftCounts }) {
  if (!latestScan) {
    return {
      eyebrow: 'First move',
      title: 'Run the first website scan',
      body: 'Collect factual page evidence before the workspace starts ranking growth priorities.',
      action: {
        method: 'post',
        href: `/projects/${project._id}/scans`,
        label: 'Run Website Scan',
        loadingState: 'Running a factual website scan'
      }
    };
  }

  if (!latestReport || latestReport.status === 'failed') {
    return {
      eyebrow: 'Next move',
      title: 'Generate the AI CMO plan',
      body: 'Turn the latest evidence into priorities, risks, quick wins, and the weekly action plan.',
      action: {
        method: 'post',
        href: `/projects/${project._id}/ai-report`,
        label: 'Generate Plan',
        loadingState: 'Building your AI CMO plan'
      }
    };
  }

  if (!connectedProperty) {
    return {
      eyebrow: 'Measurement gap',
      title: 'Connect Search Console',
      body: 'The workspace can prioritize faster once search demand and CTR signals are grounded in real query data.',
      action: {
        method: 'get',
        href: `/projects/${project._id}/search-console/connect`,
        label: 'Connect Search Console'
      }
    };
  }

  if (telemetry.score < 85) {
    return {
      eyebrow: 'Trust gap',
      title: 'Fix the measurement stack',
      body: 'Before the workspace leans harder on measurement-driven prioritization, tracking quality needs to cross the trust threshold.',
      action: {
        method: 'get',
        href: `/projects/${project._id}/tracking/setup`,
        label: 'Review Tracking Setup'
      }
    };
  }

  if (draftCounts.awaitingReview + draftCounts.needsRevision > 0) {
    return {
      eyebrow: 'Execution queue',
      title: 'Review drafts waiting in the queue',
      body: 'The highest-value next step is turning generated work into approved assets the team can ship.',
      action: {
        method: 'get',
        href: `/projects/${project._id}/content`,
        label: 'Open Approval Queue'
      }
    };
  }

  if (recommendationCounts.open > 0) {
    return {
      eyebrow: 'Execution queue',
      title: 'Move one top recommendation into action',
      body: 'The workspace already knows what to do next; the bottleneck is execution, not strategy.',
      action: {
        method: 'get',
        href: `/projects/${project._id}/recommendations`,
        label: 'Review Recommendations'
      }
    };
  }

  return {
    eyebrow: 'Momentum',
    title: 'Review this week’s progress',
    body: 'Use reports and search performance to confirm whether completed work is changing visibility and conversion quality.',
    action: {
      method: 'get',
      href: `/projects/${project._id}/reports`,
      label: 'Open Reports'
    }
  };
}

function buildTopPriorities({ project, recommendations, latestReport, issues }) {
  const openRecommendations = recommendations
    .filter((recommendation) => !['done', 'rejected'].includes(recommendation.status))
    .sort(compareRecommendations)
    .slice(0, 3)
    .map((recommendation) => ({
      title: recommendation.title,
      body: summaryText(recommendation.expectedImpact, recommendation.reason || 'Review this recommendation and decide whether to move it into the execution queue.'),
      badge: `${titleCase(recommendation.status)} / Priority ${recommendation.priority}`,
      href: `/projects/${project._id}/recommendations`
    }));

  if (openRecommendations.length) return openRecommendations;

  if (latestReport && latestReport.status !== 'failed' && Array.isArray(latestReport.topPriorities)) {
    return latestReport.topPriorities.slice(0, 3).map((priority) => ({
      title: priority,
      body: summaryText(latestReport.mainGrowthOpportunity, 'The AI CMO plan flagged this as one of the highest-value growth moves.'),
      badge: 'AI plan',
      href: `/projects/${project._id}/ai-report/latest`
    }));
  }

  return issues.slice(0, 3).map((issue) => ({
    title: issue.title,
    body: issue.recommendation,
    badge: `${titleCase(issue.severity)} issue`,
    href: `/projects/${project._id}/pages`
  }));
}

function buildQuickWins({ project, recommendations, latestReport, issues }) {
  const quickWins = recommendations
    .filter((recommendation) => !['done', 'rejected'].includes(recommendation.status) && recommendation.effort === 'low')
    .sort(compareRecommendations)
    .slice(0, 3)
    .map((recommendation) => ({
      title: recommendation.title,
      detail: summaryText(recommendation.reason, recommendation.expectedImpact || 'Low-effort improvement identified by the workspace.'),
      href: `/projects/${project._id}/recommendations`
    }));

  if (quickWins.length) return quickWins;

  if (latestReport && latestReport.status !== 'failed' && Array.isArray(latestReport.quickWins) && latestReport.quickWins.length) {
    return latestReport.quickWins.slice(0, 3).map((item) => ({
      title: item,
      detail: 'Low-friction work the current AI CMO plan thinks should move first.',
      href: `/projects/${project._id}/ai-report/latest`
    }));
  }

  return issues
    .filter((issue) => issue.severity !== 'critical')
    .slice(0, 3)
    .map((issue) => ({
      title: issue.title,
      detail: issue.recommendation,
      href: `/projects/${project._id}/pages`
    }));
}

function buildStrategicBet({ project, recommendations, latestReport }) {
  const bet = recommendations
    .filter((recommendation) => !['done', 'rejected'].includes(recommendation.status) && ['content', 'new_page'].includes(recommendation.actionType))
    .sort(compareRecommendations)[0];

  if (bet) {
    return {
      title: bet.title,
      body: summaryText(bet.expectedImpact, bet.reason || 'This is the strongest medium-term growth bet in the current queue.'),
      href: `/projects/${project._id}/recommendations`
    };
  }

  if (latestReport && latestReport.status !== 'failed') {
    return {
      title: 'Strategic growth opportunity',
      body: summaryText(latestReport.mainGrowthOpportunity, 'A strategic bet will appear here once the workspace has enough evidence.'),
      href: `/projects/${project._id}/ai-report/latest`
    };
  }

  return {
    title: 'Strategic direction still forming',
    body: 'Moyi needs at least one completed scan and plan before it can surface a credible strategic bet.',
    href: `/projects/${project._id}`
  };
}

function buildMeasurementGaps({ project, connectedProperty, telemetry, conversionGoalCount, recentCmoReports }) {
  const gaps = [];

  if (!connectedProperty) {
    gaps.push({
      title: 'Search demand is still partially invisible',
      detail: 'Connect Search Console so the workspace can rank opportunities using real query and CTR data.',
      href: `/projects/${project._id}/search-console/connect`
    });
  }

  if (telemetry.score < 85) {
    gaps.push({
      title: 'Tracking quality is below the workflow threshold',
      detail: `Telemetry health is ${telemetry.score || 0}%. Until this improves, Moyi should stay evidence-led and review-heavy.`,
      href: `/projects/${project._id}/tracking/setup`
    });
  }

  if (!conversionGoalCount) {
    gaps.push({
      title: 'No conversion goals are defined',
      detail: 'Without conversion goals, the workspace can describe traffic but not whether growth work is producing business outcomes.',
      href: `/projects/${project._id}/tracking/setup`
    });
  }

  if (!recentCmoReports.length) {
    gaps.push({
      title: 'No reporting cadence is active yet',
      detail: 'Weekly and monthly reports are how the workspace closes the loop on what changed after execution.',
      href: `/projects/${project._id}/reports`
    });
  }

  return gaps.slice(0, 4);
}

function buildExecutionQueue({ project, recommendationCounts, draftCounts }) {
  const items = [];

  if (recommendationCounts.pending > 0) {
    items.push({
      title: `${recommendationCounts.pending} recommendation${recommendationCounts.pending === 1 ? '' : 's'} waiting for review`,
      detail: 'Review and accept only the work that deserves this week’s attention.',
      href: `/projects/${project._id}/recommendations`
    });
  }

  if (recommendationCounts.inProgress > 0) {
    items.push({
      title: `${recommendationCounts.inProgress} recommendation${recommendationCounts.inProgress === 1 ? '' : 's'} in progress`,
      detail: 'Keep the team focused on finishing already-started work before opening more threads.',
      href: `/projects/${project._id}/recommendations`
    });
  }

  if (draftCounts.awaitingReview > 0) {
    items.push({
      title: `${draftCounts.awaitingReview} draft${draftCounts.awaitingReview === 1 ? '' : 's'} awaiting approval`,
      detail: 'Review copy, approve what is strong, and reject anything that is generic or unsupported.',
      href: `/projects/${project._id}/content`
    });
  }

  if (draftCounts.needsRevision > 0) {
    items.push({
      title: `${draftCounts.needsRevision} draft${draftCounts.needsRevision === 1 ? '' : 's'} sent back for revision`,
      detail: 'Tighten the brief or copy, then resubmit for review instead of forcing weak assets through.',
      href: `/projects/${project._id}/content`
    });
  }

  if (draftCounts.approved > 0) {
    items.push({
      title: `${draftCounts.approved} approved draft${draftCounts.approved === 1 ? '' : 's'} ready to ship`,
      detail: 'Move approved content into publishing or implementation while context is still fresh.',
      href: `/projects/${project._id}/content`
    });
  }

  return items.slice(0, 4);
}

function buildThisWeekPlan({ project, latestScan, latestReport, connectedProperty, telemetry, conversionGoalCount, draftCounts, recommendationCounts }) {
  const steps = [];

  if (!latestScan) {
    steps.push({
      title: 'Collect website evidence',
      detail: 'Run the first scan so the workspace stops operating on assumptions.',
      action: {
        method: 'post',
        href: `/projects/${project._id}/scans`,
        label: 'Run scan',
        loadingState: 'Running a factual website scan'
      }
    });
  }

  if (latestScan && (!latestReport || latestReport.status === 'failed')) {
    steps.push({
      title: 'Generate the current strategy brief',
      detail: 'Convert the latest scan into ranked priorities and a credible weekly plan.',
      action: {
        method: 'post',
        href: `/projects/${project._id}/ai-report`,
        label: 'Generate plan',
        loadingState: 'Building your AI CMO plan'
      }
    });
  }

  if (!connectedProperty) {
    steps.push({
      title: 'Connect Search Console',
      detail: 'Unlock page-one CTR and page-two demand opportunities using real performance data.',
      action: {
        method: 'get',
        href: `/projects/${project._id}/search-console/connect`,
        label: 'Connect'
      }
    });
  }

  if (telemetry.score < 85) {
    steps.push({
      title: 'Raise measurement trust',
      detail: `Telemetry is at ${telemetry.score || 0}%. Fix tracking before trusting deeper automation or revenue narratives.`,
      action: {
        method: 'get',
        href: `/projects/${project._id}/tracking/setup`,
        label: 'Review tracking'
      }
    });
  }

  if (!conversionGoalCount) {
    steps.push({
      title: 'Define conversion goals',
      detail: 'Pick the events that actually matter so the workspace can judge whether execution is working.',
      action: {
        method: 'get',
        href: `/projects/${project._id}/tracking/setup`,
        label: 'Add goals'
      }
    });
  }

  if (draftCounts.awaitingReview + draftCounts.needsRevision > 0) {
    steps.push({
      title: 'Review the approval queue',
      detail: 'Approve or reject content drafts so recommended work becomes usable execution assets.',
      action: {
        method: 'get',
        href: `/projects/${project._id}/content`,
        label: 'Open queue'
      }
    });
  } else if (recommendationCounts.open > 0) {
    steps.push({
      title: 'Move one top recommendation forward',
      detail: 'Do not expand scope. Pick the highest-value open item and execute it fully.',
      action: {
        method: 'get',
        href: `/projects/${project._id}/recommendations`,
        label: 'Review queue'
      }
    });
  }

  if (!steps.length) {
    steps.push({
      title: 'Review the latest report',
      detail: 'Use this week to validate whether completed work improved visibility, traffic quality, or conversions.',
      action: {
        method: 'get',
        href: `/projects/${project._id}/reports`,
        label: 'Open reports'
      }
    });
  }

  return steps.slice(0, 4);
}

function buildWorkspaceSummary({
  project,
  latestScan,
  latestReport,
  recommendations = [],
  drafts = [],
  issues = [],
  connectedProperty,
  telemetry = {},
  competitorCount = 0,
  conversionGoalCount = 0,
  recentCmoReports = []
}) {
  const recommendationCounts = buildRecommendationCounts(recommendations);
  const draftCounts = buildDraftCounts(drafts);
  const scorecards = buildScorecards({
    project,
    latestScan,
    latestReport,
    connectedProperty,
    telemetry,
    recommendationCounts,
    draftCounts
  });
  const overallScore = Math.round(scorecards.reduce((sum, item) => sum + item.score, 0) / scorecards.length);

  return {
    overallScore,
    scorecards,
    recommendationCounts,
    draftCounts,
    primaryAction: buildPrimaryAction({
      project,
      latestScan,
      latestReport,
      connectedProperty,
      telemetry,
      recommendationCounts,
      draftCounts
    }),
    topPriorities: buildTopPriorities({
      project,
      recommendations,
      latestReport,
      issues
    }),
    quickWins: buildQuickWins({
      project,
      recommendations,
      latestReport,
      issues
    }),
    strategicBet: buildStrategicBet({
      project,
      recommendations,
      latestReport
    }),
    measurementGaps: buildMeasurementGaps({
      project,
      connectedProperty,
      telemetry,
      conversionGoalCount,
      recentCmoReports
    }),
    thisWeekPlan: buildThisWeekPlan({
      project,
      latestScan,
      latestReport,
      connectedProperty,
      telemetry,
      conversionGoalCount,
      draftCounts,
      recommendationCounts
    }),
    executionQueue: buildExecutionQueue({
      project,
      recommendationCounts,
      draftCounts
    }),
    businessRisk: latestReport && latestReport.status !== 'failed'
      ? summaryText(latestReport.mainBusinessRisk, 'No primary business risk has been captured yet.')
      : (issues.find((issue) => issue.severity === 'critical') || {}).recommendation || 'No risk narrative yet. Run a scan and plan to expose the main blocker.',
    growthOpportunity: latestReport && latestReport.status !== 'failed'
      ? summaryText(latestReport.mainGrowthOpportunity, 'No main growth opportunity has been captured yet.')
      : (recommendations.sort(compareRecommendations)[0] || {}).expectedImpact || 'A main growth opportunity will appear once evidence and strategy are available.',
    competitorCount
  };
}

module.exports = {
  buildWorkspaceSummary,
  buildDraftCounts,
  buildRecommendationCounts
};
