require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Octokit } = require("@octokit/rest");
const { spawn } = require("child_process");
const path = require("path");
const logger = require("./logger");
const cache = require("./cache");

const app = express();
app.set("etag", false);
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(logger.requestMiddleware);
app.use(express.static(path.join(__dirname, "public")));

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const COPILOT_BIN = process.env.COPILOT_BIN || "copilot";

const ORG = process.env.GITHUB_ORG;

// ── GET /api/repos ────────────────────────────────────────────────────────────

app.get("/api/repos", async (req, res) => {
  const refresh = req.query.refresh === "true";
  const cacheKey = `repos:${ORG}`;

  logger.info("repos.start", `Fetching all repos for org`, {
    org: ORG,
    refresh,
  });

  if (!ORG) {
    logger.error("repos.error", "GITHUB_ORG not set");
    return res
      .status(500)
      .json({ error: "GITHUB_ORG environment variable is not set." });
  }

  if (!refresh) {
    const cached = cache.get(cacheKey);
    if (cached) {
      logger.info("repos.cache_hit", `Serving repos from cache`, {
        org: ORG,
        count: cached.data.length,
        age_mins: Math.round((Date.now() - cached.cachedAt) / 60000),
      });
      return res.json({
        repos: cached.data,
        _cached: true,
        _cachedAt: cached.cachedAt,
      });
    }
  } else {
    cache.bust(cacheKey);
  }

  try {
    const repos = await octokit.paginate(octokit.repos.listForOrg, {
      org: ORG,
      per_page: 100,
      type: "all",
    });

    const sorted = repos
      .map(({ name, full_name, description }) => ({
        name,
        full_name,
        description,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    cache.set(cacheKey, sorted);
    logger.info("repos.ok", `Returned ${sorted.length} repos`, {
      org: ORG,
      count: sorted.length,
    });
    const entry = cache.get(cacheKey);
    res.json({ repos: sorted, _cached: false, _cachedAt: entry.cachedAt });
  } catch (err) {
    if (err.status === 404) {
      logger.warn(
        "repos.not_found",
        `Org "${ORG}" not found or token lacks access`,
        { org: ORG, status: 404 },
      );
      return res.status(404).json({
        error: `Organisation "${ORG}" not found or token lacks access.`,
      });
    }
    logger.error("repos.error", err.message, { org: ORG, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/tags/:repo ───────────────────────────────────────────────────────

app.get("/api/tags/:repo", async (req, res) => {
  const { repo } = req.params;
  const refresh = req.query.refresh === "true";
  const cacheKey = `tags:${ORG}:${repo}`;

  logger.info("tags.start", `Fetching tags`, { org: ORG, repo, refresh });

  if (!ORG) {
    logger.error("tags.error", "GITHUB_ORG not set");
    return res
      .status(500)
      .json({ error: "GITHUB_ORG environment variable is not set." });
  }

  if (!refresh) {
    const cached = cache.get(cacheKey);
    if (cached) {
      logger.info("tags.cache_hit", `Serving tags from cache`, {
        repo,
        age_mins: Math.round((Date.now() - cached.cachedAt) / 60000),
      });
      return res.json({
        ...cached.data,
        _cached: true,
        _cachedAt: cached.cachedAt,
      });
    }
  } else {
    cache.bust(cacheKey);
  }

  try {
    const tags = await octokit.paginate(octokit.repos.listTags, {
      owner: ORG,
      repo,
      per_page: 100,
    });

    const tagNames = tags.map((t) => t.name);
    logger.debug("tags.raw", `Found ${tagNames.length} total tags`, {
      repo,
      tags: tagNames,
    });

    const prodTagObjects = tags.filter((t) => /^production-/i.test(t.name));
    logger.info(
      "tags.production_found",
      `Found ${prodTagObjects.length} production-* tags`,
      {
        repo,
        production_tags: prodTagObjects.map((t) => t.name),
      },
    );

    let productionTags = [];

    if (prodTagObjects.length > 0) {
      logger.debug(
        "tags.resolving_dates",
        `Resolving commit dates for ${prodTagObjects.length} production tags`,
        { repo },
      );

      const withDates = await Promise.all(
        prodTagObjects.map(async (tag) => {
          try {
            const { data: commit } = await octokit.repos.getCommit({
              owner: ORG,
              repo,
              ref: tag.commit.sha,
            });
            const date = new Date(commit.commit.committer.date);
            logger.debug(
              "tags.commit_date",
              `Tag "${tag.name}" → ${date.toISOString()}`,
              {
                repo,
                tag: tag.name,
                sha: tag.commit.sha,
                date: date.toISOString(),
              },
            );
            return { name: tag.name, date };
          } catch (err) {
            logger.warn(
              "tags.commit_date_failed",
              `Could not resolve date for tag "${tag.name}"`,
              {
                repo,
                tag: tag.name,
                error: err.message,
              },
            );
            return { name: tag.name, date: new Date(0) };
          }
        }),
      );

      withDates.sort((a, b) => b.date - a.date);
      productionTags = withDates.map((t) => t.name);

      logger.info("tags.sorted", `Production tags sorted by date`, {
        repo,
        ordered: productionTags,
        latest: productionTags[0] || null,
      });
    }

    const payload = {
      all_tags: tagNames,
      production_tags: productionTags,
      latest_production_tag: productionTags[0] || null,
    };

    cache.set(cacheKey, payload);
    const entry = cache.get(cacheKey);

    logger.info("tags.ok", `Tags response ready`, {
      repo,
      total: tagNames.length,
      production_count: productionTags.length,
      latest: payload.latest_production_tag,
    });

    res.json({ ...payload, _cached: false, _cachedAt: entry.cachedAt });
  } catch (err) {
    if (err.status === 404) {
      logger.warn("tags.not_found", `Repo "${repo}" not found`, {
        repo,
        status: 404,
      });
      return res.status(404).json({ error: `Repository "${repo}" not found.` });
    }
    logger.error("tags.error", err.message, { repo, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/branches/:repo ─────────────────────────────────────────────────

app.get("/api/branches/:repo", async (req, res) => {
  const { repo } = req.params;
  const refresh = req.query.refresh === "true";
  const cacheKey = `branches:${ORG}:${repo}`;

  logger.info("branches.start", `Fetching branches`, {
    org: ORG,
    repo,
    refresh,
  });

  if (!ORG) {
    logger.error("branches.error", "GITHUB_ORG not set");
    return res
      .status(500)
      .json({ error: "GITHUB_ORG environment variable is not set." });
  }

  if (!refresh) {
    const cached = cache.get(cacheKey);
    if (cached) {
      logger.info("branches.cache_hit", `Serving branches from cache`, {
        repo,
        age_mins: Math.round((Date.now() - cached.cachedAt) / 60000),
      });
      return res.json({
        ...cached.data,
        _cached: true,
        _cachedAt: cached.cachedAt,
      });
    }
  } else {
    cache.bust(cacheKey);
  }

  try {
    const branches = await octokit.paginate(octokit.repos.listBranches, {
      owner: ORG,
      repo,
      per_page: 100,
    });

    const branchNames = branches.map((b) => b.name);

    // Sort: master/main first, then alphabetically
    branchNames.sort((a, b) => {
      const priority = (n) => (n === "master" || n === "main" ? 0 : 1);
      const pa = priority(a);
      const pb = priority(b);
      if (pa !== pb) return pa - pb;
      return a.localeCompare(b);
    });

    logger.info("branches.ok", `Found ${branchNames.length} branches`, {
      repo,
      count: branchNames.length,
    });

    const payload = { branches: branchNames };
    cache.set(cacheKey, payload);
    const entry = cache.get(cacheKey);

    res.json({ ...payload, _cached: false, _cachedAt: entry.cachedAt });
  } catch (err) {
    if (err.status === 404) {
      logger.warn("branches.not_found", `Repo "${repo}" not found`, {
        repo,
        status: 404,
      });
      return res.status(404).json({ error: `Repository "${repo}" not found.` });
    }
    logger.error("branches.error", err.message, { repo, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/compare/:repo ────────────────────────────────────────────────────

app.get("/api/compare/:repo", async (req, res) => {
  const { repo } = req.params;
  const head = req.query.head || "master";
  let base = req.query.base || null;

  logger.info("compare.start", `Starting compare`, {
    repo,
    base: base || "(auto)",
    head,
  });

  if (!ORG) {
    logger.error("compare.error", "GITHUB_ORG not set");
    return res
      .status(500)
      .json({ error: "GITHUB_ORG environment variable is not set." });
  }

  try {
    // Auto-resolve latest production tag if no base provided
    if (!base) {
      logger.info(
        "compare.resolve_base",
        "No base supplied — auto-resolving latest production tag",
        { repo },
      );
      try {
        const tags = await octokit.paginate(octokit.repos.listTags, {
          owner: ORG,
          repo,
          per_page: 100,
        });

        const prodTagObjects = tags.filter((t) => /^production-/i.test(t.name));
        logger.debug(
          "compare.resolve_base",
          `Found ${prodTagObjects.length} production tags to evaluate`,
          {
            repo,
            candidates: prodTagObjects.map((t) => t.name),
          },
        );

        const withDates = await Promise.all(
          prodTagObjects.map(async (tag) => {
            try {
              const { data: commit } = await octokit.repos.getCommit({
                owner: ORG,
                repo,
                ref: tag.commit.sha,
              });
              return {
                name: tag.name,
                date: new Date(commit.commit.committer.date),
              };
            } catch {
              return { name: tag.name, date: new Date(0) };
            }
          }),
        );

        withDates.sort((a, b) => b.date - a.date);
        const productionTags = withDates.map((t) => t.name);
        base = productionTags[0] || "production";
        logger.info("compare.resolve_base", `Auto-resolved base to "${base}"`, {
          repo,
          base,
        });
      } catch (err) {
        base = "production";
        logger.warn(
          "compare.resolve_base_failed",
          `Tag resolution failed, falling back to "production"`,
          {
            repo,
            error: err.message,
          },
        );
      }
    }

    // Fetch comparison from GitHub
    logger.info("compare.github_call", `Calling GitHub compareCommits`, {
      repo,
      base,
      head,
    });
    let compareData;
    try {
      const { data } = await octokit.repos.compareCommits({
        owner: ORG,
        repo,
        base,
        head,
      });
      compareData = data;
      logger.info("compare.github_ok", `GitHub compare returned`, {
        repo,
        base,
        head,
        status: compareData.status,
        commits: compareData.commits.length,
        files: compareData.files?.length ?? 0,
        ahead_by: compareData.ahead_by,
        behind_by: compareData.behind_by,
      });
    } catch (err) {
      if (err.status === 404) {
        logger.warn(
          "compare.not_found",
          `Could not compare "${base}" to "${head}"`,
          { repo, base, head, status: 404 },
        );
        return res.status(404).json({
          error: `Could not compare "${base}" to "${head}". Make sure both exist in "${repo}".`,
        });
      }
      throw err;
    }

    const commits = compareData.commits.map((c) => ({
      sha: c.sha,
      message: c.commit.message,
    }));
    const filesChanged = compareData.files ? compareData.files.length : 0;
    const compareUrl = compareData.html_url;

    logger.info(
      "compare.pr_lookup_start",
      `Looking up PRs for ${commits.length} commits`,
      { repo, commit_count: commits.length },
    );

    // Gather PRs from each commit SHA
    const prMap = new Map();
    let prLookupHits = 0;
    let prLookupMisses = 0;

    await Promise.all(
      commits.map(async ({ sha }) => {
        try {
          const { data: prs } = await octokit.request(
            "GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls",
            {
              owner: ORG,
              repo,
              commit_sha: sha,
              headers: { accept: "application/vnd.github.groot-preview+json" },
            },
          );
          if (prs.length > 0) {
            prLookupHits++;
            for (const pr of prs) {
              if (!prMap.has(pr.number)) {
                prMap.set(pr.number, pr);
                logger.debug(
                  "compare.pr_found",
                  `Found PR #${pr.number} via commit ${sha.slice(0, 7)}`,
                  {
                    repo,
                    sha: sha.slice(0, 7),
                    pr_number: pr.number,
                    pr_title: pr.title,
                  },
                );
              }
            }
          } else {
            prLookupMisses++;
          }
        } catch (err) {
          if (err.status !== 404) {
            logger.warn(
              "compare.pr_lookup_warn",
              `Could not fetch PRs for commit ${sha.slice(0, 7)}`,
              {
                repo,
                sha: sha.slice(0, 7),
                error: err.message,
              },
            );
          } else {
            prLookupMisses++;
          }
        }
      }),
    );

    logger.info("compare.pr_lookup_done", `PR lookup complete`, {
      repo,
      commits_checked: commits.length,
      commits_with_prs: prLookupHits,
      commits_without_prs: prLookupMisses,
      unique_prs: prMap.size,
    });

    // Fetch full PR details
    logger.info(
      "compare.pr_details_start",
      `Fetching full details for ${prMap.size} unique PRs`,
      { repo },
    );

    const prDetails = await Promise.all(
      Array.from(prMap.values()).map(async (pr) => {
        try {
          const { data } = await octokit.pulls.get({
            owner: ORG,
            repo,
            pull_number: pr.number,
          });
          logger.debug(
            "compare.pr_detail",
            `Fetched PR #${data.number}: "${data.title}"`,
            {
              repo,
              pr_number: data.number,
              author: data.user?.login,
              merged_at: data.merged_at,
            },
          );
          return {
            number: data.number,
            title: data.title,
            body: data.body || "",
            url: data.html_url,
            author: data.user ? data.user.login : "unknown",
            merged_at: data.merged_at,
          };
        } catch (err) {
          logger.warn(
            "compare.pr_detail_warn",
            `Could not fetch details for PR #${pr.number}`,
            {
              repo,
              pr_number: pr.number,
              error: err.message,
            },
          );
          return {
            number: pr.number,
            title: pr.title,
            body: pr.body || "",
            url: pr.html_url,
            author: pr.user ? pr.user.login : "unknown",
            merged_at: pr.merged_at,
          };
        }
      }),
    );

    prDetails.sort((a, b) => {
      if (!a.merged_at) return 1;
      if (!b.merged_at) return -1;
      return new Date(b.merged_at) - new Date(a.merged_at);
    });

    const payload = {
      compare_url: compareUrl,
      base,
      head,
      commits_count: commits.length,
      files_changed: filesChanged,
      prs: prDetails,
    };

    logger.info("compare.ok", `Compare complete`, {
      repo,
      base,
      head,
      commits_count: payload.commits_count,
      files_changed: payload.files_changed,
      pr_count: payload.prs.length,
      compare_url: compareUrl,
    });

    res.json(payload);
  } catch (err) {
    logger.error("compare.error", err.message, {
      repo,
      base,
      head,
      stack: err.stack,
    });
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/summarise ───────────────────────────────────────────────────────

app.post("/api/summarise", async (req, res) => {
  const { repo, prs, commits_count, files_changed, compare_url } = req.body;

  if (!prs || !repo) {
    logger.warn("summarise.bad_request", "Missing required fields", {
      repo,
      has_prs: !!prs,
    });
    return res
      .status(400)
      .json({ error: "Missing required fields: repo, prs" });
  }

  logger.info("summarise.start", `Starting AI summary`, {
    repo,
    pr_count: prs.length,
    commits_count,
    files_changed,
  });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const prSummaries = prs
    .map((pr) => {
      const body = pr.body ? pr.body.trim().slice(0, 500) : "(no description)";
      return `PR #${pr.number}: ${pr.title}\nAuthor: ${pr.author}\nDescription: ${body}`;
    })
    .join("\n\n---\n\n");

  const prompt = `You are a release manager writing a user-facing release summary for the product "${repo}".

The following changes are being released (${commits_count} commits, ${files_changed} files changed):

${prSummaries}

Write a concise, friendly release summary aimed at end users (not developers).
- Start with a brief one or two sentence intro paragraph summarising the overall theme of this release.
- Follow with a bullet list of the key features, improvements, and bug fixes.
- Focus on what users will experience, not technical implementation details.
- Keep language clear and accessible. Avoid jargon.
- Format the output as Markdown.`;

  logger.debug("summarise.prompt", "Copilot prompt built", {
    repo,
    prompt_length: prompt.length,
    pr_count: prs.length,
    pr_numbers: prs.map((p) => p.number),
  });

  logger.info("summarise.copilot_call", `Spawning copilot CLI`, {
    repo,
    bin: COPILOT_BIN,
  });

  await new Promise((resolve, reject) => {
    const child = spawn(COPILOT_BIN, ["-p", prompt], {
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";
    let chunkCount = 0;

    // Stream stdout line-by-line, filtering out noise
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();

      // Pull complete lines out of the buffer and forward content ones
      let nl;
      while ((nl = stdout.indexOf("\n")) !== -1) {
        const line = stdout.slice(0, nl);
        stdout = stdout.slice(nl + 1);

        // Stop forwarding once we hit the trailing stats block
        if (/^(Changes|Requests|Tokens)\s/.test(line)) {
          stdout = ""; // discard remaining buffer
          break;
        }

        // Skip warning/notice lines emitted by the CLI
        if (line.startsWith("!") || /^\s+are available\.$/.test(line)) continue;

        // Forward the line as an SSE chunk (re-add the newline we stripped)
        const text = line + "\n";
        chunkCount++;
        const escaped = text.replace(/\n/g, "\\n");
        res.write(`data: ${escaped}\n\n`);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      logger.error("summarise.copilot_spawn_error", err.message, {
        repo,
        bin: COPILOT_BIN,
      });
      reject(err);
    });

    child.on("close", (code) => {
      // Flush any remaining buffered content (no trailing newline)
      if (
        stdout.trim() &&
        !/^(Changes|Requests|Tokens)\s/.test(stdout.trim())
      ) {
        const escaped = stdout.replace(/\n/g, "\\n");
        res.write(`data: ${escaped}\n\n`);
        chunkCount++;
      }

      if (code !== 0) {
        logger.warn(
          "summarise.copilot_exit",
          `copilot exited with code ${code}`,
          {
            repo,
            code,
            stderr: stderr.slice(0, 500),
          },
        );
        reject(
          new Error(
            `copilot exited with code ${code}: ${stderr.slice(0, 200)}`,
          ),
        );
        return;
      }

      logger.info("summarise.copilot_done", `copilot finished`, {
        repo,
        code,
        chunks_sent: chunkCount,
      });
      resolve();
    });
  })
    .then(() => {
      res.write("data: [DONE]\n\n");
      res.end();
    })
    .catch((err) => {
      logger.error("summarise.error", err.message, { repo, stack: err.stack });
      res.write(`data: [ERROR] ${err.message}\n\n`);
      res.end();
    });
});

// ── Catch-all ─────────────────────────────────────────────────────────────────

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  logger.separator(`Release Radar started — http://localhost:${PORT}`);
  logger.info("server.start", `Server listening`, {
    port: PORT,
    org: ORG || "(not set)",
    log_file: require("path").join(__dirname, "logs", "app.log"),
  });
});
