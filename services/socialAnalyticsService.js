const GrowthSignal = require('../models/GrowthSignal');
const PublishJob = require('../models/PublishJob');
const SocialAccount = require('../models/SocialAccount');

const ANALYTICS_WINDOWS = new Set([7, 30, 90]);
const INTERACTION_FIELDS = ['likes', 'comments', 'shares', 'quotes', 'saves', 'clicks'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TOPIC_STOPWORDS = new Set([
  'about', 'after', 'again', 'also', 'and', 'are', 'because', 'before', 'being', 'built',
  'business', 'can', 'cmo', 'content', 'from', 'growth', 'have', 'help', 'helps', 'into',
  'learn', 'marketing', 'more', 'moyi', 'post', 'that', 'the', 'their', 'this', 'through',
  'today', 'users', 'with', 'your'
]);
const EMPTY_RECOMMENDATION_INPUTS = {
  evidenceQuality: {
    confidence: 'none',
    sampleSize: 0,
    note: 'No engagement snapshots have been collected in this window.'
  },
  bestContentPatterns: [],
  weakContentPatterns: [],
  suggestedNextActions: []
};
const EMPTY_GROWTH_BRAIN_UPGRADE = {
  whatWorked: [],
  bestPostingTimes: [],
  bestPlatforms: [],
  winningHooks: [],
  winningTopics: [],
  winningFormats: [],
  lowPerformingWarnings: [],
  improvedDraftSuggestions: []
};

function normalizeAnalyticsDays(value) {
  const days = Number(value || 30);
  return ANALYTICS_WINDOWS.has(days) ? days : 30;
}

function destinationProjectFilter(projectId) {
  return {
    $or: [
      { destinationProjectId: projectId },
      { projectId, destinationProjectId: null },
      { projectId, destinationProjectId: { $exists: false } }
    ]
  };
}

function metricNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function primaryExposure(metrics = {}) {
  for (const field of ['impressions', 'reach', 'views', 'videoViews']) {
    const value = metricNumber(metrics[field]);
    if (value !== null) return { field, value };
  }
  return { field: '', value: null };
}

function interactionTotal(metrics = {}) {
  const values = INTERACTION_FIELDS
    .map((field) => metricNumber(metrics[field]))
    .filter((value) => value !== null);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function publicMetrics(metrics = {}) {
  return Object.fromEntries(Object.entries(metrics || {})
    .map(([field, value]) => [field, metricNumber(value)])
    .filter(([, value]) => value !== null));
}

function classifyContentType(job) {
  const media = Array.isArray(job.mediaIds) ? job.mediaIds : [];
  const mimeTypes = media.map((item) => String(item && item.mimeType || '').toLowerCase()).filter(Boolean);
  if (media.length > 1) return 'carousel';
  if (mimeTypes.some((mimeType) => mimeType.startsWith('video/'))) return 'video';
  if (
    mimeTypes.some((mimeType) => mimeType.startsWith('image/'))
    || (job.content && job.content.imageUrl)
    || (job.draftId && job.draftId.contentImageId)
  ) return 'image';
  return 'text';
}

function postPerformanceRow(job) {
  const metrics = publicMetrics(job.metricsLatest || {});
  const exposure = primaryExposure(metrics);
  const engagements = interactionTotal(metrics);
  const sourceMatchesDestination = String(job.projectId) === String(job.destinationProjectId || job.projectId);
  const campaign = sourceMatchesDestination && job.draftId && job.draftId.campaignId
    ? job.draftId.campaignId
    : null;
  return {
    id: String(job._id),
    platform: job.platform,
    accountName: job.accountId && job.accountId.accountName ? job.accountId.accountName : 'Connected account',
    title: sourceMatchesDestination && job.draftId && job.draftId.title ? job.draftId.title : '',
    campaignId: campaign && campaign._id ? String(campaign._id) : '',
    campaignName: campaign && campaign.name ? campaign.name : 'Unassigned campaign',
    campaignGoal: campaign && campaign.goal ? campaign.goal : '',
    campaignChannel: campaign && campaign.channel ? campaign.channel : '',
    contentType: classifyContentType(job),
    publishedAt: job.publishedAt,
    platformUrl: job.platformUrl || '',
    metricsStatus: job.metricsStatus || 'pending',
    metricsCapturedAt: job.metricsCapturedAt || null,
    availableFields: job.metricsAvailableFields || [],
    metrics,
    exposureField: exposure.field,
    exposure: exposure.value,
    engagements,
    engagementRate: exposure.value !== null && exposure.value > 0 && engagements !== null
      ? engagements / exposure.value
      : null
  };
}

function sumAvailableMetrics(posts, fields) {
  const values = posts.flatMap((post) => fields
    .map((field) => metricNumber(post.metrics[field]))
    .filter((value) => value !== null));
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function summarizePostMetrics(posts) {
  const exposurePosts = posts.filter((post) => post.exposure !== null);
  const engagementPosts = posts.filter((post) => post.engagements !== null);
  const ratePosts = engagementPosts.filter((post) => post.exposure !== null);
  const exposure = exposurePosts.length
    ? exposurePosts.reduce((total, post) => total + post.exposure, 0)
    : null;
  const engagements = engagementPosts.length
    ? engagementPosts.reduce((total, post) => total + post.engagements, 0)
    : null;
  const engagementExposure = ratePosts.reduce((total, post) => total + post.exposure, 0);
  const rateEngagements = ratePosts.reduce((total, post) => total + post.engagements, 0);
  return {
    exposure,
    engagements,
    clicks: sumAvailableMetrics(posts, ['clicks']),
    likes: sumAvailableMetrics(posts, ['likes']),
    comments: sumAvailableMetrics(posts, ['comments']),
    shares: sumAvailableMetrics(posts, ['shares', 'quotes']),
    engagementRate: ratePosts.length && engagementExposure > 0
      ? rateEngagements / engagementExposure
      : null
  };
}

function summarizePlatforms(posts) {
  const grouped = new Map();
  posts.forEach((post) => {
    if (!grouped.has(post.platform)) grouped.set(post.platform, []);
    grouped.get(post.platform).push(post);
  });
  return [...grouped.entries()]
    .map(([platform, platformPosts]) => ({
      platform,
      posts: platformPosts.length,
      measuredPosts: platformPosts.filter((post) => post.availableFields.length).length,
      ...summarizePostMetrics(platformPosts)
    }))
    .sort((left, right) => (
      Number(right.exposure || 0) - Number(left.exposure || 0)
      || Number(right.engagements || 0) - Number(left.engagements || 0)
    ));
}

function summarizeCampaigns(posts) {
  const grouped = new Map();
  posts.forEach((post) => {
    const key = post.campaignId || `unassigned:${post.campaignName}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(post);
  });
  return [...grouped.values()]
    .map((campaignPosts) => ({
      campaignId: campaignPosts[0].campaignId,
      campaignName: campaignPosts[0].campaignName,
      campaignGoal: campaignPosts[0].campaignGoal,
      campaignChannel: campaignPosts[0].campaignChannel,
      posts: campaignPosts.length,
      measuredPosts: campaignPosts.filter((post) => post.availableFields.length).length,
      ...summarizePostMetrics(campaignPosts)
    }))
    .sort((left, right) => (
      Number(right.engagements || 0) - Number(left.engagements || 0)
      || Number(right.exposure || 0) - Number(left.exposure || 0)
    ));
}

function summarizeContentTypes(posts) {
  const grouped = new Map();
  posts.forEach((post) => {
    if (!grouped.has(post.contentType)) grouped.set(post.contentType, []);
    grouped.get(post.contentType).push(post);
  });
  return [...grouped.entries()]
    .map(([contentType, contentPosts]) => ({
      contentType,
      posts: contentPosts.length,
      measuredPosts: contentPosts.filter((post) => post.availableFields.length).length,
      ...summarizePostMetrics(contentPosts)
    }))
    .sort((left, right) => (
      Number(right.engagementRate || 0) - Number(left.engagementRate || 0)
      || Number(right.engagements || 0) - Number(left.engagements || 0)
    ));
}

function reliabilitySummary(jobs, accounts) {
  const count = (statuses) => jobs.filter((job) => statuses.includes(job.status)).length;
  return {
    queued: count(['queued', 'preparing_media']),
    publishing: count(['publishing', 'provider_processing']),
    retrying: count(['retry_wait']),
    published: count(['published']),
    deadLetter: count(['dead_letter', 'failed']),
    reconnectRequired: accounts.filter((account) => account.status === 'reconnect_required').length
  };
}

async function buildSocialPerformanceDashboard({ projectId, days = 30 }) {
  const normalizedDays = normalizeAnalyticsDays(days);
  const since = new Date(Date.now() - normalizedDays * 24 * 60 * 60 * 1000);
  const destinationFilter = destinationProjectFilter(projectId);
  const [publishedJobs, operationalJobs, accounts] = await Promise.all([
    PublishJob.find({
      ...destinationFilter,
      status: 'published',
      publishedAt: { $gte: since }
    })
      .sort({ publishedAt: -1 })
      .populate('accountId', 'accountName platform status')
      .populate({
        path: 'draftId',
        select: 'title body channel campaignId contentImageId',
        populate: {
          path: 'campaignId',
          select: 'name goal channel cadence'
        }
      })
      .populate('mediaIds', 'mimeType')
      .lean(),
    PublishJob.find({
      ...destinationFilter,
      createdAt: { $gte: since }
    }).select('status').lean(),
    SocialAccount.find({ projectId })
      .select('platform accountName status metricsStatus metricsStatusMessage lastMetricsSyncAt reconnectRequiredAt')
      .sort({ platform: 1, accountName: 1 })
      .lean()
  ]);

  const posts = publishedJobs.map(postPerformanceRow);
  const platformRows = summarizePlatforms(posts);
  const campaignRows = summarizeCampaigns(posts);
  const contentTypeRows = summarizeContentTypes(posts);
  const totals = summarizePostMetrics(posts);
  totals.posts = posts.length;
  totals.measuredPosts = posts.filter((post) => post.availableFields.length).length;
  const growthBrain = await buildGrowthBrainSocialContext(projectId, { days: normalizedDays, limit: 12 });

  return {
    days: normalizedDays,
    since,
    generatedAt: new Date(),
    totals,
    platformRows,
    campaignRows,
    contentTypeRows,
    posts: [...posts].sort((left, right) => (
      Number(right.engagements || 0) - Number(left.engagements || 0)
      || Number(right.exposure || 0) - Number(left.exposure || 0)
    )),
    recentPosts: posts.slice(0, 50),
    accounts,
    reliability: reliabilitySummary(operationalJobs, accounts),
    growthBrain,
    lastMetricsSyncAt: posts
      .map((post) => post.metricsCapturedAt)
      .filter(Boolean)
      .sort((left, right) => new Date(right) - new Date(left))[0] || null
  };
}

function safeDraftExcerpt(signal) {
  if (!signal.draftId || !signal.draftId.body) return '';
  return String(signal.draftId.body).replace(/\s+/g, ' ').trim().slice(0, 280);
}

function signalMetrics(signal) {
  return publicMetrics(signal.evidence && signal.evidence.metrics || {});
}

function signalEngagementRate(signal) {
  return metricNumber(signal.evidence && signal.evidence.engagementRate);
}

function visibleSignalContent(signal, projectId) {
  const sourceMatchesDestination = String(signal.sourceProjectId) === String(projectId);
  return {
    title: sourceMatchesDestination && signal.draftId && signal.draftId.title ? signal.draftId.title : '',
    contentExcerpt: sourceMatchesDestination ? safeDraftExcerpt(signal) : ''
  };
}

function signalContentPattern(row) {
  const text = `${row.title || ''} ${row.contentExcerpt || ''}`.trim();
  if (!text) return 'observed platform copy';
  if (/\?/.test(text)) return 'question-led copy';
  if (/\b(?:case study|proof|result|data|metric|percent|growth|increase|decrease|benchmark)\b|%/.test(text)) return 'proof-led angle';
  if (/\b(?:how to|guide|tips?|steps?|learn|why|what)\b/i.test(text)) return 'educational angle';
  if (/\b(?:book|demo|try|get started|download|visit|learn more|sign up|start)\b|https?:\/\//i.test(text)) return 'clear CTA';
  if (text.length <= 140) return 'short direct copy';
  if (text.length >= 420) return 'long-form copy';
  return 'general campaign copy';
}

function contentFirstLine(row) {
  const text = `${row.title || ''}\n${row.contentExcerpt || ''}`
    .split(/\n+/)
    .map((line) => line.trim())
    .find(Boolean);
  return text ? text.slice(0, 180) : '';
}

function topicWords(row) {
  const text = `${row.title || ''} ${row.contentExcerpt || ''}`.toLowerCase();
  return (text.match(/[a-z][a-z0-9-]{3,}/g) || [])
    .map((word) => word.replace(/^-+|-+$/g, ''))
    .filter((word) => word.length >= 4 && !TOPIC_STOPWORDS.has(word))
    .slice(0, 24);
}

function recommendationSignalRow(signal, projectId) {
  const metrics = signalMetrics(signal);
  const exposure = primaryExposure(metrics);
  const engagements = interactionTotal(metrics);
  const visibleContent = visibleSignalContent(signal, projectId);
  const publishedAt = signal.evidence && signal.evidence.publishedAt ? signal.evidence.publishedAt : signal.observedAt;
  return {
    platform: signal.platform,
    score: Number(signal.score || 0),
    observedAt: signal.observedAt,
    publishedAt,
    ...visibleContent,
    pattern: signalContentPattern(visibleContent),
    hook: contentFirstLine(visibleContent),
    topics: topicWords(visibleContent),
    contentType: signal.evidence && signal.evidence.contentType ? signal.evidence.contentType : 'unknown',
    metrics,
    exposure: exposure.value,
    engagements,
    engagementRate: signalEngagementRate(signal)
  };
}

function average(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function groupRows(rows, keyFn) {
  const grouped = new Map();
  rows.forEach((row) => {
    const key = keyFn(row);
    if (!key) return;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });
  return grouped;
}

function summarizeRowGroup(rows) {
  const scores = rows.map((row) => Number(row.score || 0));
  const exposureValues = rows.map((row) => row.exposure).filter((value) => value !== null);
  const engagementValues = rows.map((row) => row.engagements).filter((value) => value !== null);
  const rateValues = rows.map((row) => row.engagementRate).filter((value) => value !== null);
  return {
    samples: rows.length,
    averageScore: Math.round(average(scores) || 0),
    bestScore: Math.max(...scores, 0),
    averageExposure: exposureValues.length ? Math.round(average(exposureValues)) : null,
    averageEngagements: engagementValues.length ? Math.round(average(engagementValues)) : null,
    averageEngagementRate: average(rateValues)
  };
}

function bestPostingTimesFromRows(rows) {
  const grouped = groupRows(rows, (row) => {
    const publishedAt = new Date(row.publishedAt || row.observedAt);
    if (Number.isNaN(publishedAt.getTime())) return '';
    return `${publishedAt.getUTCDay()}:${publishedAt.getUTCHours()}:${row.platform}`;
  });
  return [...grouped.entries()]
    .map(([key, groupRowsForTime]) => {
      const [day, hour, platform] = key.split(':');
      const dayIndex = Number(day);
      const hourValue = Number(hour);
      return {
        dayOfWeek: DAY_NAMES[dayIndex] || 'Unknown',
        hourUtc: hourValue,
        label: `${DAY_NAMES[dayIndex] || 'Unknown'} ${String(hourValue).padStart(2, '0')}:00 UTC`,
        platform,
        ...summarizeRowGroup(groupRowsForTime)
      };
    })
    .sort((left, right) => (
      right.averageScore - left.averageScore
      || right.samples - left.samples
    ))
    .slice(0, 5);
}

function bestPlatformsFromRows(rows) {
  return [...groupRows(rows, (row) => row.platform).entries()]
    .map(([platform, platformRows]) => ({
      platform,
      ...summarizeRowGroup(platformRows)
    }))
    .sort((left, right) => (
      right.averageScore - left.averageScore
      || right.samples - left.samples
    ))
    .slice(0, 6);
}

function winningHooksFromRows(rows) {
  return rows
    .filter((row) => row.hook)
    .sort((left, right) => right.score - left.score)
    .slice(0, 6)
    .map((row) => ({
      hook: row.hook,
      platform: row.platform,
      pattern: row.pattern,
      score: row.score,
      engagementRate: row.engagementRate
    }));
}

function winningTopicsFromRows(rows) {
  const grouped = new Map();
  rows.forEach((row) => {
    row.topics.forEach((topic) => {
      if (!grouped.has(topic)) grouped.set(topic, []);
      grouped.get(topic).push(row);
    });
  });
  return [...grouped.entries()]
    .map(([topic, topicRows]) => ({
      topic,
      ...summarizeRowGroup(topicRows)
    }))
    .filter((topic) => topic.samples >= 1)
    .sort((left, right) => (
      right.averageScore - left.averageScore
      || right.samples - left.samples
    ))
    .slice(0, 8);
}

function winningFormatsFromRows(rows) {
  return [...groupRows(rows, (row) => `${row.contentType}:${row.pattern}`).entries()]
    .map(([key, formatRows]) => {
      const [contentType, pattern] = key.split(':');
      return {
        format: contentType === 'unknown' ? pattern : `${contentType} - ${pattern}`,
        contentType,
        pattern,
        platforms: [...new Set(formatRows.map((row) => row.platform))],
        ...summarizeRowGroup(formatRows)
      };
    })
    .sort((left, right) => (
      right.averageScore - left.averageScore
      || right.samples - left.samples
    ))
    .slice(0, 6);
}

function lowPerformingWarningsFromRows(rows) {
  if (rows.length < 2) return [];
  const averageScore = rows.reduce((total, row) => total + row.score, 0) / rows.length;
  return rows
    .filter((row) => row.score <= Math.max(35, averageScore - 12))
    .sort((left, right) => left.score - right.score)
    .slice(0, 5)
    .map((row) => ({
      platform: row.platform,
      title: row.title,
      pattern: row.pattern,
      contentType: row.contentType,
      score: row.score,
      warning: `Low-performing ${row.pattern} on ${row.platform}. Refresh the hook, offer, or creative before reusing this angle.`
    }));
}

function improvedDraftSuggestionsFromRows({ bestPlatforms, winningHooks, winningTopics, winningFormats, warnings }) {
  const suggestions = [];
  const bestPlatform = bestPlatforms[0];
  const bestHook = winningHooks[0];
  const bestTopic = winningTopics[0];
  const bestFormat = winningFormats[0];

  if (bestPlatform) {
    suggestions.push({
      platform: bestPlatform.platform,
      direction: `Prioritize ${bestPlatform.platform} for the next campaign until another platform beats its average score.`,
      hookTemplate: bestHook ? `Open with a hook similar in structure to: "${bestHook.hook}"` : 'Open with a specific audience pain or outcome.',
      topic: bestTopic ? bestTopic.topic : '',
      format: bestFormat ? bestFormat.format : '',
      avoid: warnings[0] ? warnings[0].pattern : ''
    });
  }

  if (bestFormat) {
    suggestions.push({
      platform: bestPlatform ? bestPlatform.platform : '',
      direction: `Reuse the ${bestFormat.format} format with a new proof point or customer-relevant angle.`,
      hookTemplate: bestHook ? `Adapt the winning hook without copying it: "${bestHook.hook}"` : 'Lead with the clearest observed value proposition.',
      topic: bestTopic ? bestTopic.topic : '',
      format: bestFormat.format,
      avoid: warnings[0] ? `Avoid repeating ${warnings[0].pattern} without a stronger hook.` : ''
    });
  }

  return suggestions.slice(0, 4);
}

function buildGrowthBrainUpgradeFromSignals(signals, projectId) {
  if (!signals.length) return EMPTY_GROWTH_BRAIN_UPGRADE;
  const rows = signals.map((signal) => recommendationSignalRow(signal, projectId));
  const whatWorked = rows
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 6)
    .map((row) => ({
      platform: row.platform,
      title: row.title,
      pattern: row.pattern,
      contentType: row.contentType,
      score: row.score,
      reason: `${row.pattern} on ${row.platform} earned the strongest observed score in this window.`,
      metrics: row.metrics,
      engagementRate: row.engagementRate
    }));
  const bestPostingTimes = bestPostingTimesFromRows(rows);
  const bestPlatforms = bestPlatformsFromRows(rows);
  const winningHooks = winningHooksFromRows(rows);
  const winningTopics = winningTopicsFromRows(rows);
  const winningFormats = winningFormatsFromRows(rows);
  const lowPerformingWarnings = lowPerformingWarningsFromRows(rows);
  const improvedDraftSuggestions = improvedDraftSuggestionsFromRows({
    bestPlatforms,
    winningHooks,
    winningTopics,
    winningFormats,
    warnings: lowPerformingWarnings
  });

  return {
    whatWorked,
    bestPostingTimes,
    bestPlatforms,
    winningHooks,
    winningTopics,
    winningFormats,
    lowPerformingWarnings,
    improvedDraftSuggestions
  };
}

function aggregatePatternRows(rows) {
  const grouped = new Map();
  rows.forEach((row) => {
    const key = `${row.platform}:${row.pattern}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        platform: row.platform,
        pattern: row.pattern,
        samples: 0,
        totalScore: 0,
        bestScore: 0,
        engagementRates: [],
        exposureTotal: 0,
        exposureSamples: 0,
        engagementTotal: 0,
        engagementSamples: 0,
        exampleTitle: '',
        observedAt: row.observedAt
      });
    }
    const group = grouped.get(key);
    group.samples += 1;
    group.totalScore += row.score;
    group.bestScore = Math.max(group.bestScore, row.score);
    if (row.engagementRate !== null) group.engagementRates.push(row.engagementRate);
    if (row.exposure !== null) {
      group.exposureTotal += row.exposure;
      group.exposureSamples += 1;
    }
    if (row.engagements !== null) {
      group.engagementTotal += row.engagements;
      group.engagementSamples += 1;
    }
    if (!group.exampleTitle && row.title) group.exampleTitle = row.title;
    if (!group.observedAt || new Date(row.observedAt) > new Date(group.observedAt)) group.observedAt = row.observedAt;
  });

  return [...grouped.values()].map((group) => ({
    platform: group.platform,
    pattern: group.pattern,
    samples: group.samples,
    averageScore: Math.round(group.totalScore / Math.max(1, group.samples)),
    bestScore: group.bestScore,
    averageEngagementRate: group.engagementRates.length
      ? group.engagementRates.reduce((total, value) => total + value, 0) / group.engagementRates.length
      : null,
    averageExposure: group.exposureSamples ? Math.round(group.exposureTotal / group.exposureSamples) : null,
    averageEngagements: group.engagementSamples ? Math.round(group.engagementTotal / group.engagementSamples) : null,
    exampleTitle: group.exampleTitle,
    observedAt: group.observedAt
  }));
}

function evidenceQuality(sampleSize) {
  if (!sampleSize) {
    return {
      confidence: 'none',
      sampleSize,
      note: 'No engagement snapshots have been collected in this window.'
    };
  }
  if (sampleSize < 5) {
    return {
      confidence: 'early',
      sampleSize,
      note: 'Use these signals directionally until more posts are measured.'
    };
  }
  if (sampleSize < 15) {
    return {
      confidence: 'medium',
      sampleSize,
      note: 'Enough signals exist to guide the next campaign, but continue testing.'
    };
  }
  return {
    confidence: 'strong',
    sampleSize,
    note: 'Signals are broad enough to shape recurring content recommendations.'
  };
}

function actionForBestPattern(pattern) {
  return {
    priority: 'high',
    action: `Create two more ${pattern.pattern} posts for ${pattern.platform}.`,
    rationale: `This pattern has the strongest observed score in the current window: ${pattern.averageScore}.`,
    evidence: {
      platform: pattern.platform,
      pattern: pattern.pattern,
      samples: pattern.samples,
      averageScore: pattern.averageScore
    }
  };
}

function actionForWeakPattern(pattern) {
  return {
    priority: 'medium',
    action: `Rewrite or pause ${pattern.pattern} posts on ${pattern.platform}.`,
    rationale: `This pattern is underperforming with an average score of ${pattern.averageScore}. Test a sharper hook, clearer offer, or stronger creative before scaling it.`,
    evidence: {
      platform: pattern.platform,
      pattern: pattern.pattern,
      samples: pattern.samples,
      averageScore: pattern.averageScore
    }
  };
}

function buildRecommendationInputsFromSignals(signals, projectId) {
  if (!signals.length) return EMPTY_RECOMMENDATION_INPUTS;
  const rows = signals.map((signal) => recommendationSignalRow(signal, projectId));
  const groups = aggregatePatternRows(rows);
  const averageScore = rows.reduce((total, row) => total + row.score, 0) / Math.max(1, rows.length);
  const bestContentPatterns = [...groups]
    .sort((left, right) => (
      right.averageScore - left.averageScore
      || right.samples - left.samples
      || right.bestScore - left.bestScore
    ))
    .slice(0, 4);
  const bestKeys = new Set(bestContentPatterns.slice(0, 1).map((item) => `${item.platform}:${item.pattern}`));
  const weakContentPatterns = groups
    .filter((group) => !bestKeys.has(`${group.platform}:${group.pattern}`))
    .filter((group) => group.averageScore <= Math.max(45, averageScore - 5))
    .sort((left, right) => (
      left.averageScore - right.averageScore
      || right.samples - left.samples
    ))
    .slice(0, 4);
  const suggestedNextActions = [
    ...bestContentPatterns.slice(0, 2).map(actionForBestPattern),
    ...weakContentPatterns.slice(0, 2).map(actionForWeakPattern)
  ];

  if (signals.length < 5) {
    suggestedNextActions.push({
      priority: 'medium',
      action: 'Collect at least five measured social posts before automating strong channel decisions.',
      rationale: 'The current sample is useful for direction, but still too small for confident pattern selection.',
      evidence: {
        samples: signals.length
      }
    });
  }

  return {
    evidenceQuality: evidenceQuality(signals.length),
    bestContentPatterns,
    weakContentPatterns,
    suggestedNextActions: suggestedNextActions.slice(0, 5)
  };
}

async function buildGrowthBrainSocialContext(projectId, { days = 90, limit = 20 } = {}) {
  const normalizedDays = normalizeAnalyticsDays(days);
  const since = new Date(Date.now() - normalizedDays * 24 * 60 * 60 * 1000);
  const signals = await GrowthSignal.find({ projectId, observedAt: { $gte: since } })
    .sort({ score: -1, observedAt: -1 })
    .limit(Math.min(50, Math.max(1, limit)))
    .populate('draftId', 'title body channel')
    .lean();

  const platformMap = new Map();
  signals.forEach((signal) => {
    if (!platformMap.has(signal.platform)) {
      platformMap.set(signal.platform, { platform: signal.platform, samples: 0, totalScore: 0, bestScore: 0 });
    }
    const row = platformMap.get(signal.platform);
    row.samples += 1;
    row.totalScore += Number(signal.score || 0);
    row.bestScore = Math.max(row.bestScore, Number(signal.score || 0));
  });
  const platforms = [...platformMap.values()]
    .map((row) => ({ ...row, averageScore: Math.round(row.totalScore / Math.max(1, row.samples)) }))
    .sort((left, right) => right.averageScore - left.averageScore);

  return {
    source: 'Moyi Content Distribution Engine engagement snapshots',
    asOf: signals.length ? signals[0].observedAt : null,
    windowDays: normalizedDays,
    sampleSize: signals.length,
    measurementNote: 'Metrics vary by provider and app permissions. Treat only supplied fields as observed evidence.',
    platforms,
    recommendationInputs: buildRecommendationInputsFromSignals(signals, projectId),
    growthBrainUpgrade: buildGrowthBrainUpgradeFromSignals(signals, projectId),
    strongestObservedPosts: signals.slice(0, 8).map((signal) => ({
      platform: signal.platform,
      score: signal.score,
      observedAt: signal.observedAt,
      ...visibleSignalContent(signal, projectId),
      metrics: signalMetrics(signal),
      engagementRate: signalEngagementRate(signal)
    }))
  };
}

function socialPerformanceApiPayload(dashboard) {
  return {
    window: {
      days: dashboard.days,
      since: dashboard.since,
      generatedAt: dashboard.generatedAt,
      lastMetricsSyncAt: dashboard.lastMetricsSyncAt
    },
    totals: dashboard.totals,
    reliability: dashboard.reliability,
    platforms: dashboard.platformRows,
    campaigns: dashboard.campaignRows || [],
    contentTypes: dashboard.contentTypeRows || [],
    growthBrain: dashboard.growthBrain || {
      source: 'Moyi Content Distribution Engine engagement snapshots',
      asOf: null,
      windowDays: dashboard.days,
      sampleSize: 0,
      measurementNote: 'Metrics vary by provider and app permissions. Treat only supplied fields as observed evidence.',
      platforms: [],
      recommendationInputs: EMPTY_RECOMMENDATION_INPUTS,
      growthBrainUpgrade: EMPTY_GROWTH_BRAIN_UPGRADE,
      strongestObservedPosts: []
    },
    posts: dashboard.recentPosts.map((post) => ({
      id: post.id,
      platform: post.platform,
      accountName: post.accountName,
      publishedAt: post.publishedAt,
      platformUrl: post.platformUrl,
      metricsStatus: post.metricsStatus,
      metricsCapturedAt: post.metricsCapturedAt,
      availableFields: post.availableFields,
      campaignId: post.campaignId,
      campaignName: post.campaignName,
      contentType: post.contentType,
      metrics: post.metrics,
      engagementRate: post.engagementRate
    }))
  };
}

module.exports = {
  buildGrowthBrainUpgradeFromSignals,
  buildRecommendationInputsFromSignals,
  buildGrowthBrainSocialContext,
  buildSocialPerformanceDashboard,
  classifyContentType,
  destinationProjectFilter,
  normalizeAnalyticsDays,
  postPerformanceRow,
  socialPerformanceApiPayload,
  summarizeCampaigns,
  summarizeContentTypes,
  summarizePlatforms
};
