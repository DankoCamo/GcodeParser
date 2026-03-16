const els = {
  sourceCode: document.getElementById("sourceCode"),
  optimizedCode: document.getElementById("optimizedCode"),
  sourcePreview: document.getElementById("sourcePreview"),
  optimizedPreview: document.getElementById("optimizedPreview"),
  fileInput: document.getElementById("fileInput"),
  dropzone: document.getElementById("dropzone"),
  pasteDemoBtn: document.getElementById("pasteDemoBtn"),
  optimizeBtn: document.getElementById("optimizeBtn"),
  downloadBtn: document.getElementById("downloadBtn"),
  copyBtn: document.getElementById("copyBtn"),
  csvBtn: document.getElementById("csvBtn"),
  reportBtn: document.getElementById("reportBtn"),
  engineStatus: document.getElementById("engineStatus"),
  originalStats: document.getElementById("originalStats"),
  optimizedStats: document.getElementById("optimizedStats"),
  reductionStats: document.getElementById("reductionStats"),
  changesStats: document.getElementById("changesStats"),
  originalTimeStats: document.getElementById("originalTimeStats"),
  optimizedTimeStats: document.getElementById("optimizedTimeStats"),
  timeSavedStats: document.getElementById("timeSavedStats"),
  rapidBreakdownStats: document.getElementById("rapidBreakdownStats"),
  cuttingBreakdownStats: document.getElementById("cuttingBreakdownStats"),
  overheadBreakdownStats: document.getElementById("overheadBreakdownStats"),
  moneySavedStats: document.getElementById("moneySavedStats"),
  moneyDailyStats: document.getElementById("moneyDailyStats"),
  moneyMonthlyStats: document.getElementById("moneyMonthlyStats"),
  moneyYearlyStats: document.getElementById("moneyYearlyStats"),
  roiStats: document.getElementById("roiStats"),
  optimizationMetricList: document.getElementById("optimizationMetricList"),
  warningCount: document.getElementById("warningCount"),
  warningList: document.getElementById("warningList"),
  optimizationMode: document.getElementById("optimizationMode"),
  machineRate: document.getElementById("machineRate"),
  jobsPerDay: document.getElementById("jobsPerDay"),
  workDaysPerMonth: document.getElementById("workDaysPerMonth"),
  feedScale: document.getElementById("feedScale"),
  spindleScale: document.getElementById("spindleScale"),
  feedScaleOut: document.getElementById("feedScaleOut"),
  spindleScaleOut: document.getElementById("spindleScaleOut"),
  removeRedundantMoves: document.getElementById("removeRedundantMoves"),
  optimizeRapidTraverse: document.getElementById("optimizeRapidTraverse"),
  smoothRapidTraverses: document.getElementById("smoothRapidTraverses"),
  removeComments: document.getElementById("removeComments"),
  normalizeFeedRates: document.getElementById("normalizeFeedRates"),
  removeDuplicateCoordinates: document.getElementById("removeDuplicateCoordinates"),
};

const UI_BUILD = "v2026.03.13-3";
console.log(`[CAMOutput] Loaded ${UI_BUILD}`);
let renderSequence = 0;
let lastRemovedEntries = [];
let lastStats = null;

function setEngineStatus(mode, detail = "") {
  if (!els.engineStatus) {
    return;
  }
  const label = mode === "fallback" ? "Engine: Fallback" : "Engine: API";
  els.engineStatus.textContent = detail ? `${label} (${detail})` : label;
  els.engineStatus.classList.toggle("fallback", mode === "fallback");
}

function renderWarnings(warnings) {
  const entries = Array.isArray(warnings) ? warnings : [];
  if (els.warningCount) {
    els.warningCount.textContent = String(entries.length);
  }
  if (!els.warningList) {
    return;
  }
  if (entries.length === 0) {
    els.warningList.innerHTML = '<div class="warning-item ok">No warnings</div>';
    return;
  }
  els.warningList.innerHTML = entries
    .map((w) => {
      const type = w && w.type === "critical" ? "critical" : "warning";
      const line = Number.isFinite(w?.line) ? `L${w.line}` : "-";
      const msg = escapeHtml(w?.message || "Warning");
      return `<div class="warning-item ${type}"><span class="warning-line">${line}</span><span class="warning-msg">${msg}</span></div>`;
    })
    .join("");
}

function mountBuildBadge() {
  if (document.getElementById("buildBadge")) return;
  const badge = document.createElement("div");
  badge.id = "buildBadge";
  badge.textContent = `UI ${UI_BUILD}`;
  badge.style.position = "fixed";
  badge.style.left = "12px";
  badge.style.bottom = "12px";
  badge.style.padding = "6px 10px";
  badge.style.borderRadius = "999px";
  badge.style.font = "700 11px/1 Inter, sans-serif";
  badge.style.letterSpacing = ".08em";
  badge.style.background = "#ff3b30";
  badge.style.color = "#fff";
  badge.style.zIndex = "99999";
  badge.style.pointerEvents = "none";
  badge.style.boxShadow = "0 8px 24px rgba(255,59,48,.45)";
  document.body.appendChild(badge);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountBuildBadge, { once: true });
} else {
  mountBuildBadge();
}

function hasRequiredElements() {
  return Object.values(els).every((el) => el !== null);
}

const DEMO_CODE = `G90
G0 X0 Y0 Z10
G0 X10 Y10 Z10
G0 X10 Y10 Z10
G1 X20 Y20 F1200
G1 X20 Y20 F1200
G1 X30 Y25 F1200
M3 S12000
M3 S12000
G0 X50 Y30 Z10
G0 X45 Y20 Z10
G0 X50 Y10 Z10
; ovaj komentar se moze ukloniti
; jos jedan komentar
G1 X30 Y25 F1200
G1 X30 Y25 F1200
G1 X40 Y30 F1200
\n`;

function formatPercent(v) {
  return `${Math.round(v)}%`;
}

function roundSmart(v) {
  return Number.parseFloat(Number(v).toFixed(6));
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatCurrency(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);
}

function splitComment(line) {
  const idx = line.indexOf(";");
  if (idx === -1) {
    return { core: line, comment: "" };
  }
  return { core: line.slice(0, idx), comment: line.slice(idx + 1).trim() };
}

function parseGcode(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return lines.map((raw, i) => parseLine(raw, i));
}

function parseLine(raw, lineIndex) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { raw, lineIndex, kind: "blank", comment: "", params: {}, order: [] };
  }

  if (trimmed.startsWith(";")) {
    return {
      raw,
      lineIndex,
      kind: "comment",
      command: null,
      params: {},
      order: [],
      comment: trimmed.slice(1).trim(),
    };
  }

  const { core, comment } = splitComment(raw);
  const token = core.trim();
  const cmdMatch = token.match(/^([GMTgmt])(\d+)/);
  if (!cmdMatch) {
    return {
      raw,
      lineIndex,
      kind: "unknown",
      command: null,
      params: {},
      order: [],
      comment,
    };
  }

  const command = `${cmdMatch[1].toUpperCase()}${Number.parseInt(cmdMatch[2], 10)}`;
  const rest = token.slice(cmdMatch[0].length);
  const params = {};
  const order = [];
  const paramRegex = /([A-Za-z])\s*([+\-]?\d*\.?\d+)?/g;
  let match;

  while ((match = paramRegex.exec(rest)) !== null) {
    const key = match[1].toUpperCase();
    const rawValue = match[2];
    if (!order.includes(key)) {
      order.push(key);
    }
    if (rawValue === undefined) {
      params[key] = true;
    } else {
      params[key] = Number(rawValue);
    }
  }

  return {
    raw,
    lineIndex,
    kind: "command",
    command,
    params,
    order,
    comment,
  };
}

function lineToString(line) {
  if (line.kind === "blank") {
    return "";
  }

  if (line.kind === "comment") {
    return line.comment ? `; ${line.comment}` : ";";
  }

  if (line.kind !== "command" || !line.command) {
    return line.raw;
  }

  const chunks = [line.command];
  for (const key of line.order) {
    if (!(key in line.params)) {
      continue;
    }
    const value = line.params[key];
    if (value === true) {
      chunks.push(key);
      continue;
    }
    chunks.push(`${key}${roundSmart(value)}`);
  }

  if (line.comment) {
    chunks.push(`; ${line.comment}`);
  }

  return chunks.join(" ").trim();
}

function isMotion(line) {
  return Boolean(line) && line.kind === "command" && /^G[0-3]$/.test(line.command);
}

function isRapid(line) {
  return Boolean(line) && line.kind === "command" && line.command === "G0";
}

function hasExtrusion(line) {
  return Boolean(line) && line.kind === "command" && Number.isFinite(line.params.E);
}

function applyScales(lines, options) {
  for (const line of lines) {
    if (line.kind !== "command") {
      continue;
    }
    if (Number.isFinite(line.params.F)) {
      line.params.F = line.params.F * options.feedScale;
    }
    if (Number.isFinite(line.params.S)) {
      line.params.S = line.params.S * options.spindleScale;
    }
  }
}

function removeCommentsAndBlank(lines) {
  return lines.filter((line) => line.kind !== "blank" && line.kind !== "comment");
}

function removeDuplicateCoordinates(lines) {
  const state = { X: undefined, Y: undefined, Z: undefined };

  for (const line of lines) {
    if (!isMotion(line)) {
      continue;
    }

    for (const axis of ["X", "Y", "Z"]) {
      if (!Number.isFinite(line.params[axis])) {
        continue;
      }
      if (state[axis] !== undefined && line.params[axis] === state[axis]) {
        delete line.params[axis];
        line.order = line.order.filter((k) => k !== axis);
      } else {
        state[axis] = line.params[axis];
      }
    }
  }

  return lines.filter((line) => {
    if (!isMotion(line)) {
      return true;
    }

    const hasXYZ = ["X", "Y", "Z"].some((axis) => axis in line.params);
    const hasE = "E" in line.params;
    return hasXYZ || hasE;
  });
}

function removeRedundantMoves(lines) {
  const out = [];
  const position = { X: undefined, Y: undefined, Z: undefined };

  for (const line of lines) {
    if (!isMotion(line)) {
      out.push(line);
      continue;
    }

    const next = { ...position };
    for (const axis of ["X", "Y", "Z"]) {
      if (Number.isFinite(line.params[axis])) {
        next[axis] = line.params[axis];
      }
    }

    const noPosChange = ["X", "Y", "Z"].every((axis) => next[axis] === position[axis]);
    if (noPosChange && !hasExtrusion(line)) {
      continue;
    }

    Object.assign(position, next);
    out.push(line);
  }

  return out;
}

function normalizeFeedRates(lines) {
  let currentF;
  return lines.filter((line) => {
    if (line.kind !== "command") {
      return true;
    }
    if (!Number.isFinite(line.params.F)) {
      return true;
    }

    if (currentF !== undefined && line.params.F === currentF) {
      delete line.params.F;
      line.order = line.order.filter((k) => k !== "F");
    } else {
      currentF = line.params.F;
    }

    return true;
  });
}

function removeDuplicateModalCommands(lines) {
  let lastKey = null;
  const out = [];

  for (const line of lines) {
    if (line.kind !== "command") {
      out.push(line);
      lastKey = null;
      continue;
    }

    const paramKey = line.order
      .filter((k) => k in line.params)
      .map((k) => `${k}:${line.params[k]}`)
      .join("|");

    const key = `${line.command}|${paramKey}|${line.comment || ""}`;
    if (key === lastKey) {
      continue;
    }
    out.push(line);
    lastKey = key;
  }

  return out;
}

function optimizeRapidBlocks(lines) {
  const out = [];
  let i = 0;

  while (i < lines.length) {
    if (!isRapid(lines[i])) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    const block = [];
    while (i < lines.length && isRapid(lines[i]) && !hasExtrusion(lines[i])) {
      block.push(lines[i]);
      i += 1;
    }

    out.push(...nearestNeighborRapid(block));
  }

  return out;
}

function pointFromLine(line) {
  if (!isRapid(line)) {
    return null;
  }

  if (!Number.isFinite(line.params.X) || !Number.isFinite(line.params.Y)) {
    return null;
  }

  return {
    x: line.params.X,
    y: line.params.Y,
    z: Number.isFinite(line.params.Z) ? line.params.Z : null,
  };
}

function nearestNeighborRapid(block) {
  if (block.length < 3) {
    return block;
  }

  const points = block.map(pointFromLine);
  if (points.some((p) => p === null)) {
    return block;
  }

  const firstZ = points[0].z;
  if (!points.every((p) => p.z === firstZ)) {
    return block;
  }

  const remaining = block.slice(1);
  const ordered = [block[0]];
  let current = points[0];

  while (remaining.length) {
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;

    for (let idx = 0; idx < remaining.length; idx += 1) {
      const p = pointFromLine(remaining[idx]);
      const d = Math.hypot((p.x - current.x), (p.y - current.y));
      if (d < bestDist) {
        bestDist = d;
        bestIdx = idx;
      }
    }

    const [next] = remaining.splice(bestIdx, 1);
    ordered.push(next);
    current = pointFromLine(next);
  }

  return ordered;
}

function smoothRapidTraverses(lines) {
  const out = [];

  for (let i = 0; i < lines.length; i += 1) {
    const prev = out[out.length - 1];
    const curr = lines[i];
    const next = lines[i + 1];

    if (!(isRapid(prev) && isRapid(curr) && isRapid(next))) {
      out.push(curr);
      continue;
    }

    const a = pointFromLine(prev);
    const b = pointFromLine(curr);
    const c = pointFromLine(next);

    if (!a || !b || !c) {
      out.push(curr);
      continue;
    }

    if (a.z !== b.z || b.z !== c.z) {
      out.push(curr);
      continue;
    }

    const area2 = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(area2) < 1e-9) {
      continue;
    }

    out.push(curr);
  }

  return out;
}

function computeStats(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const nonEmpty = lines.filter((l) => l.trim() !== "").length;
  const moves = lines.filter((l) => /^\s*G[0-3]\b/i.test(l)).length;
  const comments = lines.filter((l) => /^\s*;/.test(l)).length;

  return {
    bytes: new Blob([text]).size,
    total: lines.length,
    nonEmpty,
    moves,
    comments,
  };
}

function statsToString(stats) {
  return `Lines: ${stats.nonEmpty} | Moves: ${stats.moves} | Comments: ${stats.comments} | Size: ${stats.bytes}B`;
}

function formatSeconds(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "-";
  }
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) {
    return `${h}h ${m}m ${s.toFixed(2)}s`;
  }
  if (m > 0) {
    return `${m}m ${s.toFixed(2)}s`;
  }
  return `${s.toFixed(3)}s`;
}

function arcLengthXY(x0, y0, x1, y1, i, j, clockwise) {
  const cx = x0 + i;
  const cy = y0 + j;
  const r0 = Math.hypot(x0 - cx, y0 - cy);
  const r1 = Math.hypot(x1 - cx, y1 - cy);
  const r = (r0 + r1) / 2;

  if (!Number.isFinite(r) || r <= 0) {
    return Math.hypot(x1 - x0, y1 - y0);
  }

  const a0 = Math.atan2(y0 - cy, x0 - cx);
  const a1 = Math.atan2(y1 - cy, x1 - cx);
  let delta = a1 - a0;

  if (clockwise) {
    if (delta >= 0) {
      delta -= 2 * Math.PI;
    }
  } else if (delta <= 0) {
    delta += 2 * Math.PI;
  }

  return Math.abs(delta) * r;
}

function estimateMachiningTimeSeconds(text) {
  const lines = parseGcode(text);
  let modeAbsolute = true;
  let currentFeed = 1000;
  const rapidFeed = 12000;
  const pos = { X: 0, Y: 0, Z: 0 };
  let totalMinutes = 0;

  for (const line of lines) {
    if (line.kind !== "command" || !line.command) {
      continue;
    }

    if (line.command === "G90") {
      modeAbsolute = true;
      continue;
    }
    if (line.command === "G91") {
      modeAbsolute = false;
      continue;
    }

    if (Number.isFinite(line.params.F) && line.params.F > 0) {
      currentFeed = line.params.F;
    }

    if (!/^G[0-3]$/.test(line.command)) {
      continue;
    }

    const startX = pos.X;
    const startY = pos.Y;
    const startZ = pos.Z;

    const targetX = Number.isFinite(line.params.X)
      ? (modeAbsolute ? line.params.X : pos.X + line.params.X)
      : pos.X;
    const targetY = Number.isFinite(line.params.Y)
      ? (modeAbsolute ? line.params.Y : pos.Y + line.params.Y)
      : pos.Y;
    const targetZ = Number.isFinite(line.params.Z)
      ? (modeAbsolute ? line.params.Z : pos.Z + line.params.Z)
      : pos.Z;

    let distanceMm = 0;
    if (line.command === "G2" || line.command === "G3") {
      const hasI = Number.isFinite(line.params.I);
      const hasJ = Number.isFinite(line.params.J);
      if (hasI && hasJ) {
        const arcXY = arcLengthXY(
          startX,
          startY,
          targetX,
          targetY,
          line.params.I,
          line.params.J,
          line.command === "G2",
        );
        const dz = targetZ - startZ;
        distanceMm = Math.hypot(arcXY, dz);
      } else {
        distanceMm = Math.hypot(targetX - startX, targetY - startY, targetZ - startZ);
      }
    } else {
      distanceMm = Math.hypot(targetX - startX, targetY - startY, targetZ - startZ);
    }

    const feed = line.command === "G0" ? rapidFeed : Math.max(currentFeed, 1);
    totalMinutes += distanceMm / feed;

    pos.X = targetX;
    pos.Y = targetY;
    pos.Z = targetZ;
  }

  return totalMinutes * 60;
}

function buildLcsMatrix(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

function diffTokens(a, b) {
  const aTokens = a.split(/(\s+)/);
  const bTokens = b.split(/(\s+)/);
  const dp = buildLcsMatrix(aTokens, bTokens);
  let i = aTokens.length;
  let j = bTokens.length;
  const outA = [];
  const outB = [];

  while (i > 0 && j > 0) {
    if (aTokens[i - 1] === bTokens[j - 1]) {
      const token = escapeHtml(aTokens[i - 1]);
      outA.push(token);
      outB.push(token);
      i -= 1;
      j -= 1;
      continue;
    }

    if (dp[i - 1][j] >= dp[i][j - 1]) {
      outA.push(`<span class="token-bold">${escapeHtml(aTokens[i - 1])}</span>`);
      i -= 1;
    } else {
      outB.push(`${escapeHtml(bTokens[j - 1])}`);
      j -= 1;
    }
  }

  while (i > 0) {
    outA.push(`<span class="token-bold">${escapeHtml(aTokens[i - 1])}</span>`);
    i -= 1;
  }
  while (j > 0) {
    outB.push(`${escapeHtml(bTokens[j - 1])}`);
    j -= 1;
  }

  return {
    aHtml: outA.reverse().join(""),
    bHtml: outB.reverse().join(""),
  };
}

function highlightGcodeHtml(line) {
  const source = String(line || "");
  const parts = source.split(/(\s+)/);
  const transformed = parts.map((part) => {
    if (!part || /^\s+$/.test(part)) {
      return escapeHtml(part);
    }
    if (part.startsWith(";")) {
      return `<span class="comment">${escapeHtml(part)}</span>`;
    }
    if (/^[GMT]\d+$/i.test(part)) {
      return `<span class="cmd">${escapeHtml(part)}</span>`;
    }
    const m = part.match(/^([XYZFIJRSPEA])([+\-]?\d*\.?\d+)$/i);
    if (m) {
      return `<span class="axis">${escapeHtml(m[1])}</span><span class="num">${escapeHtml(m[2])}</span>`;
    }
    return escapeHtml(part);
  });
  return transformed.join("");
}

function renderLineHtml(kind, lineNo, contentHtml, emphasize = false) {
  const safeContent = contentHtml && contentHtml.length > 0 ? contentHtml : "&nbsp;";
  const numberHtml = lineNo > 0 ? `N${lineNo}` : "&nbsp;";
  const emphasizeClass = emphasize ? "line-left-emphasis" : "";
  return `<span class="line ${kind} ${emphasizeClass}"><span class="line-no">${numberHtml}</span><span class="line-body">${safeContent}</span></span>`;
}

function attachReason(html, reasonText) {
  if (!reasonText) {
    return html;
  }
  const safeReason = escapeHtml(reasonText);
  return html.replace('class="line ', `data-reason="${safeReason}" class="line `);
}

function alignLines(sourceLines, optimizedLines) {
  if (sourceLines.length * optimizedLines.length > 400000) {
    const maxLen = Math.max(sourceLines.length, optimizedLines.length);
    const rows = [];
    for (let i = 0; i < maxLen; i += 1) {
      rows.push({
        type:
          sourceLines[i] === undefined
            ? "add"
            : optimizedLines[i] === undefined
              ? "del"
              : sourceLines[i] === optimizedLines[i]
                ? "same"
                : "chg",
        src: sourceLines[i],
        opt: optimizedLines[i],
      });
    }
    return rows;
  }

  const dp = buildLcsMatrix(sourceLines, optimizedLines);
  let i = sourceLines.length;
  let j = optimizedLines.length;
  const rows = [];

  while (i > 0 && j > 0) {
    if (sourceLines[i - 1] === optimizedLines[j - 1]) {
      rows.push({ type: "same", src: sourceLines[i - 1], opt: optimizedLines[j - 1] });
      i -= 1;
      j -= 1;
      continue;
    }
    if (dp[i - 1][j] >= dp[i][j - 1]) {
      rows.push({ type: "del", src: sourceLines[i - 1], opt: undefined });
      i -= 1;
    } else {
      rows.push({ type: "add", src: undefined, opt: optimizedLines[j - 1] });
      j -= 1;
    }
  }

  while (i > 0) {
    rows.push({ type: "del", src: sourceLines[i - 1], opt: undefined });
    i -= 1;
  }
  while (j > 0) {
    rows.push({ type: "add", src: undefined, opt: optimizedLines[j - 1] });
    j -= 1;
  }

  rows.reverse();
  const merged = [];
  for (let k = 0; k < rows.length; k += 1) {
    const curr = rows[k];
    const next = rows[k + 1];
    if (curr.type === "del" && next && next.type === "add") {
      merged.push({ type: "chg", src: curr.src, opt: next.opt });
      k += 1;
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

function renderDiff(source, optimized, removedEntries = []) {
  const sourceLines = source.replace(/\r\n/g, "\n").split("\n");
  const optimizedLines = optimized.replace(/\r\n/g, "\n").split("\n");
  const rows = alignLines(sourceLines, optimizedLines);
  const reasonByLine = new Map();
  for (const entry of removedEntries) {
    if (!entry || !Number.isFinite(entry.line)) {
      continue;
    }
    const reason = Array.isArray(entry.reasons) ? entry.reasons.join("; ") : "Removed by optimizer";
    reasonByLine.set(entry.line, reason);
  }

  const srcHtml = [];
  const optHtml = [];
  let changedCount = 0;
  let srcLineNo = 0;
  let optLineNo = 0;

  for (const row of rows) {
    if (row.type === "same") {
      srcLineNo += 1;
      optLineNo += 1;
      srcHtml.push(renderLineHtml("", srcLineNo, highlightGcodeHtml(row.src || "")));
      optHtml.push(renderLineHtml("", optLineNo, highlightGcodeHtml(row.opt || "")));
      continue;
    }

    changedCount += 1;
    if (row.type === "chg") {
      const tokenDiff = diffTokens(row.src || "", row.opt || "");
      srcLineNo += 1;
      optLineNo += 1;
      const leftHtml = renderLineHtml("changed", srcLineNo, tokenDiff.aHtml || " ", true);
      srcHtml.push(attachReason(leftHtml, reasonByLine.get(srcLineNo) || ""));
      optHtml.push(renderLineHtml("changed", optLineNo, tokenDiff.bHtml || " "));
      continue;
    }

    if (row.type === "del") {
      srcLineNo += 1;
      const leftHtml = renderLineHtml("removed", srcLineNo, `<span class="token-bold">${highlightGcodeHtml(row.src || "")}</span>`, true);
      srcHtml.push(attachReason(leftHtml, reasonByLine.get(srcLineNo) || ""));
      optHtml.push(renderLineHtml("", 0, ""));
      continue;
    }

    if (row.type === "add") {
      optLineNo += 1;
      srcHtml.push(renderLineHtml("", 0, ""));
      optHtml.push(renderLineHtml("added", optLineNo, `${highlightGcodeHtml(row.opt || "")}`));
    }
  }

  els.sourcePreview.innerHTML = srcHtml.join("\n");
  els.optimizedPreview.innerHTML = optHtml.join("\n");
  els.changesStats.textContent = `${changedCount} line changes`;
}

function optimizeGcode(source, options) {
  let lines = parseGcode(source);

  applyScales(lines, options);

  if (options.removeComments) {
    lines = removeCommentsAndBlank(lines);
  }

  if (options.removeDuplicateCoordinates) {
    lines = removeDuplicateCoordinates(lines);
  }

  if (options.removeRedundantMoves) {
    lines = removeRedundantMoves(lines);
  }

  if (options.optimizeRapidTraverse) {
    lines = optimizeRapidBlocks(lines);
  }

  if (options.smoothRapidTraverses) {
    lines = smoothRapidTraverses(lines);
  }

  if (options.normalizeFeedRates) {
    lines = normalizeFeedRates(lines);
  }

  lines = removeDuplicateModalCommands(lines);

  return lines.map(lineToString).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function readOptions() {
  return {
    feedScale: Number(els.feedScale.value) / 100,
    spindleScale: Number(els.spindleScale.value) / 100,
    removeRedundantMoves: els.removeRedundantMoves.checked,
    optimizeRapidTraverse: els.optimizeRapidTraverse.checked,
    smoothRapidTraverses: els.smoothRapidTraverses.checked,
    removeComments: els.removeComments.checked,
    normalizeFeedRates: els.normalizeFeedRates.checked,
    removeDuplicateCoordinates: els.removeDuplicateCoordinates.checked,
    optimizationMode: els.optimizationMode.value,
    machineRateEURPerHour: Number(els.machineRate.value),
    jobsPerDay: Number(els.jobsPerDay.value),
    workDaysPerMonth: Number(els.workDaysPerMonth.value),
  };
}

function renderOptimizationMetricList(metrics) {
  if (!els.optimizationMetricList) {
    return;
  }
  const rows = [
    ["Duplicate moves removed", metrics?.duplicateMovesRemoved],
    ["Redundant Z removed", metrics?.redundantZRemoved],
    ["Duplicate coordinates removed", metrics?.duplicateCoordinatesRemoved],
    ["Redundant rapids removed", metrics?.redundantRapidsRemoved],
    ["Air cutting removed", metrics?.airCutsRemoved],
    ["Rapids merged", metrics?.rapidsMerged],
    ["Comments/blanks removed", metrics?.commentsRemoved],
  ];

  els.optimizationMetricList.innerHTML = rows
    .map(([label, value]) => `<div class="metric-item"><b>${escapeHtml(label)}</b><span>${Number.isFinite(value) ? value : 0}</span></div>`)
    .join("");
}

async function requestOptimizeFromServer(source, options) {
  const response = await fetch("/api/optimize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      gcodeText: source,
      options,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `API error (${response.status})`);
  }
  return payload;
}

async function render() {
  const currentSequence = ++renderSequence;
  const source = els.sourceCode.value;
  if (!source.trim()) {
    els.optimizedCode.value = "";
    els.originalStats.textContent = "-";
    els.optimizedStats.textContent = "-";
    els.reductionStats.textContent = "-";
    els.changesStats.textContent = "-";
    els.originalTimeStats.textContent = "-";
    els.optimizedTimeStats.textContent = "-";
    els.timeSavedStats.textContent = "-";
    els.rapidBreakdownStats.textContent = "-";
    els.cuttingBreakdownStats.textContent = "-";
    els.overheadBreakdownStats.textContent = "-";
    els.moneySavedStats.textContent = "-";
    els.moneyDailyStats.textContent = "-";
    els.moneyMonthlyStats.textContent = "-";
    els.moneyYearlyStats.textContent = "-";
    els.roiStats.textContent = "-";
    if (els.optimizationMetricList) {
      els.optimizationMetricList.innerHTML = "";
    }
    renderWarnings([]);
    setEngineStatus("api");
    els.sourcePreview.textContent = "";
    els.optimizedPreview.textContent = "";
    els.downloadBtn.disabled = true;
    return;
  }

  const options = readOptions();
  try {
    let optimized = "";
    let originalSeconds;
    let optimizedSeconds;
    let backendStats = null;
    let removedEntries = [];
    let warnings = [];

    try {
      const apiPayload = await requestOptimizeFromServer(source, options);
      if (typeof apiPayload.optimized === "string") {
        optimized = apiPayload.optimized;
      }
      if (apiPayload.stats && typeof apiPayload.stats === "object") {
        backendStats = apiPayload.stats;
        if (Number.isFinite(apiPayload.stats.originalCycleTimeSeconds)) {
          originalSeconds = apiPayload.stats.originalCycleTimeSeconds;
        }
        if (Number.isFinite(apiPayload.stats.optimizedCycleTimeSeconds)) {
          optimizedSeconds = apiPayload.stats.optimizedCycleTimeSeconds;
        }
      }
      if (Array.isArray(apiPayload.removedEntries)) {
        removedEntries = apiPayload.removedEntries;
      }
      if (Array.isArray(apiPayload.warnings)) {
        warnings = apiPayload.warnings;
      }
      setEngineStatus("api");
    } catch (serverError) {
      console.warn("Server optimize unavailable, using local fallback.", serverError);
      optimized = optimizeGcode(source, options);
      setEngineStatus("fallback", "local");
      warnings = [];
    }

    if (currentSequence !== renderSequence) {
      return;
    }

    const fallback = source.trim();
    const safeOutput = optimized || fallback;
    els.optimizedCode.value = safeOutput;

    const a = computeStats(source);
    const b = computeStats(safeOutput);
    const savings = a.bytes > 0 ? (((a.bytes - b.bytes) / a.bytes) * 100) : 0;
    if (!Number.isFinite(originalSeconds)) {
      originalSeconds = estimateMachiningTimeSeconds(source);
    }
    if (!Number.isFinite(optimizedSeconds)) {
      optimizedSeconds = estimateMachiningTimeSeconds(safeOutput);
    }
    const timeSavedSeconds = originalSeconds - optimizedSeconds;
    const savedPercent = originalSeconds > 0 ? (timeSavedSeconds / originalSeconds) * 100 : 0;
    lastRemovedEntries = removedEntries;
    lastStats = backendStats;

    els.originalStats.textContent = statsToString(a);
    els.optimizedStats.textContent = statsToString(b);
    els.reductionStats.textContent = `${savings.toFixed(2)}% manja datoteka (${a.bytes - b.bytes}B)`;
    els.originalTimeStats.textContent = formatSeconds(originalSeconds);
    els.optimizedTimeStats.textContent = formatSeconds(optimizedSeconds);
    if (Math.abs(timeSavedSeconds) < 0.001) {
      els.timeSavedStats.textContent = "~0.000s (0.00%)";
    } else if (timeSavedSeconds >= 0) {
      els.timeSavedStats.textContent = `${formatSeconds(timeSavedSeconds)} manje (${savedPercent.toFixed(2)}%)`;
    } else {
      els.timeSavedStats.textContent = `${formatSeconds(Math.abs(timeSavedSeconds))} vise (${Math.abs(savedPercent).toFixed(2)}%)`;
    }
    if (backendStats) {
      els.rapidBreakdownStats.textContent = `${formatSeconds(backendStats.originalRapidSeconds || 0)} / ${formatSeconds(backendStats.optimizedRapidSeconds || 0)}`;
      els.cuttingBreakdownStats.textContent = `${formatSeconds(backendStats.originalCuttingSeconds || 0)} / ${formatSeconds(backendStats.optimizedCuttingSeconds || 0)}`;
      els.overheadBreakdownStats.textContent = `${formatSeconds(backendStats.originalOverheadSeconds || 0)} / ${formatSeconds(backendStats.optimizedOverheadSeconds || 0)}`;
      els.moneySavedStats.textContent = formatCurrency(backendStats.moneySavedEUR);
      els.moneyDailyStats.textContent = formatCurrency(backendStats.moneySavedDailyEUR);
      els.moneyMonthlyStats.textContent = formatCurrency(backendStats.moneySavedMonthlyEUR);
      els.moneyYearlyStats.textContent = formatCurrency(backendStats.moneySavedYearlyEUR);
      els.roiStats.textContent = backendStats.roiDays === null ? "-" : `${backendStats.roiDays} d`;
      renderOptimizationMetricList(backendStats.optimizationMetrics);
      renderWarnings(warnings);
    } else {
      els.rapidBreakdownStats.textContent = "-";
      els.cuttingBreakdownStats.textContent = "-";
      els.overheadBreakdownStats.textContent = "-";
      els.moneySavedStats.textContent = "-";
      els.moneyDailyStats.textContent = "-";
      els.moneyMonthlyStats.textContent = "-";
      els.moneyYearlyStats.textContent = "-";
      els.roiStats.textContent = "-";
      renderOptimizationMetricList(null);
      renderWarnings(warnings);
    }
    renderDiff(source, safeOutput, removedEntries);
    els.downloadBtn.disabled = !safeOutput;
  } catch (error) {
    console.error("Optimize error:", error);
    els.optimizedCode.value = source;
    els.originalStats.textContent = "Greška u optimizaciji";
    els.optimizedStats.textContent = "Prikazan je originalni kod";
    els.reductionStats.textContent = "0.00% (fallback)";
    els.changesStats.textContent = "-";
    els.originalTimeStats.textContent = "-";
    els.optimizedTimeStats.textContent = "-";
    els.timeSavedStats.textContent = "-";
    els.rapidBreakdownStats.textContent = "-";
    els.cuttingBreakdownStats.textContent = "-";
    els.overheadBreakdownStats.textContent = "-";
    els.moneySavedStats.textContent = "-";
    els.moneyDailyStats.textContent = "-";
    els.moneyMonthlyStats.textContent = "-";
    els.moneyYearlyStats.textContent = "-";
    els.roiStats.textContent = "-";
    renderOptimizationMetricList(null);
    renderWarnings([]);
    setEngineStatus("fallback", "error");
    els.sourcePreview.textContent = source;
    els.optimizedPreview.textContent = source;
    els.downloadBtn.disabled = false;
  }
}

function handleFile(file) {
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    els.sourceCode.value = String(reader.result || "");
    els.dropzone.classList.add("loaded");
    els.dropzone.querySelector("strong").textContent = `Loaded: ${file.name}`;
    render();
  };
  reader.readAsText(file);
}

function downloadOptimized() {
  const content = els.optimizedCode.value;
  if (!content) {
    return;
  }
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "optimized.gcode";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function copyOptimizedToClipboard() {
  const content = els.optimizedCode.value;
  if (!content) {
    return;
  }
  await navigator.clipboard.writeText(content);
}

function exportComparisonCsv() {
  const source = els.sourceCode.value || "";
  const optimized = els.optimizedCode.value || "";
  const sourceLines = source.replace(/\r\n/g, "\n").split("\n");
  const optimizedLines = optimized.replace(/\r\n/g, "\n").split("\n");
  const max = Math.max(sourceLines.length, optimizedLines.length);
  const rows = ["line,original,optimized"];
  for (let i = 0; i < max; i += 1) {
    const o = (sourceLines[i] || "").replaceAll('"', '""');
    const n = (optimizedLines[i] || "").replaceAll('"', '""');
    rows.push(`${i + 1},"${o}","${n}"`);
  }
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "comparison.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportReport() {
  const lines = [
    "CAMOutput Optimization Report",
    `Generated: ${new Date().toISOString()}`,
    `Original: ${els.originalStats.textContent}`,
    `Optimized: ${els.optimizedStats.textContent}`,
    `Reduction: ${els.reductionStats.textContent}`,
    `Time Saved: ${els.timeSavedStats.textContent}`,
    `Money/Job: ${els.moneySavedStats.textContent}`,
    `Daily: ${els.moneyDailyStats.textContent}`,
    `Monthly: ${els.moneyMonthlyStats.textContent}`,
    `Yearly: ${els.moneyYearlyStats.textContent}`,
    `ROI: ${els.roiStats.textContent}`,
    "",
    "Removed line reasons:",
    ...(Array.isArray(lastRemovedEntries)
      ? lastRemovedEntries.map((entry) => `L${entry.line}: ${(entry.reasons || []).join("; ") || "Removed"}`)
      : []),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "optimization-report.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function init() {
  if (!hasRequiredElements()) {
    console.error("UI init error: nedostaju DOM elementi za optimizer.");
    return;
  }

  els.fileInput.addEventListener("change", (e) => {
    const [file] = e.target.files;
    handleFile(file);
  });

  els.dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    els.dropzone.classList.add("dragover");
  });

  els.dropzone.addEventListener("dragleave", () => {
    els.dropzone.classList.remove("dragover");
  });

  els.dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    els.dropzone.classList.remove("dragover");
    const [file] = e.dataTransfer.files;
    handleFile(file);
  });

  els.pasteDemoBtn.addEventListener("click", () => {
    els.sourceCode.value = DEMO_CODE;
    els.dropzone.classList.add("loaded");
    els.dropzone.querySelector("strong").textContent = "Loaded: demo.gcode";
    render();
  });

  els.optimizeBtn.addEventListener("click", render);
  els.downloadBtn.addEventListener("click", downloadOptimized);
  els.copyBtn.addEventListener("click", async () => {
    await copyOptimizedToClipboard();
  });
  els.csvBtn.addEventListener("click", exportComparisonCsv);
  els.reportBtn.addEventListener("click", exportReport);

  for (const control of [
    els.removeRedundantMoves,
    els.optimizeRapidTraverse,
    els.smoothRapidTraverses,
    els.removeComments,
    els.normalizeFeedRates,
    els.removeDuplicateCoordinates,
    els.optimizationMode,
    els.machineRate,
    els.jobsPerDay,
    els.workDaysPerMonth,
  ]) {
    control.addEventListener("change", render);
  }

  els.feedScale.addEventListener("input", () => {
    els.feedScaleOut.textContent = formatPercent(Number(els.feedScale.value));
    render();
  });

  els.spindleScale.addEventListener("input", () => {
    els.spindleScaleOut.textContent = formatPercent(Number(els.spindleScale.value));
    render();
  });

  els.feedScaleOut.textContent = formatPercent(Number(els.feedScale.value));
  els.spindleScaleOut.textContent = formatPercent(Number(els.spindleScale.value));
  els.sourceCode.value = DEMO_CODE;
  render();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
