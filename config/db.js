const mongoose = require('mongoose');
const env = require('./env');

async function connectDatabase() {
  mongoose.set('strictQuery', true);

  try {
    await mongoose.connect(env.mongoUri, {
      dbName: env.mongoDbName || undefined,
      serverSelectionTimeoutMS: 10000
    });
    const role = process.env.MOYI_PROCESS_ROLE ? ` (${process.env.MOYI_PROCESS_ROLE})` : '';
    console.log(`MongoDB connected${role}: ${mongoose.connection.name}`);
  } catch (error) {
    if (error.codeName === 'AtlasError' || /auth/i.test(error.message)) {
      console.error('MongoDB authentication failed. Check MONGODB_URI username, password, database name, and Atlas database user permissions.');
      console.error('If the password contains special characters such as @, :, /, ?, #, &, or %, URL-encode the password in MONGODB_URI.');
    }

    throw error;
  }
}

module.exports = connectDatabase;
