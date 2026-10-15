/* ============================================================
   Release Radar — app.js
   ============================================================ */

// State
let currentData = null;
let currentRepo = null;

// DOM refs
const repoSelect = document.getElementById("repo-select");
const repoRefresh = document.getElementById("repo-refresh");
const repoCacheHint = document.getElementById("repo-cache-hint");
const baseSelect = document.getElementById("base-select");
const baseHint = document.getElementById("base-hint");
const baseRefresh = document.getElementById("base-refresh");
const baseCacheHint = document.getElementById("base-cache-hint");
const headSelect = document.getElementById("head-select");
const headHint = document.getElementById("head-hint");
const headRefresh = document.getElementById("head-refresh");
const headCacheHint = document.getElementById("head-cache-hint");
const analyseBtn = document.getElementById("analyse-btn");
const errorBanner = document.getElementById("error-banner");
const errorMessage = document.getElementById("error-message");
const errorDismiss = document.getElementById("error-dismiss");
const resultsSection = document.getElementById("results-section");
const compareLink = document.getElementById("compare-link");
const commitsCount = document.getElementById("commits-count");
const filesChanged = document.getElementById("files-changed");
const prsCount = document.getElementById("prs-count");
const prList = document.getElementById("pr-list");
const noPrsMsg = document.getElementById("no-prs-msg");
const prsToggle = document.getElementById("prs-toggle");
const prsBody = document.getElementById("prs-body");
const summariseBtn = document.getElementById("summarise-btn");
const summaryContainer = document.getElementById("summary-container");
const summaryOutput = document.getElementById("summary-output");
const summaryCursor = document.getElementById("summary-cursor");
const copyBtn = document.getElementById("copy-btn");
const copyImageBtn = document.getElementById("copy-image-btn");
const copyImageLabel = document.getElementById("copy-image-label");

// Only available inside the Electron shell (see preload.js)
const canCopyImage = typeof window.releaseRadar?.copyImage === "function";
copyImageBtn.hidden = !canCopyImage;

// ============================================================
// Helpers
// ============================================================

function showError(msg) {
  errorMessage.textContent = msg;
  errorBanner.hidden = false;
  errorBanner.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function hideError() {
  errorBanner.hidden = true;
  errorMessage.textContent = "";
}

function setAnalyseLoading(loading) {
  analyseBtn.disabled = loading;
  analyseBtn.textContent = loading ? "Analysing…" : "Analyse Release";
}

function setSummariseLoading(loading) {
  summariseBtn.disabled = loading;
  summariseBtn.textContent = loading ? "Generating…" : "Generate AI Summary";
  copyImageBtn.disabled = loading;
}

function formatDate(isoString) {
  if (!isoString) return null;
  const d = new Date(isoString);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatCacheAge(cachedAt) {
  if (!cachedAt) return "";
  const mins = Math.round((Date.now() - cachedAt) / 60000);
  if (mins < 1) return "Cached just now";
  if (mins < 60) return `Cached ${mins} min${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  return `Cached ${hrs} hr${hrs === 1 ? "" : "s"} ago`;
}

// ============================================================
// Load branches for a repo and populate head selector
// ============================================================

async function loadBranches(repo, refresh = false) {
  headSelect.disabled = true;
  headRefresh.disabled = true;
  headSelect.innerHTML = '<option value="">Loading branches…</option>';
  headHint.textContent = "";
  headCacheHint.textContent = "";

  try {
    const url = `/api/branches/${encodeURIComponent(repo)}${refresh ? "?refresh=true" : ""}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    headCacheHint.textContent = data._cached
      ? formatCacheAge(data._cachedAt)
      : "";

    headSelect.innerHTML = "";

    if (data.branches.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No branches found";
      headSelect.appendChild(opt);
      headHint.textContent = "This repo has no branches.";
    } else {
      for (const branch of data.branches) {
        const opt = document.createElement("option");
        opt.value = branch;
        opt.textContent = branch;
        headSelect.appendChild(opt);
      }

      // Default to master, then main, then first branch
      const preferred = ["master", "main"];
      const defaultBranch =
        preferred.find((b) => data.branches.includes(b)) || data.branches[0];
      headSelect.value = defaultBranch;
      headHint.textContent = `✓ Defaulted to “${defaultBranch}”`;
      headSelect.disabled = false;
    }
  } catch (err) {
    headSelect.innerHTML = '<option value="">Failed to load branches</option>';
    headHint.textContent = err.message;
  } finally {
    headRefresh.disabled = false;
  }
}

// ============================================================
// Load tags for a repo and populate base selector
// ============================================================

async function loadTags(repo, refresh = false) {
  baseSelect.disabled = true;
  baseRefresh.disabled = true;
  baseSelect.innerHTML = '<option value="">Loading tags…</option>';
  baseHint.textContent = "";
  baseCacheHint.textContent = "";

  try {
    const url = `/api/tags/${encodeURIComponent(repo)}${refresh ? "?refresh=true" : ""}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    baseCacheHint.textContent = data._cached
      ? formatCacheAge(data._cachedAt)
      : "";

    baseSelect.innerHTML = "";

    if (data.production_tags.length === 0) {
      if (data.all_tags.length === 0) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "No tags found";
        baseSelect.appendChild(opt);
        baseHint.textContent = "This repo has no tags.";
      } else {
        baseHint.textContent = "No production-* tags found. Showing all tags.";
        for (const tag of data.all_tags) {
          const opt = document.createElement("option");
          opt.value = tag;
          opt.textContent = tag;
          baseSelect.appendChild(opt);
        }
        baseSelect.disabled = false;
      }
    } else {
      for (const tag of data.production_tags) {
        const opt = document.createElement("option");
        opt.value = tag;
        opt.textContent = tag;
        baseSelect.appendChild(opt);
      }
      baseSelect.disabled = false;
      baseHint.textContent = "✓ Auto-selected latest production tag";

      if (data.all_tags.length > data.production_tags.length) {
        const divider = document.createElement("option");
        divider.disabled = true;
        divider.textContent = "── Other tags ──";
        baseSelect.appendChild(divider);
        for (const tag of data.all_tags) {
          if (!/^production-/i.test(tag)) {
            const opt = document.createElement("option");
            opt.value = tag;
            opt.textContent = tag;
            baseSelect.appendChild(opt);
          }
        }
      }
    }
  } catch (err) {
    baseSelect.innerHTML = '<option value="">Failed to load tags</option>';
    baseHint.textContent = err.message;
  } finally {
    baseRefresh.disabled = false;
  }
}

async function loadRepos(refresh = false) {
  repoSelect.disabled = true;
  repoRefresh.disabled = true;
  repoSelect.innerHTML = '<option value="">Loading repositories…</option>';
  repoCacheHint.textContent = "";

  try {
    const url = `/api/repos${refresh ? "?refresh=true" : ""}`;
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res
        .json()
        .catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const body = await res.json();
    const repos = body.repos;

    repoCacheHint.textContent = body._cached
      ? formatCacheAge(body._cachedAt)
      : "";

    repoSelect.innerHTML = "";

    if (repos.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No repositories found";
      repoSelect.appendChild(opt);
      return;
    }

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a repository…";
    placeholder.disabled = true;
    placeholder.selected = true;
    repoSelect.appendChild(placeholder);

    for (const repo of repos) {
      const opt = document.createElement("option");
      opt.value = repo.name;
      opt.textContent = repo.description
        ? `${repo.name} — ${repo.description.slice(0, 60)}${repo.description.length > 60 ? "…" : ""}`
        : repo.name;
      repoSelect.appendChild(opt);
    }

    repoSelect.disabled = false;
    analyseBtn.disabled = false;
  } catch (err) {
    repoSelect.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Failed to load repos";
    repoSelect.appendChild(opt);
    showError(`Could not load repositories: ${err.message}`);
  } finally {
    repoRefresh.disabled = false;
  }
}

// ============================================================
// Analyse release
// ============================================================

async function analyseRelease() {
  const repo = repoSelect.value;
  if (!repo) {
    showError("Please select a repository first.");
    return;
  }

  const base = baseSelect.value;
  if (!base) {
    showError("Please select a base tag first.");
    return;
  }
  const head = headSelect.value || "master";

  hideError();
  resultsSection.hidden = true;
  summaryContainer.hidden = true;
  summaryOutput.innerHTML = "";
  currentData = null;
  currentRepo = repo;

  setAnalyseLoading(true);

  try {
    const params = new URLSearchParams({ base, head });
    const res = await fetch(
      `/api/compare/${encodeURIComponent(repo)}?${params}`,
    );
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    currentData = data;

    // Populate stats
    compareLink.href = data.compare_url;
    commitsCount.textContent = data.commits_count.toLocaleString();
    filesChanged.textContent = data.files_changed.toLocaleString();
    prsCount.textContent = data.prs.length.toLocaleString();

    // Populate PR list
    prList.innerHTML = "";

    if (data.prs.length === 0) {
      noPrsMsg.hidden = false;
    } else {
      noPrsMsg.hidden = true;
      data.prs.forEach((pr, i) => {
        const li = document.createElement("li");
        li.className = "pr-item";
        li.style.animationDelay = `${i * 40}ms`;

        const dateStr = formatDate(pr.merged_at);

        li.innerHTML = `
          <span class="pr-number">#${pr.number}</span>
          <div class="pr-body">
            <a href="${escapeHtml(pr.url)}" target="_blank" rel="noopener" class="pr-title" title="${escapeHtml(pr.title)}">${escapeHtml(pr.title)}</a>
            <div class="pr-meta">
              <span class="pr-author">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                </svg>
                ${escapeHtml(pr.author)}
              </span>
              ${
                dateStr
                  ? `<span class="pr-meta-sep">·</span><span class="pr-date">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                ${dateStr}
              </span>`
                  : ""
              }
            </div>
          </div>
        `;
        prList.appendChild(li);
      });
    }

    // Ensure PR list is expanded
    prsBody.classList.remove("collapsed");
    prsToggle.setAttribute("aria-expanded", "true");
    prsBody.style.maxHeight = prsBody.scrollHeight + "px";

    resultsSection.hidden = false;
    resultsSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    showError(
      err.message ||
        "An unexpected error occurred while analysing the release.",
    );
  } finally {
    setAnalyseLoading(false);
    // Re-enable button (but don't enable if no repo)
    analyseBtn.disabled = !repoSelect.value;
  }
}

// ============================================================
// Generate AI summary (streaming SSE)
// ============================================================

async function generateSummary() {
  if (!currentData || !currentRepo) return;

  hideError();
  summaryContainer.hidden = false;
  summaryOutput.innerHTML = "";
  summaryCursor.hidden = false;
  setSummariseLoading(true);
  copyBtn.classList.remove("copied");
  copyBtn.querySelector("svg + *") && (copyBtn.lastChild.textContent = " Copy");

  let rawMarkdown = "";

  try {
    const res = await fetch("/api/summarise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repo: currentRepo,
        prs: currentData.prs,
        commits_count: currentData.commits_count,
        files_changed: currentData.files_changed,
        compare_url: currentData.compare_url,
      }),
    });

    if (!res.ok) {
      const err = await res
        .json()
        .catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE events (terminated by \n\n)
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        if (event.startsWith("data: ")) {
          const payload = event.slice(6);

          if (payload === "[DONE]") {
            // Done streaming
            summaryCursor.hidden = true;
            setSummariseLoading(false);
            // Final render
            summaryOutput.innerHTML = marked.parse(rawMarkdown);
            summaryContainer.scrollIntoView({
              behavior: "smooth",
              block: "nearest",
            });
            return;
          }

          if (payload.startsWith("[ERROR]")) {
            throw new Error(payload.slice(8));
          }

          // Unescape newlines
          const chunk = payload.replace(/\\n/g, "\n");
          rawMarkdown += chunk;

          // Live render
          summaryOutput.innerHTML = marked.parse(rawMarkdown);
        }
      }
    }
  } catch (err) {
    summaryCursor.hidden = true;
    showError(`Summary generation failed: ${err.message}`);
  } finally {
    setSummariseLoading(false);
    summaryCursor.hidden = true;
  }
}

// ============================================================
// Copy to clipboard
// ============================================================

copyBtn.addEventListener("click", async () => {
  const text = summaryOutput.innerText || summaryOutput.textContent;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copyBtn.classList.add("copied");
    const textNode = Array.from(copyBtn.childNodes).find(
      (n) => n.nodeType === 3,
    );
    if (textNode) textNode.textContent = " Copied!";
    setTimeout(() => {
      copyBtn.classList.remove("copied");
      const tn = Array.from(copyBtn.childNodes).find((n) => n.nodeType === 3);
      if (tn) tn.textContent = " Copy";
    }, 2000);
  } catch {
    // Clipboard API not available (e.g. non-HTTPS)
  }
});

// ============================================================
// Copy release card to clipboard as an image (Electron only)
// ============================================================

const CAPTURE_PADDING = 8; // px of page background around the card

const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

async function copyReleaseImage() {
  if (!canCopyImage || resultsSection.hidden) return;

  copyImageBtn.disabled = true;
  hideError();

  // Take controls marked data-no-capture out of the layout for the shot
  const excluded = Array.from(
    resultsSection.querySelectorAll("[data-no-capture]"),
  ).map((el) => ({ el, display: el.style.display }));
  excluded.forEach(({ el }) => (el.style.display = "none"));

  try {
    // Let the browser lay out without those controls before measuring, and
    // wait for any fade-in animations so we never capture a half-faded card
    await nextFrame();
    await nextFrame();
    const running = resultsSection
      .getAnimations({ subtree: true })
      .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.allSettled(running.map((a) => a.finished));

    const box = resultsSection.getBoundingClientRect();
    const x = Math.max(0, box.left + window.scrollX - CAPTURE_PADDING);
    const y = Math.max(0, box.top + window.scrollY - CAPTURE_PADDING);
    const rect = {
      x,
      y,
      width: box.right + window.scrollX + CAPTURE_PADDING - x,
      height: box.bottom + window.scrollY + CAPTURE_PADDING - y,
    };

    await window.releaseRadar.copyImage(rect, window.devicePixelRatio || 1);

    copyImageBtn.classList.add("copied");
    copyImageLabel.textContent = "Copied!";
    setTimeout(() => {
      copyImageBtn.classList.remove("copied");
      copyImageLabel.textContent = "Copy as image";
    }, 2000);
  } catch (err) {
    showError(`Could not copy image: ${err.message}`);
  } finally {
    excluded.forEach(({ el, display }) => (el.style.display = display));
    copyImageBtn.disabled = false;
  }
}

// ============================================================
// Collapsible PR list
// ============================================================

prsToggle.addEventListener("click", () => {
  const expanded = prsToggle.getAttribute("aria-expanded") === "true";
  if (expanded) {
    prsBody.style.maxHeight = prsBody.scrollHeight + "px";
    requestAnimationFrame(() => {
      prsBody.style.maxHeight = "0px";
      prsBody.classList.add("collapsed");
    });
    prsToggle.setAttribute("aria-expanded", "false");
  } else {
    prsBody.classList.remove("collapsed");
    prsBody.style.maxHeight = prsBody.scrollHeight + "px";
    prsToggle.setAttribute("aria-expanded", "true");
    // Remove explicit maxHeight after transition so it can grow
    prsBody.addEventListener(
      "transitionend",
      () => {
        if (prsToggle.getAttribute("aria-expanded") === "true") {
          prsBody.style.maxHeight = "none";
        }
      },
      { once: true },
    );
  }
});

// ============================================================
// Escape HTML helper
// ============================================================

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ============================================================
// Event listeners
// ============================================================

errorDismiss.addEventListener("click", hideError);
analyseBtn.addEventListener("click", analyseRelease);

summariseBtn.addEventListener("click", generateSummary);
copyImageBtn.addEventListener("click", copyReleaseImage);

repoSelect.addEventListener("change", () => {
  const repo = repoSelect.value;
  analyseBtn.disabled = !repo;
  baseRefresh.disabled = !repo;
  if (repo) {
    loadTags(repo);
    loadBranches(repo);
  }
});

repoRefresh.addEventListener("click", () => loadRepos(true));
baseRefresh.addEventListener("click", () => {
  const repo = repoSelect.value;
  if (repo) loadTags(repo, true);
});
headRefresh.addEventListener("click", () => {
  const repo = repoSelect.value;
  if (repo) loadBranches(repo, true);
});

// ============================================================
// Init
// ============================================================

loadRepos();
