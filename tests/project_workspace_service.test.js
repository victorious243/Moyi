const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWorkspaceSummary } = require('../services/projectWorkspaceService');

function baseProject() {
  return {
    _id: '6890f61f3adcbf6bc4c11f10',
    name: 'Moyi',
    websiteUrl: 'https://moyi.example',
    mainGoal: 'Create qualified pipeline',
    targetAudience: 'B2B SaaS teams',
    mainOffer: 'AI CMO workspace'
  };
}

test('project workspace starts with evidence and measurement-first actions when the project is still immature', () => {
  const workspace = buildWorkspaceSummary({
    project: baseProject(),
    latestScan: null,
    latestReport: null,
    recommendations: [],
    drafts: [],
    issues: [],
    connectedProperty: null,
    telemetry: { score: 32, autonomousActionsBlocked: true },
    competitorCount: 0,
    conversionGoalCount: 0,
    recentCmoReports: []
  });

  assert.equal(workspace.primaryAction.title, 'Run the first website scan');
  assert.equal(workspace.thisWeekPlan[0].title, 'Collect website evidence');
  assert.ok(workspace.measurementGaps.some((gap) => gap.title.includes('Search demand')));
  assert.ok(workspace.measurementGaps.some((gap) => gap.title.includes('No conversion goals')));
  assert.ok(workspace.scorecards.find((card) => card.label === 'Evidence').score < 30);
});

test('project workspace prefers open recommendations and execution queue once strategy exists', () => {
  const workspace = buildWorkspaceSummary({
    project: baseProject(),
    latestScan: { status: 'completed', pagesScanned: 48 },
    latestReport: {
      status: 'ready',
      topPriorities: ['Improve commercial pages', 'Refresh homepage messaging'],
      quickWins: ['Rewrite homepage title tag'],
      mainBusinessRisk: 'Important pages are not converting qualified traffic.',
      mainGrowthOpportunity: 'Create high-intent comparison content.'
    },
    recommendations: [
      {
        title: 'Rewrite homepage metadata',
        priority: 1,
        status: 'accepted',
        effort: 'low',
        actionType: 'fix_metadata',
        expectedImpact: 'Increase qualified CTR on branded and commercial searches.',
        reason: 'Homepage metadata is weak.'
      },
      {
        title: 'Create comparison landing page',
        priority: 2,
        status: 'pending',
        effort: 'high',
        actionType: 'new_page',
        expectedImpact: 'Capture high-intent buyers near the decision stage.',
        reason: 'Commercial comparison intent is underserved.'
      }
    ],
    drafts: [
      { status: 'draft' },
      { status: 'approved' }
    ],
    issues: [
      { title: 'Missing title tag', severity: 'critical', recommendation: 'Add a title tag.' }
    ],
    connectedProperty: { siteUrl: 'https://moyi.example/' },
    telemetry: { score: 91, autonomousActionsBlocked: false },
    competitorCount: 2,
    conversionGoalCount: 2,
    recentCmoReports: [{ _id: 'report_1' }]
  });

  assert.equal(workspace.topPriorities[0].title, 'Rewrite homepage metadata');
  assert.equal(workspace.quickWins[0].title, 'Rewrite homepage metadata');
  assert.equal(workspace.strategicBet.title, 'Create comparison landing page');
  assert.ok(workspace.executionQueue.some((item) => item.title.includes('draft')));
  assert.equal(workspace.primaryAction.title, 'Review drafts waiting in the queue');
});
