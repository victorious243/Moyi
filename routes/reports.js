const express = require('express');
const asyncHandler = require('express-async-handler');
const { requireAuth } = require('../middleware/auth');
const Report = require('../models/Report');
const Project = require('../models/Project');
const SeoIssue = require('../models/SeoIssue');
const Scan = require('../models/Scan');
const AppError = require('../utils/appError');

const router = express.Router();

router.use(requireAuth);

router.get('/:id', asyncHandler(async (req, res, next) => {
  const report = await Report.findById(req.params.id);
  if (!report) return next(new AppError('Report not found.', 404));

  const project = await Project.findOne({ _id: report.project, owner: req.user._id });
  if (!project) return next(new AppError('Report not found.', 404));

  const [scan, issues] = await Promise.all([
    Scan.findById(report.scan),
    SeoIssue.find({ scan: report.scan }).sort({ severity: 1 }).limit(50)
  ]);

  res.render('reports/show', { title: `${project.name} report`, report, project, scan, issues });
}));

module.exports = router;
