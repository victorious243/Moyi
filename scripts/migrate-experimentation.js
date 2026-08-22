require('dotenv').config();
const mongoose = require('mongoose');
const env = require('../config/env');
const Experiment = require('../models/Experiment');
const ExperimentObservation = require('../models/ExperimentObservation');
const ExperimentLearning = require('../models/ExperimentLearning');
const TrackingEvent = require('../models/TrackingEvent');

async function run() {
  await mongoose.connect(env.mongoUri);
  await Promise.all([
    Experiment.syncIndexes(),
    ExperimentObservation.syncIndexes(),
    ExperimentLearning.syncIndexes(),
    TrackingEvent.syncIndexes()
  ]);
  console.log('Phase 6 experimentation indexes are ready.');
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => null);
  process.exitCode = 1;
});
