const path = require('path');
const { openDb } = require('./db');
const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');

const db = openDb(DB_PATH);
const app = createApp(db);
const server = app.listen(PORT, () => console.log(`Ajaia Docs running on http://localhost:${PORT} (db: ${DB_PATH})`));

function shutdown(signal) {
  console.log(`\n${signal} received, shutting down…`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
