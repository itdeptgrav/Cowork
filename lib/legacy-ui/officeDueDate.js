/**
 * officeDueDate.js — PORTED VERBATIM from `cowork-old-frontend/lib/officeDueDate.js`.
 *
 * Not rewritten, and not reimplemented in TypeScript, for the same reason
 * `useDutyStatus.js` and `useCoworkNotifications.ts` were copied rather than
 * reworked: this arithmetic decides the deadlines people are SCORED against.
 * A subtly different reimplementation would produce dates that disagree with
 * the old app's for the same task, and the disagreement would show up as
 * somebody being marked late.
 *
 * Every deadline the new workspace computes goes through this file, so there is
 * exactly one implementation of "add N working seconds in IST office hours,
 * skipping off-days, holidays, leave and breaks".
 *
 * Original header follows.
 *
 * lib/officeDueDate.js
 * Pure date-arithmetic utility — no React, safe to dynamic-import anywhere.
 * All date arithmetic uses explicit IST (UTC+5:30) offsets. No server local
 * timezone is ever used — safe on UTC production servers.
 *
 * blockedDates: optional Set<"YYYY-MM-DD"> — company holidays + an employee's
 * approved leave days, fetched from GET /cowork/scheduling/blocked-dates.
 *
 * breaks: optional array of { name, start: "HH:MM", end: "HH:MM" } — daily
 * recurring breaks (lunch, tea, etc.) subtracted from every working day's
 * available window. Same list applies to every working day.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function _istDow(utcMs) {
  return new Date(utcMs + IST_OFFSET_MS).getUTCDay();
}

function _istMidnightUtcMs(utcMs) {
  const ist = new Date(utcMs + IST_OFFSET_MS);
  return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS;
}

function _istTimeMs(utcMs, timeStr) {
  const [h, m] = (timeStr || "09:30").split(":").map(Number);
  return _istMidnightUtcMs(utcMs) + (h * 60 + m) * 60 * 1000;
}

function _dateStrIST(utcMs) {
  return new Date(utcMs + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function _dayCfg(dayKey, schedule) {
  return (schedule && schedule[dayKey]) || { isOff: dayKey === "sunday", inTime: "09:30", outTime: "18:30" };
}

/** Break windows for the IST calendar day containing `cur`, as ms ranges. */
function _dayBreaksMs(cur, breaks) {
  if (!breaks || !breaks.length) return [];
  return breaks
    .map(b => ({ start: _istTimeMs(cur, b.start), end: _istTimeMs(cur, b.end), name: b.name }))
    .filter(b => b.end > b.start)
    .sort((a, b) => a.start - b.start);
}

function _activeBreakAt(ms, dayBreaks) {
  return dayBreaks.find(b => ms >= b.start && ms < b.end) || null;
}

/** End of the current available work segment: next break start, or day end. */
function _nextSegmentEndMs(cur, dayEndMs, dayBreaks) {
  for (const b of dayBreaks) {
    if (b.start > cur) return Math.min(b.start, dayEndMs);
  }
  return dayEndMs;
}

/** Advance to next IST calendar day midnight (as UTC ms), skipping off days,
 *  company holidays, and this employee's approved leave. */
function _nextWorkDayStartMs(utcMs, schedule, blockedDates) {
  let dayMs = _istMidnightUtcMs(utcMs) + IST_OFFSET_MS + 24 * 60 * 60 * 1000;
  dayMs -= IST_OFFSET_MS;

  for (let i = 0; i < 21; i++) {
    const dayKey = DAY_KEYS[_istDow(dayMs)];
    const cfg = _dayCfg(dayKey, schedule);
    const isBlocked = blockedDates?.has(_dateStrIST(dayMs));
    if (!cfg.isOff && !isBlocked) {
      return _istTimeMs(dayMs, cfg.inTime);
    }
    dayMs += 24 * 60 * 60 * 1000;
  }
  return dayMs;
}

/** Snap forward to the next valid working moment — respects office hours,
 *  off days, holidays, leave, AND breaks (jumps past an active break). */
function _advanceToWorkHoursMs(utcMs, schedule, blockedDates, breaks) {
  let cur = utcMs;
  for (let i = 0; i < 30; i++) {
    const dayKey = DAY_KEYS[_istDow(cur)];
    const cfg = _dayCfg(dayKey, schedule);
    const isBlocked = blockedDates?.has(_dateStrIST(cur));
    if (cfg.isOff || isBlocked) { cur = _nextWorkDayStartMs(cur, schedule, blockedDates); continue; }

    const dayStartMs = _istTimeMs(cur, cfg.inTime);
    const dayEndMs = _istTimeMs(cur, cfg.outTime);
    if (cur < dayStartMs) cur = dayStartMs;
    if (cur >= dayEndMs) { cur = _nextWorkDayStartMs(cur, schedule, blockedDates); continue; }

    const dayBreaks = _dayBreaksMs(cur, breaks);
    const activeBreak = _activeBreakAt(cur, dayBreaks);
    if (activeBreak) { cur = activeBreak.end; continue; }

    return cur;
  }
  return cur;
}

/** Walk forward consuming windowSecs of real working time — skipping off
 *  days, holidays, leave, and every break — day by day, segment by segment. */
function _addWorkingSecsMs(fromMs, windowSecs, schedule, blockedDates, breaks) {
  let remaining = windowSecs;
  let cur = _advanceToWorkHoursMs(fromMs, schedule, blockedDates, breaks);
  let safety = 0;
  while (remaining > 0 && safety++ < 120) {
    const dayKey = DAY_KEYS[_istDow(cur)];
    const cfg = _dayCfg(dayKey, schedule);
    const isBlocked = blockedDates?.has(_dateStrIST(cur));
    if (cfg.isOff || isBlocked) {
      cur = _advanceToWorkHoursMs(_nextWorkDayStartMs(cur, schedule, blockedDates), schedule, blockedDates, breaks);
      continue;
    }

    const dayEndMs = _istTimeMs(cur, cfg.outTime);
    if (cur >= dayEndMs) {
      cur = _advanceToWorkHoursMs(_nextWorkDayStartMs(cur, schedule, blockedDates), schedule, blockedDates, breaks);
      continue;
    }

    const dayBreaks = _dayBreaksMs(cur, breaks);
    const activeBreak = _activeBreakAt(cur, dayBreaks);
    if (activeBreak) { cur = activeBreak.end; continue; }

    const segEndMs = _nextSegmentEndMs(cur, dayEndMs, dayBreaks);
    const availSecs = (segEndMs - cur) / 1000;
    if (remaining <= availSecs) return cur + remaining * 1000;
    remaining -= availSecs;
    cur = segEndMs;
  }
  return cur;
}

function _fmtIST(ms) {
  const d = new Date(ms + IST_OFFSET_MS);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

/**
 * Same walk as _addWorkingSecsMs, but returns a step-by-step log instead of
 * just the final timestamp — for showing "how this deadline was calculated."
 * blockedDates here is a Map<"YYYY-MM-DD", {type, name}> (not a Set) so the
 * log can say WHICH reason (holiday vs leave) a day was skipped for.
 */
export function explainAddWorkingSecs(fromMs, windowSecs, schedule, blockedDates, breaks) {
  const steps = [];
  let remaining = windowSecs;
  let cur = fromMs;
  let safety = 0;

  const skipDay = (dateStr) => {
    const info = blockedDates?.get ? blockedDates.get(dateStr) : null;
    steps.push({ type: info?.type || "off", date: dateStr, name: info?.name });
  };

  // Advance to the first valid working moment, logging every skip along the way
  for (let i = 0; i < 30; i++) {
    const dayKey = DAY_KEYS[_istDow(cur)];
    const cfg = _dayCfg(dayKey, schedule);
    const dateStr = _dateStrIST(cur);
    const isBlocked = blockedDates?.has(dateStr);
    if (cfg.isOff || isBlocked) { skipDay(dateStr); cur = _nextWorkDayStartMs(cur, schedule, blockedDates); continue; }
    const dayStartMs = _istTimeMs(cur, cfg.inTime);
    const dayEndMs = _istTimeMs(cur, cfg.outTime);
    if (cur < dayStartMs) cur = dayStartMs;
    if (cur >= dayEndMs) { cur = _nextWorkDayStartMs(cur, schedule, blockedDates); continue; }
    const dayBreaks = _dayBreaksMs(cur, breaks);
    const activeBreak = _activeBreakAt(cur, dayBreaks);
    if (activeBreak) {
      steps.push({ type: "break", date: dateStr, name: activeBreak.name, from: _fmtIST(activeBreak.start), to: _fmtIST(activeBreak.end) });
      cur = activeBreak.end; continue;
    }
    break;
  }

  while (remaining > 0 && safety++ < 120) {
    const dayKey = DAY_KEYS[_istDow(cur)];
    const cfg = _dayCfg(dayKey, schedule);
    const dateStr = _dateStrIST(cur);
    const isBlocked = blockedDates?.has(dateStr);
    if (cfg.isOff || isBlocked) {
      skipDay(dateStr);
      cur = _advanceToWorkHoursMs(_nextWorkDayStartMs(cur, schedule, blockedDates), schedule, blockedDates, breaks);
      continue;
    }
    const dayEndMs = _istTimeMs(cur, cfg.outTime);
    if (cur >= dayEndMs) {
      cur = _advanceToWorkHoursMs(_nextWorkDayStartMs(cur, schedule, blockedDates), schedule, blockedDates, breaks);
      continue;
    }
    const dayBreaks = _dayBreaksMs(cur, breaks);
    const activeBreak = _activeBreakAt(cur, dayBreaks);
    if (activeBreak) {
      steps.push({ type: "break", date: dateStr, name: activeBreak.name, from: _fmtIST(activeBreak.start), to: _fmtIST(activeBreak.end) });
      cur = activeBreak.end; continue;
    }
    const segEndMs = _nextSegmentEndMs(cur, dayEndMs, dayBreaks);
    const availSecs = (segEndMs - cur) / 1000;
    if (remaining <= availSecs) {
      const finishMs = cur + remaining * 1000;
      steps.push({ type: "work", date: dateStr, from: _fmtIST(cur), to: _fmtIST(finishMs), hoursUsed: +(remaining / 3600).toFixed(2), final: true });
      return { dueDateISO: new Date(finishMs).toISOString(), steps };
    }
    steps.push({ type: "work", date: dateStr, from: _fmtIST(cur), to: _fmtIST(segEndMs), hoursUsed: +(availSecs / 3600).toFixed(2) });
    remaining -= availSecs;
    cur = segEndMs;
  }
  return { dueDateISO: new Date(cur).toISOString(), steps };
}

export function calcDueDate(windowSecs, schedule, maxGapMinutes, taskCreatedAtMs, blockedDates, breaks) {
  const now = Date.now();
  const elapsed = now - taskCreatedAtMs;
  const maxGapMs = (maxGapMinutes || 120) * 60 * 1000;
  const anchorMs = elapsed > maxGapMs ? taskCreatedAtMs + maxGapMs : now;
  return new Date(_addWorkingSecsMs(anchorMs, windowSecs, schedule, blockedDates, breaks)).toISOString();
}

/**
 * Add windowSecs of working time from anchorMs through IST office hours,
 * skipping off days, holidays, leave, and breaks. Works even if anchorMs
 * is in the future. Omitting blockedDates/breaks keeps old behavior.
 */
export function addWorkingSecs(anchorMs, windowSecs, schedule, blockedDates, breaks) {
  return new Date(_addWorkingSecsMs(anchorMs, windowSecs, schedule, blockedDates, breaks)).toISOString();
}

/**
 * Count WORKING seconds between two instants — the inverse of addWorkingSecs.
 * Nights, off days, holidays/leave, and breaks contribute 0. Used for the
 * office-hours-aware "X% elapsed" in the extension-request zone.
 */
export function workingSecsBetween(startMs, endMs, schedule, blockedDates, breaks) {
  if (!schedule || !startMs || !endMs || endMs <= startMs) return 0;
  let total = 0;
  let cur = _advanceToWorkHoursMs(startMs, schedule, blockedDates, breaks);
  let safety = 0;
  while (cur < endMs && safety++ < 400) {
    const dayKey = DAY_KEYS[_istDow(cur)];
    const cfg = _dayCfg(dayKey, schedule);
    const isBlocked = blockedDates?.has(_dateStrIST(cur));
    if (cfg.isOff || isBlocked) {
      cur = _advanceToWorkHoursMs(_nextWorkDayStartMs(cur, schedule, blockedDates), schedule, blockedDates, breaks);
      continue;
    }
    const dayEndMs = _istTimeMs(cur, cfg.outTime);
    if (cur >= dayEndMs) {
      cur = _advanceToWorkHoursMs(_nextWorkDayStartMs(cur, schedule, blockedDates), schedule, blockedDates, breaks);
      continue;
    }
    const dayBreaks = _dayBreaksMs(cur, breaks);
    const activeBreak = _activeBreakAt(cur, dayBreaks);
    if (activeBreak) { cur = activeBreak.end; continue; }
    const segEndMs = Math.min(_nextSegmentEndMs(cur, dayEndMs, dayBreaks), endMs);
    if (segEndMs <= cur) break;
    total += (segEndMs - cur) / 1000;
    cur = segEndMs;
  }
  return Math.floor(total);
}

/** Snap a UTC timestamp forward to the next valid IST office moment. */
export function snapToOfficeHours(timestampMs, schedule, blockedDates, breaks) {
  return new Date(_advanceToWorkHoursMs(timestampMs, schedule, blockedDates, breaks)).toISOString();
}