const asyncHandler = require('express-async-handler');
const { body, param, query } = require('express-validator');
const { buildPublishReadiness } = require('../../services/socialPublisherService');
const { publishableProjectIds } = require('../../services/projectAccessService');
const { socialAccountAccessFilter } = require('../../services/socialAccountService');
const {
  calendarCounts,
  calendarPresentation,
  latestJobsByDraft,
  normalizeCalendarFilters
} = require('../../services/contentCalendarService');
const {
  addDays,
  formatCalendarDate,
  localDateKey,
  localTimeValue,
  navigationDates,
  parseDateKey,
  resolveCalendarRange,
  resolveExplicitRange,
  safeTimezone,
  startOfWeek
} = require('../../services/calendarDateService');

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function registerExecutionRoutes(router, context, services = {}) {
  const {
    createCampaignContentPlan,
    ensureAiOperationAllowed,
    findJobForProject,
    recordAiOperation,
    recordAiOperationFailure
  } = services;
  router.get('/:id/content', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const [drafts, socialDrafts, campaigns, job] = await Promise.all([
      context.ContentDraft.find({ projectId: req.project._id }).sort({ updatedAt: -1 }),
      context.SocialDraft.find({ projectId: req.project._id }).sort({ scheduledFor: -1 }).limit(12).populate('campaignId'),
      context.Campaign.find({ projectId: req.project._id }).sort({ updatedAt: -1 }).limit(8),
      req.query.job && findJobForProject
        ? findJobForProject({ jobId: req.query.job, projectId: req.project._id, userId: req.user._id })
        : null
    ]);
    const recommendationId = String(req.query.recommendation || '');
    const pipelineDrafts = recommendationId
      ? drafts.filter((draft) => String(draft.recommendationId) === recommendationId)
      : [];
    res.render('projects/content', {
      title: `${req.project.name} content`,
      drafts,
      socialDrafts,
      campaigns,
      job,
      pipelineDrafts,
      successMessage: req.query.success || '',
      errorMessage: req.query.error || '',
      today: new Date().toISOString().slice(0, 10)
    });
  }));

  router.post('/:id/growth-pack', [
    param('id').isMongoId(),
    body('targetUrl').optional().trim(),
    body('keyword').optional().trim(),
    context.handleValidation
  ], context.loadProject, asyncHandler(async (req, res) => {
    if (ensureAiOperationAllowed) await ensureAiOperationAllowed(req.user);
    const { generateInstantGrowthPack } = require('../../services/contentDraftService');
    try {
      const result = await generateInstantGrowthPack({
        projectId: req.project._id,
        targetUrl: req.body.targetUrl || req.project.websiteUrl,
        keyword: req.body.keyword || req.project.mainOffer
      });
      if (recordAiOperation) await recordAiOperation(req.user._id, result.bundleCount || 5);
      return res.redirect(`/projects/${req.project._id}/content?success=${encodeURIComponent(`Instant 30-Day Growth Pack generated! ${result.bundleCount} omnichannel assets ready for review below.`)}`);
    } catch (error) {
      if (recordAiOperationFailure) await recordAiOperationFailure(req.user._id).catch(() => null);
      return res.redirect(`/projects/${req.project._id}/content?error=${encodeURIComponent(error.message)}`);
    }
  }));

  router.post('/:id/content-plan', [
    param('id').isMongoId(),
    body('cadence').isIn(['single', 'weekly', 'monthly']).withMessage('Choose a valid plan length.'),
    body('name').trim().notEmpty().withMessage('Campaign name is required.').isLength({ max: 160 }),
    body('goal').trim().notEmpty().withMessage('Describe what this campaign should achieve.').isLength({ max: 500 }),
    body('channel').isIn(['bluesky', 'linkedin', 'facebook', 'x', 'instagram', 'threads', 'tiktok', 'youtube', 'email', 'multi']).withMessage('Choose a valid channel.'),
    body('startDate').isISO8601().withMessage('Choose a valid start date.'),
    context.handleValidation
  ], context.loadProject, asyncHandler(async (req, res) => {
    await ensureAiOperationAllowed(req.user);
    const cadenceDays = { single: 0, weekly: 6, monthly: 29 };
    const startDate = new Date(`${req.body.startDate}T09:00:00`);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + cadenceDays[req.body.cadence]);

    const campaign = await context.Campaign.create({
      projectId: req.project._id,
      name: req.body.name,
      goal: req.body.goal,
      channel: req.body.channel,
      cadence: req.body.cadence,
      startDate,
      endDate,
      status: 'planned'
    });

    try {
      const drafts = await createCampaignContentPlan({
        project: req.project,
        campaign,
        cadence: req.body.cadence
      });
      await recordAiOperation(req.user._id, 1);
      return res.redirect(`/projects/${req.project._id}/calendar?success=${encodeURIComponent(`${drafts.length} campaign drafts created and scheduled.`)}`);
    } catch (error) {
      await context.Campaign.deleteOne({ _id: campaign._id, projectId: req.project._id });
      await recordAiOperationFailure(req.user._id).catch(() => null);
      return res.redirect(`/projects/${req.project._id}/content?error=${encodeURIComponent(error.message)}`);
    }
  }));

  router.post('/:id/content-intelligence', [
    param('id').isMongoId(),
    context.handleValidation
  ], context.loadProject, asyncHandler(async (req, res) => {
    if (ensureAiOperationAllowed) await ensureAiOperationAllowed(req.user);
    const { executeDailyContentIntelligenceRun } = require('../../services/dailyContentIntelligenceService');
    try {
      const result = await executeDailyContentIntelligenceRun({
        projectId: req.project._id,
        autoSaveDraft: true
      });
      if (recordAiOperation) await recordAiOperation(req.user._id, 1).catch(() => null);
      if (result.status === 'NO_PUBLICATION') {
        return res.redirect(`/projects/${req.project._id}/content?success=${encodeURIComponent('Daily Intelligence Review: No publication required today (Quality threshold protected).')}`);
      }
      return res.redirect(`/projects/${req.project._id}/content?success=${encodeURIComponent('Daily Content Intelligence complete! Strategic draft created and awaiting review.')}`);
    } catch (error) {
      return res.redirect(`/projects/${req.project._id}/content?error=${encodeURIComponent(error.message)}`);
    }
  }));

  async function loadCalendarRange(req, res, filters, range) {
    const timezone = safeTimezone(req.project.timezone || 'UTC');
    const destinationProjectIds = res.locals.canPublishProject
      ? await publishableProjectIds(req.user._id, { sourceProject: req.project })
      : [req.project._id];
    const [campaigns, socialAccounts, destinationProjects] = await Promise.all([
      context.Campaign.find({ projectId: req.project._id }).sort({ startDate: 1 }),
      context.SocialAccount.find({
        projectId: { $in: destinationProjectIds },
        ...socialAccountAccessFilter(req.user._id)
      }).select('-accessToken -refreshToken -webhookSecret').sort({ platform: 1, updatedAt: -1 }),
      context.Project.find({ _id: { $in: destinationProjectIds } }).select('name').lean()
    ]);
    const accountProjectNames = Object.fromEntries(destinationProjects.map((item) => [String(item._id), item.name]));
    const draftFilter = { projectId: req.project._id };
    if (['list', 'attention'].includes(range.view)) {
      draftFilter.$or = [
        { scheduledFor: { $gte: range.from, $lt: range.to } },
        { scheduledFor: null },
        { scheduledFor: { $exists: false } }
      ];
    } else {
      draftFilter.scheduledFor = { $gte: range.from, $lt: range.to };
    }
    if (filters.platform) draftFilter.channel = filters.platform;
    if (filters.campaign && /^[a-f\d]{24}$/i.test(filters.campaign)) draftFilter.campaignId = filters.campaign;
    if (filters.contentType) draftFilter['metadata.contentType'] = filters.contentType;

    const drafts = await context.SocialDraft.find(draftFilter)
      .select('_id projectId campaignId socialAccountId sourceContentDraftId contentImageId channel title body status publishStatus publishedAt errorMessage metadata scheduledFor')
      .sort({ scheduledFor: 1 })
      .limit(2000)
      .populate('campaignId', 'name channel');
    const draftIds = drafts.map((draft) => draft._id);
    const [publishJobs, socialImages, mediaAssets] = draftIds.length
      ? await Promise.all([
        context.PublishJob.find({ projectId: req.project._id, draftId: { $in: draftIds } })
          .select('draftId batchId accountId destinationProjectId platform status errorMessage errorCode failureKind deadLetterReason reconnectRequired providerDispatchStartedAt scheduledAt publishedAt createdAt')
          .sort({ createdAt: -1 })
          .limit(Math.max(40, draftIds.length * 8)),
        context.ContentImage.find({ projectId: req.project._id, draftId: { $in: draftIds }, status: 'selected' })
          .select('_id draftId status source'),
        context.MediaAsset.find({ projectId: req.project._id, draftId: { $in: draftIds } })
          .select('_id draftId kind status')
      ])
      : [[], [], []];
    const jobsByDraftId = latestJobsByDraft(publishJobs);
    const imagesByDraftId = socialImages.reduce((grouped, image) => {
      const key = String(image.draftId);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(image);
      return grouped;
    }, {});
    const mediaByDraftId = mediaAssets.reduce((grouped, asset) => {
      const key = String(asset.draftId);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(asset);
      return grouped;
    }, {});
    const publishReadiness = buildPublishReadiness({
      socialDrafts: drafts,
      connectedAccounts: socialAccounts,
      imagesByDraftId,
      mediaAssetsByDraftId: mediaByDraftId,
      jobsByDraftId,
      projectId: req.project._id
    });
    const readinessByDraftId = Object.fromEntries(publishReadiness.posts.map((item) => [String(item.draftId), item]));
    const accountNameById = new Map(socialAccounts.map((account) => [String(account._id), account.accountName]));
    const items = drafts.map((draft) => {
      const draftId = String(draft._id);
      const latestAccountId = jobsByDraftId[draftId]?.[0]?.accountId;
      const accountId = String(draft.socialAccountId || latestAccountId || '');
      const presentation = calendarPresentation(draft, {
        jobs: jobsByDraftId[draftId] || [],
        readiness: readinessByDraftId[draftId] || null
      });
      const hasSchedule = draft.scheduledFor && Number.isFinite(new Date(draft.scheduledFor).getTime());
      return {
        draft,
        ...presentation,
        readiness: readinessByDraftId[draftId] || null,
        accountId,
        accountName: accountNameById.get(accountId) || '',
        thumbnailUrl: draft.contentImageId
          ? (draft.sourceContentDraftId
            ? `/content/${draft.sourceContentDraftId}/images/${draft.contentImageId}/file`
            : `/social-drafts/${draft._id}/images/${draft.contentImageId}/file`)
          : '',
        localDate: hasSchedule ? localDateKey(draft.scheduledFor, timezone) : '',
        localTime: hasSchedule ? localTimeValue(draft.scheduledFor, timezone) : '',
        displayDate: hasSchedule ? formatCalendarDate(draft.scheduledFor, timezone, { month: 'short', day: 'numeric' }) : 'Unscheduled',
        displayTime: hasSchedule ? formatCalendarDate(draft.scheduledFor, timezone, { hour: 'numeric', minute: '2-digit' }) : 'Choose date',
        canReschedule: Boolean(res.locals.canManageProject) && presentation.canSelect
      };
    });
    const searchExpression = filters.search ? new RegExp(escapeRegex(filters.search), 'i') : null;
    const filteredItems = items
      .filter((item) => filters.view !== 'attention' || item.hasAttention)
      .filter((item) => !filters.account || item.accountId === filters.account)
      .filter((item) => !filters.status || item.uiStatus === filters.status)
      .filter((item) => !searchExpression || [
        item.draft.title,
        item.draft.body,
        item.draft.channel,
        item.draft.campaignId?.name,
        item.accountName,
        item.statusLabel,
        item.draft.metadata?.contentType
      ].some((value) => searchExpression.test(String(value || ''))));
    const contentTypes = [...new Set(drafts.map((draft) => String(draft.metadata?.contentType || '')).filter(Boolean))].sort();
    return {
      timezone,
      campaigns,
      socialAccounts,
      accountProjectNames,
      items: filteredItems,
      unfilteredItems: items,
      truncated: drafts.length === 2000,
      counts: calendarCounts(items),
      publishReadiness,
      filterOptions: {
        platforms: [...new Set(drafts.map((draft) => draft.channel).filter(Boolean))].sort(),
        campaigns,
        accounts: socialAccounts,
        contentTypes
      }
    };
  }

  router.get('/:id/social-calendar', [
    param('id').isMongoId(),
    query('from').optional().matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Use a valid from date.'),
    query('to').optional().matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Use a valid to date.'),
    context.handleValidation
  ], context.loadProject, asyncHandler(async (req, res) => {
    const filters = normalizeCalendarFilters(req.query);
    let range;
    try {
      range = req.query.from || req.query.to
        ? resolveExplicitRange({ from: req.query.from, to: req.query.to, timezone: req.project.timezone })
        : resolveCalendarRange({ view: filters.view, date: filters.date, timezone: req.project.timezone });
    } catch (error) {
      return res.status(400).json({ ok: false, message: error.message });
    }
    const data = await loadCalendarRange(req, res, filters, range);
    return res.json({
      ok: true,
      projectId: String(req.project._id),
      timezone: data.timezone,
      range: { from: range.fromKey, to: addDays(range.toKeyExclusive, -1), days: range.days },
      counts: data.counts,
      truncated: data.truncated,
      items: data.items.map((item) => ({
        id: String(item.draft._id),
        title: item.draft.title || 'Untitled post',
        captionPreview: String(item.draft.body || '').slice(0, 180),
        platform: item.draft.channel,
        campaign: item.draft.campaignId?.name || '',
        account: item.accountName,
        scheduledAt: item.draft.scheduledFor ? item.draft.scheduledFor.toISOString() : null,
        localDate: item.localDate,
        localTime: item.localTime,
        status: item.uiStatus,
        statusLabel: item.statusLabel,
        blocker: item.blocker,
        thumbnailUrl: item.thumbnailUrl,
        canReschedule: item.canReschedule
      }))
    });
  }));

  router.get('/:id/calendar', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const filters = normalizeCalendarFilters(req.query);
    const timezone = safeTimezone(req.project.timezone || 'UTC');
    const range = resolveCalendarRange({ view: filters.view, date: filters.date, timezone });
    const imageJobQuery = req.query.imageJob && /^[a-f\d]{24}$/i.test(String(req.query.imageJob))
      ? {
          _id: req.query.imageJob,
          projectId: req.project._id,
          userId: req.user._id,
          type: 'content_image_generation',
          status: { $in: ['queued', 'running'] }
        }
      : null;
    const [data, imageJob] = await Promise.all([
      loadCalendarRange(req, res, filters, range),
      imageJobQuery ? context.ProjectJob.findOne(imageJobQuery) : null
    ]);
    const pageSize = 50;
    const isPagedView = ['list', 'attention'].includes(filters.view);
    const totalPages = isPagedView ? Math.max(1, Math.ceil(data.items.length / pageSize)) : 1;
    const currentPage = Math.min(filters.page, totalPages);
    const calendarItems = isPagedView
      ? data.items.slice((currentPage - 1) * pageSize, currentPage * pageSize)
      : data.items;
    const groupedItems = calendarItems.reduce((grouped, item) => {
      if (!grouped[item.localDate]) grouped[item.localDate] = [];
      grouped[item.localDate].push(item);
      return grouped;
    }, {});
    const days = [];
    for (let dateKey = range.fromKey; dateKey < range.toKeyExclusive; dateKey = addDays(dateKey, 1)) {
      const localMidday = new Date(`${dateKey}T12:00:00.000Z`);
      days.push({
        dateKey,
        dayNumber: Number(dateKey.slice(-2)),
        weekday: formatCalendarDate(localMidday, 'UTC', { weekday: 'short' }),
        fullLabel: formatCalendarDate(localMidday, 'UTC', { weekday: 'long', month: 'long', day: 'numeric' }),
        inActiveMonth: dateKey.slice(0, 7) === range.anchorDate.slice(0, 7),
        isToday: dateKey === localDateKey(new Date(), timezone),
        items: groupedItems[dateKey] || []
      });
    }
    const nav = navigationDates(range);
    const anchorMidday = new Date(`${range.anchorDate}T12:00:00.000Z`);
    const rangeTitle = filters.view === 'month'
      ? formatCalendarDate(anchorMidday, 'UTC', { month: 'long', year: 'numeric' })
      : filters.view === 'week'
        ? `${days[0]?.fullLabel || range.fromKey} – ${days.at(-1)?.fullLabel || addDays(range.toKeyExclusive, -1)}`
        : filters.view === 'today'
          ? days[0]?.fullLabel || range.anchorDate
          : filters.view === 'attention'
            ? 'Publishing attention'
          : `${formatCalendarDate(new Date(`${range.fromKey}T12:00:00.000Z`), 'UTC', { month: 'short', day: 'numeric' })} – ${formatCalendarDate(new Date(`${addDays(range.toKeyExclusive, -1)}T12:00:00.000Z`), 'UTC', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    let todayContext = null;
    if (filters.view === 'today' && typeof context.SocialDraft.countDocuments === 'function') {
      const tomorrowKey = addDays(range.anchorDate, 1);
      const weekStart = startOfWeek(range.anchorDate);
      const [tomorrow, thisWeek] = await Promise.all([
        context.SocialDraft.countDocuments({
          projectId: req.project._id,
          scheduledFor: { $gte: resolveExplicitRange({ from: tomorrowKey, to: tomorrowKey, timezone }).from, $lt: resolveExplicitRange({ from: tomorrowKey, to: tomorrowKey, timezone }).to }
        }),
        context.SocialDraft.countDocuments({
          projectId: req.project._id,
          scheduledFor: {
            $gte: resolveExplicitRange({ from: weekStart, to: addDays(weekStart, 6), timezone }).from,
            $lt: resolveExplicitRange({ from: weekStart, to: addDays(weekStart, 6), timezone }).to
          }
        })
      ]);
      todayContext = { tomorrow, thisWeek };
    }
    const viewData = {
      campaigns: data.campaigns,
      socialAccounts: data.socialAccounts,
      accountProjectNames: data.accountProjectNames,
      calendarItems,
      calendarCounts: data.counts,
      filters: { ...filters, page: currentPage, date: range.anchorDate },
      filterOptions: data.filterOptions,
      pagination: { page: currentPage, pageSize, totalItems: data.items.length, totalPages },
      publishReadiness: data.publishReadiness,
      calendarRange: range,
      calendarDays: days,
      calendarItemsByDay: groupedItems,
      calendarNavigation: nav,
      calendarRangeTitle: rangeTitle,
      calendarTimezone: timezone,
      todayContext,
      calendarTruncated: data.truncated,
      userCanManageProject: Boolean(res.locals.canManageProject),
      userCanPublishProject: Boolean(res.locals.canPublishProject)
    };
    if (req.query.fragment === '1') return res.render('projects/partials/calendar-results', viewData);
    return res.render('projects/calendar', {
      title: `${req.project.name} calendar`,
      ...viewData,
      successMessage: req.query.success || '',
      errorMessage: req.query.error || '',
      limitType: req.query.limit || '',
      imageJob
    });
  }));

  router.get('/:id/campaigns', [param('id').isMongoId(), context.handleValidation], context.loadProject, asyncHandler(async (req, res) => {
    const [campaigns, socialDrafts] = await Promise.all([
      context.Campaign.find({ projectId: req.project._id }).sort({ createdAt: -1 }),
      context.SocialDraft.find({ projectId: req.project._id }).sort({ scheduledFor: 1 })
    ]);

    res.render('projects/campaigns', {
      title: `${req.project.name} campaigns`,
      campaigns,
      socialDrafts,
      successMessage: req.query.success || ''
    });
  }));

  router.post('/:id/campaigns', [param('id').isMongoId(), ...context.campaignValidation], context.loadProject, asyncHandler(async (req, res) => {
    const startDate = new Date(req.body.startDate);
    const endDate = new Date(req.body.endDate);
    if (endDate < startDate) {
      endDate.setTime(startDate.getTime());
    }

    await context.Campaign.create({
      projectId: req.project._id,
      name: req.body.name,
      goal: req.body.goal || '',
      channel: req.body.channel,
      startDate,
      endDate,
      status: req.body.status || 'planned',
      dailySpendLimit: Number(req.body.dailySpendLimit || 0),
      monthlySpendLimit: Number(req.body.monthlySpendLimit || 0)
    });

    res.redirect(`/projects/${req.project._id}/campaigns?success=${encodeURIComponent('Campaign created.')}`);
  }));
}

module.exports = {
  registerExecutionRoutes
};
