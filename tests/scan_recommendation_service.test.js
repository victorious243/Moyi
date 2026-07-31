const test = require('node:test');
const assert = require('node:assert/strict');
const { replaceScanRecommendations } = require('../services/scanRecommendationService');

test('completed scans replace only their own recommendations with evidence-backed actions', async () => {
  const deletedFilters = [];
  const inserted = [];
  const RecommendationModel = {
    async deleteMany(filter) {
      deletedFilters.push(filter);
    },
    async insertMany(items) {
      inserted.push(...items);
      return items;
    }
  };
  const project = {
    _id: 'project_1',
    name: 'Moyi',
    websiteUrl: 'https://moyi.example'
  };
  const pages = [
    { url: 'https://moyi.example/pricing' }
  ];
  const issues = [
    {
      _id: '60c72b2f9b1d8b2e5c8b4570',
      url: 'https://moyi.example/pricing',
      type: 'missing_meta_description',
      severity: 'warning',
      title: 'Missing meta description',
      evidence: { metaDescription: '' },
      recommendation: 'Add a useful meta description.'
    }
  ];

  const result = await replaceScanRecommendations({
    project,
    scanId: 'scan_2',
    pages,
    issues,
    RecommendationModel
  });

  assert.deepEqual(deletedFilters, [{ projectId: 'project_1', auditId: 'scan_2' }]);
  assert.equal(result.length, 1);
  assert.equal(inserted[0].auditId, 'scan_2');
  assert.equal(inserted[0].projectId, 'project_1');
  assert.deepEqual(inserted[0].relatedIssueIds, ['60c72b2f9b1d8b2e5c8b4570']);
  assert.deepEqual(inserted[0].targetUrls, ['https://moyi.example/pricing']);
});

test('a scan with no supported findings clears stale recommendations without inventing new ones', async () => {
  let deleteCount = 0;
  let insertCount = 0;
  const RecommendationModel = {
    async deleteMany() {
      deleteCount += 1;
    },
    async insertMany() {
      insertCount += 1;
      return [];
    }
  };

  const result = await replaceScanRecommendations({
    project: {
      _id: 'project_1',
      name: 'Moyi',
      websiteUrl: 'https://moyi.example'
    },
    scanId: 'scan_clean',
    pages: [{ url: 'https://moyi.example' }],
    issues: [],
    RecommendationModel
  });

  assert.deepEqual(result, []);
  assert.equal(deleteCount, 1);
  assert.equal(insertCount, 0);
});
