import type { ActivityInput, Calendar, IsoDate } from "./types";

/** Parse 'YYYY-MM-DD' as a UTC instant — avoids local-timezone drift. */
function parseIso(date: IsoDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function toIso(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

/** Shift a date by n whole calendar days (n may be negative). */
function shiftDays(date: IsoDate, n: number): IsoDate {
  const d = parseIso(date);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}

export function isWorkingDay(date: IsoDate, calendar: Calendar): boolean {
  const exception = calendar.exceptions.find((e) => e.date === date);
  if (exception) return exception.working;
  return calendar.workingWeekdays.includes(parseIso(date).getUTCDay());
}

/** The given date if it is a working day, else the next working day after it. */
export function nextWorkingDay(date: IsoDate, calendar: Calendar): IsoDate {
  let d = date;
  while (!isWorkingDay(d, calendar)) d = shiftDays(d, 1);
  return d;
}

/** The given date if it is a working day, else the previous working day before it. */
export function previousWorkingDay(date: IsoDate, calendar: Calendar): IsoDate {
  let d = date;
  while (!isWorkingDay(d, calendar)) d = shiftDays(d, -1);
  return d;
}

/** The date `units` working days after `date`. Negative units subtract. */
export function addWorkingTime(date: IsoDate, units: number, calendar: Calendar): IsoDate {
  if (units < 0) return subtractWorkingTime(date, -units, calendar);
  let d = date;
  let remaining = units;
  while (remaining > 0) {
    d = shiftDays(d, 1);
    if (isWorkingDay(d, calendar)) remaining -= 1;
  }
  return d;
}

/** The date `units` working days before `date`. Negative units add. */
export function subtractWorkingTime(date: IsoDate, units: number, calendar: Calendar): IsoDate {
  if (units < 0) return addWorkingTime(date, -units, calendar);
  let d = date;
  let remaining = units;
  while (remaining > 0) {
    d = shiftDays(d, -1);
    if (isWorkingDay(d, calendar)) remaining -= 1;
  }
  return d;
}

/** Working days from `start` to `finish` (assumes finish >= start). */
export function workingTimeBetween(start: IsoDate, finish: IsoDate, calendar: Calendar): number {
  let count = 0;
  let d = start;
  while (d < finish) {
    d = shiftDays(d, 1);
    if (isWorkingDay(d, calendar)) count += 1;
  }
  return count;
}

/** The activity's override calendar, or the project default. Assumes validation passed. */
export function resolveCalendar(
  activity: ActivityInput,
  calendars: Calendar[],
  defaultCalendarId: string,
): Calendar {
  const id = activity.calendarId ?? defaultCalendarId;
  const found = calendars.find((c) => c.id === id);
  if (!found) throw new Error(`calendar not found: ${id}`);
  return found;
}
