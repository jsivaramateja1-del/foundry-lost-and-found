const mongoose = require('mongoose');

/**
 * Connect to MongoDB.
 * Pass a uri explicitly when testing with mongodb-memory-server.
 *
 * The log line prints the host AND the database name. That matters: two
 * different clusters, or the same cluster with two different database names,
 * look identical if you only print the host.
 */
const connectDB = async (uri = process.env.MONGO_URI) => {
  if (!uri) {
    throw new Error('MONGO_URI is not set. Copy .env.example to .env and fill it in.');
  }
  mongoose.set('strictQuery', true);
  const conn = await mongoose.connect(uri);
  console.log(`MongoDB Connected: host=${conn.connection.host} database=${conn.connection.name}`);
  return conn;
};

module.exports = connectDB;
