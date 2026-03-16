const fs = require('fs/promises');
const ToolpathLib = require('gcode-toolpath');

const GCodeToolpath = ToolpathLib.GCodeToolpath || ToolpathLib;

const RAPID_FEED_MM_PER_MIN = 15000;
const DEFAULT_FEED_MM_PER_MIN = 1000;
const SAFE_RAPID_Z_MM = 5;
const MACHINE_RATE_EUR_PER_HOUR = 80;

class CycleTimeCalculator {
  constructor(gcodeText, options = {}) {
    if (typeof gcodeText !== 'string') {
      throw new TypeError('Invalid input: G-code must be a string.');
    }

    this.gcodeText = gcodeText;
    this.options = {
      rapidFeedMmPerMin: Number.isFinite(options.rapidFeedMmPerMin) ? options.rapidFeedMmPerMin : RAPID_FEED_MM_PER_MIN,
      defaultFeedMmPerMin: Number.isFinite(options.defaultFeedMmPerMin) ? options.defaultFeedMmPerMin : DEFAULT_FEED_MM_PER_MIN,
      toolChangeSeconds: Number.isFinite(options.toolChangeSeconds) ? options.toolChangeSeconds : 8,
      spindleSeconds: Number.isFinite(options.spindleSeconds) ? options.spindleSeconds : 2,
      msgSeconds: Number.isFinite(options.msgSeconds) ? options.msgSeconds : 0.5,
      groupSeconds: Number.isFinite(options.groupSeconds) ? options.groupSeconds : 0.1,
      accelFactor: Number.isFinite(options.accelFactor) ? options.accelFactor : 0.12,
      maxAccelSeconds: Number.isFinite(options.maxAccelSeconds) ? options.maxAccelSeconds : 0.12,
      debug: Boolean(options.debug),
    };
    this.breakdown = {
      rapid: 0,
      feed: 0,
      overhead: 0,
    };
  }

  calculate() {
    this.breakdown = { rapid: 0, feed: 0, overhead: 0 };

    const state = {
      absolute: true,
      x: 0,
      y: 0,
      z: 0,
      feed: this.options.defaultFeedMmPerMin,
      modalMotion: null,
    };

    const lines = this.gcodeText.replace(/\r\n/g, '\n').split('\n');

    for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
      const raw = lines[lineNo] || '';
      const upperRaw = raw.toUpperCase();
      const parsed = this.#parseLine(raw);

      this.#applyOverhead(upperRaw, parsed.params);

      if (parsed.hasG90) {
        state.absolute = true;
      }
      if (parsed.hasG91) {
        state.absolute = false;
      }

      if (Number.isFinite(parsed.params.F) && parsed.params.F > 0) {
        state.feed = parsed.params.F;
      }

      const motion = parsed.motion || state.modalMotion;
      if (!motion) {
        continue;
      }
      state.modalMotion = motion;

      if (!this.#isMotion(motion)) {
        continue;
      }

      const target = this.#targetPosition(state, parsed.params);
      const distance = this.#distanceForMotion(state, target, parsed.params, motion);
      if (!(distance > 0)) {
        state.x = target.x;
        state.y = target.y;
        state.z = target.z;
        continue;
      }

      const feed = motion === 'G0' ? this.options.rapidFeedMmPerMin : Math.max(state.feed, 1);
      let moveSeconds = (distance / feed) * 60;
      moveSeconds += Math.min(this.options.maxAccelSeconds, moveSeconds * this.options.accelFactor);

      if (motion === 'G0') {
        this.breakdown.rapid += moveSeconds;
      } else {
        this.breakdown.feed += moveSeconds;
      }

      state.x = target.x;
      state.y = target.y;
      state.z = target.z;

      if (this.options.debug) {
        console.log(`[CycleCalc] L${lineNo + 1} ${motion} dist=${distance.toFixed(3)} feed=${feed.toFixed(2)} t=${moveSeconds.toFixed(4)}s`);
      }
    }

    return this.breakdown.rapid + this.breakdown.feed + this.breakdown.overhead;
  }

  getBreakdown() {
    return {
      rapid: this.breakdown.rapid,
      feed: this.breakdown.feed,
      overhead: this.breakdown.overhead,
    };
  }

  formatTime(seconds) {
    const total = Math.max(Number(seconds) || 0, 0);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) {
      return `${h}h ${m}m ${s.toFixed(2)}s`;
    }
    if (m > 0) {
      return `${m}m ${s.toFixed(2)}s`;
    }
    return `${s.toFixed(3)}s`;
  }

  #parseLine(raw) {
    const noComment = String(raw || '').split(';', 1)[0].trim();
    const upper = noComment.toUpperCase();
    const params = {};
    const pRegex = /([A-Z])\s*([+\-]?\d*\.?\d+)/g;
    let m;
    while ((m = pRegex.exec(upper)) !== null) {
      params[m[1]] = Number(m[2]);
    }

    let motion = null;
    const g = upper.match(/\bG\s*0*([0-3])\b/);
    if (g) {
      motion = `G${Number(g[1])}`;
    }

    return {
      motion,
      params,
      hasG90: /\bG\s*90\b/.test(upper),
      hasG91: /\bG\s*91\b/.test(upper),
    };
  }

  #applyOverhead(upperRaw, params) {
    if (/\bT\s*\d+\b/.test(upperRaw)) {
      this.breakdown.overhead += this.options.toolChangeSeconds;
    }

    if (/\bM\s*0?[345]\b/.test(upperRaw)) {
      this.breakdown.overhead += this.options.spindleSeconds;
    }

    if (/\bG\s*0?4\b/.test(upperRaw)) {
      const dwell = Number(params.P);
      if (Number.isFinite(dwell) && dwell > 0) {
        this.breakdown.overhead += dwell;
      }
    }

    if (/\bMSG\s*\(/.test(upperRaw)) {
      this.breakdown.overhead += this.options.msgSeconds;
    }

    if (/\bGROUP_(BEGIN|END)\b/.test(upperRaw)) {
      this.breakdown.overhead += this.options.groupSeconds;
    }

    const cycle = upperRaw.match(/\bCYCLE\s*([0-9]{2,3})\b/);
    if (cycle) {
      const z = Number(params.Z);
      const f = Number(params.F);
      const depth = Number.isFinite(z) ? Math.abs(z) : 5;
      const feed = Number.isFinite(f) && f > 0 ? f : this.options.defaultFeedMmPerMin;
      const cycleTravel = (depth * 2) / feed * 60;
      this.breakdown.overhead += cycleTravel + 0.8;
    }
  }

  #isMotion(motion) {
    return motion === 'G0' || motion === 'G1' || motion === 'G2' || motion === 'G3';
  }

  #targetPosition(state, params) {
    const abs = state.absolute !== false;
    return {
      x: Number.isFinite(params.X) ? (abs ? params.X : state.x + params.X) : state.x,
      y: Number.isFinite(params.Y) ? (abs ? params.Y : state.y + params.Y) : state.y,
      z: Number.isFinite(params.Z) ? (abs ? params.Z : state.z + params.Z) : state.z,
    };
  }

  #distanceForMotion(state, target, params, motion) {
    if (motion !== 'G2' && motion !== 'G3') {
      return Math.hypot(target.x - state.x, target.y - state.y, target.z - state.z);
    }

    const hasI = Number.isFinite(params.I);
    const hasJ = Number.isFinite(params.J);
    if (hasI && hasJ) {
      const cx = state.x + params.I;
      const cy = state.y + params.J;
      const r0 = Math.hypot(state.x - cx, state.y - cy);
      const r1 = Math.hypot(target.x - cx, target.y - cy);
      const r = (r0 + r1) / 2;
      if (!(r > 0)) {
        return Math.hypot(target.x - state.x, target.y - state.y, target.z - state.z);
      }
      const a0 = Math.atan2(state.y - cy, state.x - cx);
      const a1 = Math.atan2(target.y - cy, target.x - cx);
      let delta = a1 - a0;
      const cw = motion === 'G2';
      if (cw) {
        if (delta >= 0) delta -= 2 * Math.PI;
      } else if (delta <= 0) {
        delta += 2 * Math.PI;
      }
      const arc = Math.abs(delta) * r;
      const dz = target.z - state.z;
      return Math.hypot(arc, dz);
    }

    const hasR = Number.isFinite(params.R);
    if (hasR && params.R !== 0) {
      const chord = Math.hypot(target.x - state.x, target.y - state.y);
      const r = Math.abs(params.R);
      if (chord > 0 && r >= chord / 2) {
        const angle = 2 * Math.asin(Math.min(1, chord / (2 * r)));
        const arc = angle * r;
        const dz = target.z - state.z;
        return Math.hypot(arc, dz);
      }
    }

    return Math.hypot(target.x - state.x, target.y - state.y, target.z - state.z);
  }
}

class GcodeOptimizer {
  constructor(gcodeText) {
    if (typeof gcodeText !== 'string') {
      throw new TypeError('Invalid input: G-code must be a string.');
    }

    this.originalGcode = gcodeText;
    this.optimizedGcode = gcodeText;
    this.removedEntries = [];
    this.optimizedLineMeta = [];
    this.optimizationDone = false;
    this.lastError = null;
    this.removalReasons = new Map();
    this.metrics = {
      duplicateMovesRemoved: 0,
      redundantZRemoved: 0,
      duplicateCoordinatesRemoved: 0,
      redundantRapidsRemoved: 0,
      airCutsRemoved: 0,
      rapidsMerged: 0,
      commentsRemoved: 0,
    };
    this.machineRateEURPerHour = MACHINE_RATE_EUR_PER_HOUR;
    this.jobsPerDay = 5;
    this.workDaysPerMonth = 22;
    this.optimizationMode = 'conservative';
  }

  async optimize(options = {}) {
    this.#ensureNonEmpty(this.originalGcode);

    try {
      const cfg = this.#normalizeOptions(options);
      this.optimizationMode = cfg.optimizationMode;
      this.machineRateEURPerHour = cfg.machineRateEURPerHour;
      this.jobsPerDay = cfg.jobsPerDay;
      this.workDaysPerMonth = cfg.workDaysPerMonth;
      this.removalReasons = new Map();
      this.metrics = {
        duplicateMovesRemoved: 0,
        redundantZRemoved: 0,
        duplicateCoordinatesRemoved: 0,
        redundantRapidsRemoved: 0,
        airCutsRemoved: 0,
        rapidsMerged: 0,
        commentsRemoved: 0,
      };
      await this.#validateWithToolpath(this.originalGcode);

      const before = this.#parseRows(this.originalGcode);
      let rows = before.slice();

      rows = this.#applyPass(rows, this.#removeConsecutiveDuplicates.bind(this), 'duplicateMovesRemoved', 'Duplicate consecutive move removed');
      rows = this.#applyPass(rows, this.#removeRedundantZRetracts.bind(this), 'redundantZRemoved', 'Redundant Z retract removed');

      if (cfg.removeDuplicateCoordinates) {
        rows = this.#applyPass(rows, this.#removeDuplicateCoordinates.bind(this), 'duplicateCoordinatesRemoved', 'Duplicate coordinate removed');
      }

      if (cfg.removeRedundantMoves) {
        rows = this.#applyPass(rows, this.#removeRedundantRapidMoves.bind(this), 'redundantRapidsRemoved', 'Redundant rapid move removed');
        if (cfg.optimizationMode === 'aggressive') {
          rows = this.#applyPass(rows, this.#removeAirCutting.bind(this), 'airCutsRemoved', 'Air cutting move removed (Z >= 0)');
        }
      }

      if (cfg.optimizeRapidTraverse && cfg.optimizationMode === 'aggressive') {
        rows = this.#applyPass(rows, this.#mergeConsecutiveRapids.bind(this), 'rapidsMerged', 'Consecutive rapid moves merged');
        rows = this.#reorderRapidTriplets(rows);
      }

      if (cfg.normalizeFeedRates) {
        rows = this.#normalizeFeedRates(rows);
      }

      rows = this.#scaleFeedAndSpindle(rows, cfg.feedScale, cfg.spindleScale);

      if (cfg.removeComments) {
        rows = this.#applyPass(rows, this.#removeCommentsAndBlankRows.bind(this), 'commentsRemoved', 'Comment/blank line removed');
      }

      this.optimizedLineMeta = rows;
      this.optimizedGcode = rows.map((r) => this.#stringifyRow(r)).join('\n');
      this.removedEntries = this.#collectRemovedEntries(before, rows);
      console.log('[GcodeOptimizer] Optimization metrics:', this.metrics);

      await this.#validateWithToolpath(this.optimizedGcode);
      this.optimizationDone = true;
      this.lastError = null;
      return this;
    } catch (error) {
      this.lastError = error;
      throw this.#friendlyError(error);
    }
  }

  getOptimized() {
    return this.optimizedGcode;
  }

  getOriginal() {
    return this.originalGcode;
  }

  calculateCycleTime(gcodeText) {
    if (typeof gcodeText !== 'string') {
      throw new TypeError('Invalid input: G-code must be a string.');
    }
    this.#ensureNonEmpty(gcodeText);

    const calc = new CycleTimeCalculator(gcodeText);
    return calc.calculate();
  }

  calculateCycleTimeDetailed(gcodeText) {
    if (typeof gcodeText !== 'string') {
      throw new TypeError('Invalid input: G-code must be a string.');
    }
    this.#ensureNonEmpty(gcodeText);

    const calc = new CycleTimeCalculator(gcodeText);
    const totalSeconds = calc.calculate();
    const breakdown = calc.getBreakdown();
    return {
      totalSeconds,
      rapidSeconds: breakdown.rapid,
      cuttingSeconds: breakdown.feed,
      overheadSeconds: breakdown.overhead,
    };
  }

  validateSafety() {
    const warnings = [];
    const originalRows = this.#parseRows(this.originalGcode);
    const kept = new Set(this.optimizedLineMeta.map((r) => r.index));

    for (let i = 0; i < originalRows.length; i += 1) {
      const row = originalRows[i];
      if (!row.command || kept.has(row.index)) {
        continue;
      }

      const isRetract = this.#isZOnlyMove(row) && Number.isFinite(row.params.Z) && row.params.Z > SAFE_RAPID_Z_MM;
      if (!isRetract) {
        continue;
      }

      const nextKept = originalRows.slice(i + 1).find((r) => kept.has(r.index));
      if (!nextKept || !this.#isRapidCommand(nextKept.command)) {
        continue;
      }

      const hasXY = Number.isFinite(nextKept.params.X) || Number.isFinite(nextKept.params.Y);
      if (hasXY) {
        warnings.push({
          type: 'critical',
          line: row.line,
          message: `Removed Z retract to ${row.params.Z}mm before rapid XY move.`,
        });
      }
    }

    return warnings;
  }

  getStatistics() {
    const originalLines = this.#countNonEmptyLines(this.originalGcode);
    const optimizedLines = this.#countNonEmptyLines(this.optimizedGcode);
    const linesRemoved = Math.max(originalLines - optimizedLines, 0);

    const originalTiming = this.calculateCycleTimeDetailed(this.originalGcode);
    const optimizedTiming = this.calculateCycleTimeDetailed(this.optimizedGcode);
    const originalSeconds = originalTiming.totalSeconds;
    const optimizedSeconds = optimizedTiming.totalSeconds;
    const savedSeconds = originalSeconds - optimizedSeconds;
    const savedPercent = originalSeconds > 0 ? (savedSeconds / originalSeconds) * 100 : 0;
    const moneySavedPerJob = (savedSeconds / 3600) * this.machineRateEURPerHour;
    const moneySavedDaily = moneySavedPerJob * this.jobsPerDay;
    const moneySavedMonthly = moneySavedDaily * this.workDaysPerMonth;
    const moneySavedYearly = moneySavedMonthly * 12;
    const assumedMonthlyToolCost = 49;
    const roiDays = moneySavedDaily > 0 ? assumedMonthlyToolCost / moneySavedDaily : null;

    return {
      optimizationMode: this.optimizationMode,
      originalLineCount: originalLines,
      optimizedLineCount: optimizedLines,
      linesRemoved,
      originalCycleTime: this.#formatDuration(originalSeconds),
      optimizedCycleTime: this.#formatDuration(optimizedSeconds),
      originalCycleTimeSeconds: Number(originalSeconds.toFixed(3)),
      optimizedCycleTimeSeconds: Number(optimizedSeconds.toFixed(3)),
      originalRapidSeconds: Number(originalTiming.rapidSeconds.toFixed(3)),
      originalCuttingSeconds: Number(originalTiming.cuttingSeconds.toFixed(3)),
      originalOverheadSeconds: Number((originalTiming.overheadSeconds || 0).toFixed(3)),
      optimizedRapidSeconds: Number(optimizedTiming.rapidSeconds.toFixed(3)),
      optimizedCuttingSeconds: Number(optimizedTiming.cuttingSeconds.toFixed(3)),
      optimizedOverheadSeconds: Number((optimizedTiming.overheadSeconds || 0).toFixed(3)),
      timeSavedSeconds: Number(savedSeconds.toFixed(3)),
      timeSavedPercent: Number(savedPercent.toFixed(2)),
      moneySavedEUR: Number(moneySavedPerJob.toFixed(2)),
      moneySavedDailyEUR: Number(moneySavedDaily.toFixed(2)),
      moneySavedMonthlyEUR: Number(moneySavedMonthly.toFixed(2)),
      moneySavedYearlyEUR: Number(moneySavedYearly.toFixed(2)),
      roiDays: roiDays === null ? null : Number(roiDays.toFixed(2)),
      machineRateEURPerHour: this.machineRateEURPerHour,
      optimizationMetrics: { ...this.metrics },
    };
  }

  getRemovedEntries() {
    return this.removedEntries;
  }

  async exportToFile(filename) {
    if (typeof filename !== 'string' || filename.trim() === '') {
      throw new TypeError('Invalid filename: expected a non-empty string.');
    }

    const output = this.getOptimized();
    await fs.writeFile(filename, output, 'utf8');
    return { filename, bytes: Buffer.byteLength(output, 'utf8') };
  }

  #parseRows(text) {
    return text.replace(/\r\n/g, '\n').split('\n').map((raw, index) => this.#parseLine(raw, index));
  }

  #parseLine(raw, index) {
    const lineText = String(raw || '');
    const trimmed = lineText.trim();

    if (!trimmed) {
      return { index, line: index + 1, raw: '', command: null, params: {}, paramOrder: [], comment: '' };
    }

    if (trimmed.startsWith(';')) {
      return { index, line: index + 1, raw: trimmed, command: null, params: {}, paramOrder: [], comment: trimmed.slice(1).trim() };
    }

    const semicolon = lineText.indexOf(';');
    const codePart = (semicolon >= 0 ? lineText.slice(0, semicolon) : lineText).trim();
    const comment = semicolon >= 0 ? lineText.slice(semicolon + 1).trim() : '';

    const tokens = codePart.split(/\s+/).filter(Boolean);
    let command = null;
    const params = {};
    const paramOrder = [];

    for (const token of tokens) {
      const cmdMatch = token.match(/^([GMTgmt])(\d+)$/);
      if (cmdMatch && command === null) {
        command = `${cmdMatch[1].toUpperCase()}${Number.parseInt(cmdMatch[2], 10)}`;
        continue;
      }

      const pMatch = token.match(/^([A-Za-z])([+\-]?\d*\.?\d+)$/);
      if (!pMatch) {
        continue;
      }
      const key = pMatch[1].toUpperCase();
      const value = Number(pMatch[2]);
      if (!Number.isFinite(value)) {
        continue;
      }
      params[key] = value;
      if (!paramOrder.includes(key)) {
        paramOrder.push(key);
      }
    }

    return {
      index,
      line: index + 1,
      raw: trimmed,
      command,
      params,
      paramOrder,
      comment,
    };
  }

  #stringifyRow(row) {
    if (!row.command) {
      const rawTrimmed = String(row.raw || '').trim();
      if (rawTrimmed && !rawTrimmed.startsWith(';')) {
        return rawTrimmed;
      }
      if (row.comment) {
        return `; ${row.comment}`.trim();
      }
      return rawTrimmed;
    }

    const order = Array.isArray(row.paramOrder) ? row.paramOrder : Object.keys(row.params || {});
    const parts = [row.command];
    for (const key of order) {
      if (!Object.prototype.hasOwnProperty.call(row.params, key)) {
        continue;
      }
      const value = row.params[key];
      if (!Number.isFinite(value)) {
        continue;
      }
      const v = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6))).replace(/\.0+$/, '');
      parts.push(`${key}${v}`);
    }

    let out = parts.join(' ');
    if (row.comment) {
      out += ` ; ${row.comment}`;
    }
    return out.trim();
  }

  #removeConsecutiveDuplicates(rows) {
    const out = [];
    let previousSig = null;

    for (const row of rows) {
      if (!row.command) {
        out.push(row);
        previousSig = null;
        continue;
      }
      const sig = `${row.command}|${this.#paramsSignature(row.params)}|${row.comment || ''}`;
      if (sig === previousSig) {
        continue;
      }
      out.push(row);
      previousSig = sig;
    }

    return out;
  }

  #removeRedundantZRetracts(rows) {
    const out = [];
    const state = { absolute: true, x: 0, y: 0, z: 0 };

    for (const row of rows) {
      if (!row.command) {
        out.push(row);
        continue;
      }
      if (row.command === 'G90') {
        state.absolute = true;
        out.push(row);
        continue;
      }
      if (row.command === 'G91') {
        state.absolute = false;
        out.push(row);
        continue;
      }
      if (!this.#isLinearMotion(row.command)) {
        out.push(row);
        continue;
      }

      const target = this.#targetPosition(state, row.params);
      const duplicate = this.#isZOnlyMove(row) && target.z === state.z;
      if (!duplicate) {
        out.push(row);
      }
      Object.assign(state, target);
    }

    return out;
  }

  #removeDuplicateCoordinates(rows) {
    const out = [];
    const state = { absolute: true, x: 0, y: 0, z: 0 };

    for (const row of rows) {
      if (!row.command) {
        out.push(row);
        continue;
      }
      if (row.command === 'G90') {
        state.absolute = true;
        out.push(row);
        continue;
      }
      if (row.command === 'G91') {
        state.absolute = false;
        out.push(row);
        continue;
      }
      if (!this.#isMotionCommand(row.command)) {
        out.push(row);
        continue;
      }

      const clone = { ...row, params: { ...row.params }, paramOrder: [...(row.paramOrder || [])] };
      const target = this.#targetPosition(state, clone.params);

      for (const axis of ['X', 'Y', 'Z']) {
        if (!Number.isFinite(clone.params[axis])) {
          continue;
        }
        const prev = axis === 'X' ? state.x : axis === 'Y' ? state.y : state.z;
        const next = axis === 'X' ? target.x : axis === 'Y' ? target.y : target.z;
        if (next === prev) {
          delete clone.params[axis];
          clone.paramOrder = clone.paramOrder.filter((k) => k !== axis);
        }
      }

      const hasXYZ = ['X', 'Y', 'Z'].some((k) => Object.prototype.hasOwnProperty.call(clone.params, k));
      if (hasXYZ || !this.#isLinearMotion(clone.command)) {
        out.push(clone);
      }

      Object.assign(state, target);
    }

    return out;
  }

  #removeRedundantRapidMoves(rows) {
    const out = [];
    const state = { absolute: true, x: 0, y: 0, z: 0 };

    for (const row of rows) {
      if (!row.command) {
        out.push(row);
        continue;
      }
      if (row.command === 'G90') {
        state.absolute = true;
        out.push(row);
        continue;
      }
      if (row.command === 'G91') {
        state.absolute = false;
        out.push(row);
        continue;
      }

      if (!this.#isRapidCommand(row.command)) {
        if (this.#isLinearMotion(row.command)) {
          Object.assign(state, this.#targetPosition(state, row.params));
        }
        out.push(row);
        continue;
      }

      const target = this.#targetPosition(state, row.params);
      const unchanged = target.x === state.x && target.y === state.y && target.z === state.z;
      if (!unchanged) {
        out.push(row);
        Object.assign(state, target);
      }
    }

    return out;
  }

  #removeAirCutting(rows) {
    const out = [];
    const state = { absolute: true, x: 0, y: 0, z: 0, modalMotion: null };

    for (const row of rows) {
      if (!row.command) {
        out.push(row);
        continue;
      }
      if (row.command === 'G90') {
        state.absolute = true;
        out.push(row);
        continue;
      }
      if (row.command === 'G91') {
        state.absolute = false;
        out.push(row);
        continue;
      }

      if (this.#isMotionCommand(row.command)) {
        state.modalMotion = row.command;
      }
      const motion = this.#canonicalMotion(state.modalMotion);
      if (!motion || !this.#isLinearFeedCommand(motion)) {
        if (this.#isLinearMotion(motion)) {
          Object.assign(state, this.#targetPosition(state, row.params));
        }
        out.push(row);
        continue;
      }

      const target = this.#targetPosition(state, row.params);
      const hasXYMove = target.x !== state.x || target.y !== state.y;
      const isAir = hasXYMove && target.z >= 0;
      if (!isAir) {
        out.push(row);
      }
      Object.assign(state, target);
    }

    return out;
  }

  #mergeConsecutiveRapids(rows) {
    const out = [];
    const state = { absolute: true, x: 0, y: 0, z: 0 };
    let i = 0;

    while (i < rows.length) {
      const row = rows[i];
      if (!row.command) {
        out.push(row);
        i += 1;
        continue;
      }
      if (row.command === 'G90') {
        state.absolute = true;
        out.push(row);
        i += 1;
        continue;
      }
      if (row.command === 'G91') {
        state.absolute = false;
        out.push(row);
        i += 1;
        continue;
      }

      if (!this.#isRapidCommand(row.command) || state.absolute === false) {
        if (this.#isLinearMotion(row.command)) {
          Object.assign(state, this.#targetPosition(state, row.params));
        }
        out.push(row);
        i += 1;
        continue;
      }

      const block = [];
      let cursor = { ...state };
      while (i < rows.length && rows[i].command && this.#isRapidCommand(rows[i].command)) {
        const rr = rows[i];
        const target = this.#targetPosition(cursor, rr.params);
        block.push({ row: rr, target });
        cursor = { ...cursor, ...target };
        i += 1;
      }

      if (block.length === 1) {
        out.push(block[0].row);
        Object.assign(state, block[0].target);
        continue;
      }

      const first = block[0].row;
      const merged = { ...first, command: 'G0', params: {}, paramOrder: [] };
      for (const axis of ['X', 'Y', 'Z']) {
        let touched = false;
        for (const entry of block) {
          if (Number.isFinite(entry.row.params[axis])) {
            merged.params[axis] = entry.target[axis.toLowerCase()];
            touched = true;
          }
        }
        if (touched) {
          merged.paramOrder.push(axis);
        }
      }

      out.push(merged);
      Object.assign(state, block[block.length - 1].target);
    }

    return out;
  }

  #reorderRapidTriplets(rows) {
    const out = [];

    for (let i = 0; i < rows.length; i += 1) {
      const a = rows[i];
      const b = rows[i + 1];
      const c = rows[i + 2];

      if (!a || !b || !c || !this.#isRapidCommand(a.command) || !this.#isRapidCommand(b.command) || !this.#isRapidCommand(c.command)) {
        out.push(a);
        continue;
      }

      const aZOnly = this.#isZOnlyMove(a);
      const bXY = Number.isFinite(b.params.X) || Number.isFinite(b.params.Y);
      const cZOnly = this.#isZOnlyMove(c);
      if (!aZOnly || !bXY || !cZOnly) {
        out.push(a);
        continue;
      }

      const merged = {
        ...b,
        command: 'G0',
        params: { ...b.params, Z: c.params.Z },
        paramOrder: [...new Set([...(b.paramOrder || []), 'Z'])],
      };

      out.push(merged);
      i += 2;
    }

    return out;
  }

  #normalizeFeedRates(rows) {
    let currentF = null;
    return rows.map((row) => {
      if (!row.command || !Number.isFinite(row.params.F)) {
        return row;
      }
      const clone = { ...row, params: { ...row.params }, paramOrder: [...(row.paramOrder || [])] };
      if (currentF !== null && clone.params.F === currentF) {
        delete clone.params.F;
        clone.paramOrder = clone.paramOrder.filter((k) => k !== 'F');
      } else {
        currentF = clone.params.F;
      }
      return clone;
    });
  }

  #scaleFeedAndSpindle(rows, feedScale, spindleScale) {
    const scaleF = Number.isFinite(feedScale) && feedScale > 0 && feedScale !== 1;
    const scaleS = Number.isFinite(spindleScale) && spindleScale > 0 && spindleScale !== 1;
    if (!scaleF && !scaleS) {
      return rows;
    }

    return rows.map((row) => {
      if (!row.command) {
        return row;
      }
      const clone = { ...row, params: { ...row.params }, paramOrder: [...(row.paramOrder || [])] };
      if (scaleF && Number.isFinite(clone.params.F)) {
        clone.params.F = Number((clone.params.F * feedScale).toFixed(6));
      }
      if (scaleS && Number.isFinite(clone.params.S)) {
        clone.params.S = Number((clone.params.S * spindleScale).toFixed(6));
      }
      return clone;
    });
  }

  #removeCommentsAndBlankRows(rows) {
    return rows.filter((row) => {
      const trimmed = String(row.raw || '').trim();
      if (trimmed === '') {
        return false;
      }
      if (trimmed.startsWith(';')) {
        return false;
      }
      return true;
    });
  }

  #applyPass(rows, passFn, metricKey, reasonText) {
    const nextRows = passFn(rows);
    const removed = this.#registerPassRemovals(rows, nextRows, reasonText);
    if (removed > 0 && Object.prototype.hasOwnProperty.call(this.metrics, metricKey)) {
      this.metrics[metricKey] += removed;
    }
    return nextRows;
  }

  #registerPassRemovals(beforeRows, afterRows, reasonText) {
    const kept = new Set(afterRows.map((row) => row.index));
    let removedCount = 0;
    for (const row of beforeRows) {
      if (!kept.has(row.index)) {
        removedCount += 1;
        const prev = this.removalReasons.get(row.index) || [];
        prev.push(reasonText);
        this.removalReasons.set(row.index, prev);
      }
    }
    return removedCount;
  }

  #validateWithToolpath(gcodeText) {
    return new Promise((resolve, reject) => {
      try {
        const toolpath = new GCodeToolpath({
          addLine: () => {},
          addArcCurve: () => {},
        });

        toolpath.loadFromString(gcodeText, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  #collectRemovedEntries(before, after) {
    const afterSet = new Set(after.map((row) => row.index));
    return before
      .filter((row) => row.command && !afterSet.has(row.index))
      .map((row) => ({
        line: row.line,
        raw: row.raw,
        reasons: this.removalReasons.get(row.index) || [],
      }));
  }

  #distanceForMotion(state, target, row, motion) {
    if (motion !== 'G2' && motion !== 'G3') {
      return Math.hypot(target.x - state.x, target.y - state.y, target.z - state.z);
    }

    const hasI = Number.isFinite(row.params.I);
    const hasJ = Number.isFinite(row.params.J);
    if (!hasI || !hasJ) {
      return Math.hypot(target.x - state.x, target.y - state.y, target.z - state.z);
    }

    const cx = state.x + row.params.I;
    const cy = state.y + row.params.J;
    const r0 = Math.hypot(state.x - cx, state.y - cy);
    const r1 = Math.hypot(target.x - cx, target.y - cy);
    const radius = (r0 + r1) / 2;
    if (!Number.isFinite(radius) || radius <= 0) {
      return Math.hypot(target.x - state.x, target.y - state.y, target.z - state.z);
    }

    const a0 = Math.atan2(state.y - cy, state.x - cx);
    const a1 = Math.atan2(target.y - cy, target.x - cx);
    let delta = a1 - a0;
    const clockwise = motion === 'G2';
    if (clockwise) {
      if (delta >= 0) {
        delta -= 2 * Math.PI;
      }
    } else if (delta <= 0) {
      delta += 2 * Math.PI;
    }

    const arcXY = Math.abs(delta) * radius;
    const dz = target.z - state.z;
    return Math.hypot(arcXY, dz);
  }

  #accelPenaltySeconds(baseSeconds) {
    if (!Number.isFinite(baseSeconds) || baseSeconds <= 0) {
      return 0;
    }
    return Math.min(0.12, baseSeconds * 0.15);
  }

  #paramsSignature(params) {
    return Object.keys(params)
      .sort()
      .map((key) => `${key}:${params[key]}`)
      .join('|');
  }

  #targetPosition(state, params) {
    const absolute = state.absolute !== false;
    return {
      x: Number.isFinite(params.X) ? (absolute ? params.X : state.x + params.X) : state.x,
      y: Number.isFinite(params.Y) ? (absolute ? params.Y : state.y + params.Y) : state.y,
      z: Number.isFinite(params.Z) ? (absolute ? params.Z : state.z + params.Z) : state.z,
    };
  }

  #isRapidCommand(command) {
    return command === 'G0' || command === 'G00';
  }

  #isLinearFeedCommand(command) {
    return command === 'G1' || command === 'G01';
  }

  #isLinearMotion(command) {
    return this.#isRapidCommand(command) || this.#isLinearFeedCommand(command);
  }

  #isMotionCommand(command) {
    return /^G0?[0-3]$/.test(String(command || ''));
  }

  #canonicalMotion(command) {
    if (!command) {
      return null;
    }
    if (command === 'G00') {
      return 'G0';
    }
    if (command === 'G01') {
      return 'G1';
    }
    return command;
  }

  #isZOnlyMove(row) {
    if (!row || !this.#isLinearMotion(row.command)) {
      return false;
    }
    const hasX = Number.isFinite(row.params.X);
    const hasY = Number.isFinite(row.params.Y);
    const hasZ = Number.isFinite(row.params.Z);
    return hasZ && !hasX && !hasY;
  }

  #formatDuration(seconds) {
    const total = Math.max(Math.round(seconds), 0);
    const minutes = Math.floor(total / 60);
    const remainingSeconds = total % 60;
    if (minutes === 0) {
      return `${remainingSeconds}s`;
    }
    return `${minutes}m ${remainingSeconds}s`;
  }

  #normalizeOptions(options) {
    const source = options && typeof options === 'object' ? options : {};
    const mode = source.optimizationMode === 'aggressive' ? 'aggressive' : 'conservative';
    const machineRate = Number(source.machineRateEURPerHour);
    const jobsPerDay = Number(source.jobsPerDay);
    const workDaysPerMonth = Number(source.workDaysPerMonth);
    return {
      removeRedundantMoves: source.removeRedundantMoves !== false,
      optimizeRapidTraverse: source.optimizeRapidTraverse !== false,
      smoothRapidTraverses: source.smoothRapidTraverses !== false,
      removeComments: source.removeComments !== false,
      normalizeFeedRates: source.normalizeFeedRates !== false,
      removeDuplicateCoordinates: source.removeDuplicateCoordinates !== false,
      optimizationMode: mode,
      feedScale: Number.isFinite(source.feedScale) && source.feedScale > 0 ? source.feedScale : 1,
      spindleScale: Number.isFinite(source.spindleScale) && source.spindleScale > 0 ? source.spindleScale : 1,
      machineRateEURPerHour: Number.isFinite(machineRate) && machineRate > 0 ? machineRate : MACHINE_RATE_EUR_PER_HOUR,
      jobsPerDay: Number.isFinite(jobsPerDay) && jobsPerDay > 0 ? jobsPerDay : 5,
      workDaysPerMonth: Number.isFinite(workDaysPerMonth) && workDaysPerMonth > 0 ? workDaysPerMonth : 22,
    };
  }

  #ensureNonEmpty(text) {
    if (text.trim() === '') {
      throw new Error('Invalid input: G-code file is empty.');
    }
  }

  #countNonEmptyLines(text) {
    return text
      .replace(/\r\n/g, '\n')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .length;
  }

  #friendlyError(error) {
    const message = error instanceof Error ? error.message : String(error);

    if (/empty/i.test(message)) {
      return new Error('Unable to process G-code: file is empty.');
    }

    if (/parse|syntax|token|invalid/i.test(message)) {
      return new Error('Unable to process G-code: file appears malformed or unsupported.');
    }

    return new Error(`Unable to process G-code: ${message}`);
  }
}

module.exports = GcodeOptimizer;
module.exports.CycleTimeCalculator = CycleTimeCalculator;
