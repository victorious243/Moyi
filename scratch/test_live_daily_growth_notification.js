const mongoose = require('mongoose');
const env = require('../config/env');
const Project = require('../models/Project');
const User = require('../models/User');
const GrowthAlert = require('../models/GrowthAlert');
const DailyGrowthIntelligence = require('../models/DailyGrowthIntelligence');
const { generateDailyGrowthIntelligenceReport } = require('../services/dailyGrowthIntelligenceService');
const { sendDailyGrowthBriefingEmail } = require('../services/dailyGrowthScheduler');

async function runLiveNotificationAudit() {
  console.log('--- LIVE DAILY GROWTH NOTIFICATION & IN-APP ALERT AUDIT ---');
  const moyiUri = env.mongoUri.includes('?') ? env.mongoUri.replace('?', 'moyi?') : env.mongoUri + '/moyi';
  await mongoose.connect(moyiUri);
  console.log('Connected to MongoDB database:', mongoose.connection.name);

  const users = await User.find();
  console.log(`Found ${users.length} users in database:`);
  users.forEach((u) => console.log(` - ${u.email} (Role: ${u.role}, ID: ${u._id})`));

  const adminUser = users.find((u) => u.role === 'admin' || u.role === 'owner') || users[0];
  if (!adminUser) {
    console.log('No user in database.');
  } else {
    console.log(`Active Admin/Owner: ${adminUser.email} (ID: ${adminUser._id})`);
  }

  const projects = await Project.find({ status: { $ne: 'archived' } }).populate('owner');
  console.log(`Found ${projects.length} active projects.`);

  for (const project of projects) {
    console.log(`\nEvaluating Project: ${project.name} (${project._id})`);
    const ownerEmail = (project.owner && project.owner.email) || adminUser.email;
    console.log(`- Project Owner / Recipient: ${ownerEmail}`);

    // Generate or fetch today's report
    const report = await generateDailyGrowthIntelligenceReport(project._id, new Date());
    console.log(`- Report Mode: ${report.reportMode}, Score: ${report.performanceScore?.overallScore}/100`);

    // Dispatch live briefing notification
    console.log(`- Dispatching live in-app GrowthAlert & morning brief email...`);
    const result = await sendDailyGrowthBriefingEmail({
      project,
      report,
      force: true
    });
    console.log(`- Dispatch result:`, result);

    // Verify in-app GrowthAlert created in DB
    const latestAlert = await GrowthAlert.findOne({
      projectId: project._id,
      type: 'daily_growth_intelligence'
    }).sort({ createdAt: -1 });

    if (latestAlert) {
      console.log(`- ✅ Verified in-app GrowthAlert created: "${latestAlert.title}" (ID: ${latestAlert._id})`);
      console.log(`  Summary: ${latestAlert.summary.slice(0, 100)}...`);
      console.log(`  Severity: ${latestAlert.severity}, CTA: ${latestAlert.ctaUrl}`);
    } else {
      console.error(`- ❌ No GrowthAlert found for project ${project.name}`);
    }
  }

  // Check unread count for admin user
  const adminProjectIds = projects.map((p) => p._id);
  const unreadAlerts = await GrowthAlert.find({
    $or: [{ userId: adminUser._id }, { projectId: { $in: adminProjectIds } }],
    readAt: null
  });
  console.log(`\n======================================================`);
  console.log(`🔔 Total unread notifications for admin (${adminUser.email}): ${unreadAlerts.length}`);
  console.log(`🔴 Topbar Red Badge will display: ${unreadAlerts.length > 99 ? '99+' : unreadAlerts.length}`);
  console.log(`======================================================`);

  await mongoose.disconnect();
  console.log('Database disconnected.');
}

runLiveNotificationAudit().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
