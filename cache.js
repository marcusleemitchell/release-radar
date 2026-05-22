/**
 * cache.js — TTL cache persisted to cache/cache.json.
 *
 * Each entry: { data, cachedAt (ms timestamp) }
 * Default TTL: 24 hours.
 *
 * The store is loaded from disk on first require() and written
 * back to disk on every set/bust, so it survives server restarts.
 */

const fs = require("fs");
const path = require("path");
const logger = require("./logger");

const TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_DIR = path.join(__dirname, "cache");
const CACHE_FILE = path.join(CACHE_DIR, "cache.json");

// ── Ensure cache directory exists ───────────────────────────────────────────

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// ── Load persisted store from disk ──────────────────────────────────────────

const store = new Map();

if (fs.existsSync(CACHE_FILE)) {
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf8");
    const obj = JSON.parse(raw);
    let loaded = 0;
    let expired = 0;
    for (const [key, entry] of Object.entries(obj)) {
      if (Date.now() - entry.cachedAt <= TTL_MS) {
        store.set(key, entry);
        loaded++;
      } else {
        expired++;
      }
    }
    logger.info("cache.load", `Loaded cache from disk`, {
      file: CACHE_FILE,
      loaded,
      expired_skipped: expired,
    });
  } catch (err) {
    logger.warn(
      "cache.load_failed",
      `Could not read cache file — starting fresh`,
      {
        file: CACHE_FILE,
        error: err.message,
      },
    );
  }
} else {
  logger.debug(
    "cache.load",
    "No cache file found — starting with empty cache",
    {
      file: CACHE_FILE,
    },
  );
}

// ── Persist helper ───────────────────────────────────────────────────────────

function persist() {
  try {
    const obj = Object.fromEntries(store.entries());
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2), "utf8");
    logger.debug("cache.persist", `Cache written to disk`, {
      file: CACHE_FILE,
      keys: store.size,
    });
  } catch (err) {
    logger.warn("cache.persist_failed", `Could not write cache file`, {
      file: CACHE_FILE,
      error: err.message,
    });
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

const cache = {
  /**
   * Return cached entry if present and not expired, otherwise null.
   * @param {string} key
   * @returns {{ data: any, cachedAt: number } | null}
   */
  get(key) {
    const entry = store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > TTL_MS) {
      store.delete(key);
      persist();
      logger.debug("cache.expired", `Cache expired for key "${key}"`, { key });
      return null;
    }
    logger.debug("cache.hit", `Cache hit for key "${key}"`, {
      key,
      age_mins: Math.round((Date.now() - entry.cachedAt) / 60000),
    });
    return entry;
  },

  /**
   * Store data under key and persist to disk.
   * @param {string} key
   * @param {any} data
   */
  set(key, data) {
    const cachedAt = Date.now();
    store.set(key, { data, cachedAt });
    persist();
    logger.debug("cache.set", `Cached key "${key}"`, { key });
  },

  /**
   * Delete a specific key and persist to disk.
   * @param {string} key
   */
  bust(key) {
    const existed = store.has(key);
    store.delete(key);
    if (existed) {
      persist();
      logger.info("cache.bust", `Cache busted for key "${key}"`, { key });
    }
  },

  /**
   * Delete all keys matching a prefix and persist to disk.
   * @param {string} prefix
   */
  bustPrefix(prefix) {
    let count = 0;
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) {
        store.delete(key);
        count++;
      }
    }
    if (count > 0) {
      persist();
      logger.info(
        "cache.bust_prefix",
        `Busted ${count} key(s) with prefix "${prefix}"`,
        {
          prefix,
          count,
        },
      );
    }
  },

  /** Return all current keys (for diagnostics). */
  keys() {
    return Array.from(store.keys());
  },
};

module.exports = cache;
