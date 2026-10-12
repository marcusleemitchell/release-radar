/**
 * logger.js — structured request/response and app processing logger.
 *
 * Writes newline-delimited JSON to logs/app.log and mirrors a
 * human-readable version to stdout.
 *
 * Log entry shape:
 * {
 *   ts:      ISO timestamp,
 *   level:   "INFO" | "WARN" | "ERROR" | "DEBUG",
 *   event:   short machine-readable event name,
 *   msg:     human-readable description,
 *   ...any additional context fields
 * }
 */

const fs = require("fs");
const path = require("path");

// ── Setup log directory & file ──────────────────────────────────────────────

const { LOG_DIR } = require("./paths");
const LOG_FILE = path.join(LOG_DIR, "app.log");

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Append-only write stream — stays open for the lifetime of the process
const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });

// ── Colour helpers for stdout ───────────────────────────────────────────────

const COLOURS = {
  INFO:  "\x1b[36m",  // cyan
  WARN:  "\x1b[33m",  // yellow
  ERROR: "\x1b[31m",  // red
  DEBUG: "\x1b[90m",  // grey
  RESET: "\x1b[0m",
};

// ── Core write function ─────────────────────────────────────────────────────

function write(level, event, msg, context = {}) {
  const ts = new Date().toISOString();
  const entry = { ts, level, event, msg, ...context };

  // Write JSON line to file
  logStream.write(JSON.stringify(entry) + "\n");

  // Write coloured line to stdout
  const colour = COLOURS[level] || "";
  const reset  = COLOURS.RESET;
  const prefix = `${colour}[${level}]${reset} ${ts} ${colour}${event}${reset}`;
  const ctxStr = Object.keys(context).length
    ? "  " + JSON.stringify(context)
    : "";
  console.log(`${prefix}  ${msg}${ctxStr}`);
}

// ── Public logging methods ──────────────────────────────────────────────────

const logger = {
  info:  (event, msg, ctx) => write("INFO",  event, msg, ctx),
  warn:  (event, msg, ctx) => write("WARN",  event, msg, ctx),
  error: (event, msg, ctx) => write("ERROR", event, msg, ctx),
  debug: (event, msg, ctx) => write("DEBUG", event, msg, ctx),

  // ── Express middleware ────────────────────────────────────────────────────
  /**
   * Attach as app.use(logger.requestMiddleware) to log every HTTP
   * request and its final response status/duration.
   */
  requestMiddleware(req, res, next) {
    const start = Date.now();
    const { method, url, ip } = req;

    // Skip static asset noise
    const isStatic = /\.(js|css|ico|png|svg|woff2?)(\?.*)?$/.test(url);
    if (!isStatic) {
      write("INFO", "http.request", `${method} ${url}`, { method, url, ip });
    }

    res.on("finish", () => {
      if (isStatic) return;
      const ms   = Date.now() - start;
      const code = res.statusCode;
      const level = code >= 500 ? "ERROR" : code >= 400 ? "WARN" : "INFO";
      write(level, "http.response", `${method} ${url} → ${code} (${ms}ms)`, {
        method,
        url,
        status: code,
        duration_ms: ms,
      });
    });

    next();
  },

  // ── Convenience: log a separator / session start ─────────────────────────
  separator(msg = "─────────────────────────────────────────") {
    const line = `\n${"─".repeat(60)}\n  ${msg}\n${"─".repeat(60)}`;
    logStream.write(line + "\n");
    console.log("\x1b[90m" + line + "\x1b[0m");
  },
};

module.exports = logger;
