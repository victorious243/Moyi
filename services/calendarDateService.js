const MAX_CALENDAR_RANGE_DAYS = 93;
const CALENDAR_VIEWS = new Set(['today', 'week', 'month', 'list', 'attention']);

function validTimezone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function safeTimezone(value) {
  return validTimezone(value) ? value : 'UTC';
}

function dateKeyFromUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

function parseDateKey(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return dateKeyFromUtcDate(date) === match[0] ? match[0] : null;
}

function addDays(dateKey, amount) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateKeyFromUtcDate(date);
}

function localParts(date, timezone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimezone(timezone),
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(date));
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

function localDateKey(date = new Date(), timezone = 'UTC') {
  const parts = localParts(date, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function timezoneOffsetMs(date, timezone) {
  const parts = localParts(date, timezone);
  const representedAsUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  return representedAsUtc - new Date(date).getTime();
}

function utcForLocalDateTime(dateKey, time = '00:00', timezone = 'UTC') {
  const parsedDate = parseDateKey(dateKey);
  const match = String(time).match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!parsedDate || !match || Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3] || 0) > 59) {
    throw new Error('Choose a valid local date and time.');
  }
  const [year, month, day] = parsedDate.split('-').map(Number);
  const targetWallClock = Date.UTC(year, month - 1, day, Number(match[1]), Number(match[2]), Number(match[3] || 0));
  let candidate = new Date(targetWallClock);
  for (let index = 0; index < 3; index += 1) {
    candidate = new Date(targetWallClock - timezoneOffsetMs(candidate, safeTimezone(timezone)));
  }
  return candidate;
}

function weekdayIndex(dateKey) {
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
}

function startOfWeek(dateKey) {
  const day = weekdayIndex(dateKey);
  return addDays(dateKey, day === 0 ? -6 : 1 - day);
}

function startOfMonth(dateKey) {
  return `${dateKey.slice(0, 7)}-01`;
}

function endOfMonth(dateKey) {
  const first = new Date(`${startOfMonth(dateKey)}T00:00:00.000Z`);
  first.setUTCMonth(first.getUTCMonth() + 1);
  return addDays(dateKeyFromUtcDate(first), -1);
}

function daysBetween(fromKey, toKeyExclusive) {
  return Math.round((new Date(`${toKeyExclusive}T00:00:00.000Z`) - new Date(`${fromKey}T00:00:00.000Z`)) / 86400000);
}

function resolveCalendarRange({ view = 'list', date = '', timezone = 'UTC', now = new Date() } = {}) {
  const normalizedView = CALENDAR_VIEWS.has(view) ? view : 'list';
  const anchorDate = parseDateKey(date) || localDateKey(now, timezone);
  let fromKey;
  let toKeyExclusive;

  if (normalizedView === 'today') {
    fromKey = anchorDate;
    toKeyExclusive = addDays(anchorDate, 1);
  } else if (normalizedView === 'week') {
    fromKey = startOfWeek(anchorDate);
    toKeyExclusive = addDays(fromKey, 7);
  } else if (normalizedView === 'month') {
    const monthStart = startOfMonth(anchorDate);
    fromKey = startOfWeek(monthStart);
    const monthEnd = endOfMonth(anchorDate);
    toKeyExclusive = addDays(monthEnd, 1);
    const trailingDays = (8 - weekdayIndex(toKeyExclusive)) % 7;
    toKeyExclusive = addDays(toKeyExclusive, trailingDays);
  } else {
    fromKey = addDays(anchorDate, -45);
    toKeyExclusive = addDays(anchorDate, 46);
  }

  const from = utcForLocalDateTime(fromKey, '00:00', timezone);
  const to = utcForLocalDateTime(toKeyExclusive, '00:00', timezone);
  return {
    view: normalizedView,
    anchorDate,
    fromKey,
    toKeyExclusive,
    from,
    to,
    days: daysBetween(fromKey, toKeyExclusive)
  };
}

function resolveExplicitRange({ from, to, timezone = 'UTC' }) {
  const fromKey = parseDateKey(from);
  const toInclusiveKey = parseDateKey(to);
  if (!fromKey || !toInclusiveKey) throw new Error('Use valid from and to dates in YYYY-MM-DD format.');
  const toKeyExclusive = addDays(toInclusiveKey, 1);
  const days = daysBetween(fromKey, toKeyExclusive);
  if (days < 1) throw new Error('The calendar end date must be on or after the start date.');
  if (days > MAX_CALENDAR_RANGE_DAYS) throw new Error(`Calendar ranges cannot exceed ${MAX_CALENDAR_RANGE_DAYS} days.`);
  return {
    view: 'range',
    anchorDate: fromKey,
    fromKey,
    toKeyExclusive,
    from: utcForLocalDateTime(fromKey, '00:00', timezone),
    to: utcForLocalDateTime(toKeyExclusive, '00:00', timezone),
    days
  };
}

function formatCalendarDate(date, timezone, options = {}) {
  return new Intl.DateTimeFormat('en-US', { timeZone: safeTimezone(timezone), ...options }).format(new Date(date));
}

function localTimeValue(date, timezone = 'UTC') {
  const parts = localParts(date, timezone);
  return `${parts.hour}:${parts.minute}`;
}

function navigationDates(range) {
  const movement = { today: 1, week: 7, month: 0, list: 91, attention: 91 };
  if (range.view === 'month') {
    const anchor = new Date(`${range.anchorDate}T00:00:00.000Z`);
    const previous = new Date(anchor);
    const next = new Date(anchor);
    previous.setUTCMonth(previous.getUTCMonth() - 1, 1);
    next.setUTCMonth(next.getUTCMonth() + 1, 1);
    return { previous: dateKeyFromUtcDate(previous), next: dateKeyFromUtcDate(next) };
  }
  const amount = movement[range.view] || range.days;
  return { previous: addDays(range.anchorDate, -amount), next: addDays(range.anchorDate, amount) };
}

module.exports = {
  CALENDAR_VIEWS,
  MAX_CALENDAR_RANGE_DAYS,
  addDays,
  endOfMonth,
  formatCalendarDate,
  localDateKey,
  localParts,
  localTimeValue,
  navigationDates,
  parseDateKey,
  resolveCalendarRange,
  resolveExplicitRange,
  safeTimezone,
  startOfMonth,
  startOfWeek,
  utcForLocalDateTime,
  validTimezone
};
