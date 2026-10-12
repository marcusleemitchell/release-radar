/**
 * paths.js — where writable runtime data (cache, logs) lives.
 *
 * When run via `npm start` this is the project directory (unchanged
 * behaviour). The Electron shell sets RELEASE_RADAR_DATA_DIR to a
 * per-user directory because the packaged app bundle is read-only.
 */

const path = require("path");

const DATA_DIR = process.env.RELEASE_RADAR_DATA_DIR || __dirname;

module.exports = {
  DATA_DIR,
  CACHE_DIR: path.join(DATA_DIR, "cache"),
  LOG_DIR: path.join(DATA_DIR, "logs"),
};
