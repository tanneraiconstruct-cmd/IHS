import { addWorkingTime, previousWorkingDay, resolveCalendar, subtractWorkingTime } from "./calendar";
import { applyBackwardConstraint } from "./constraints";
import type { ScheduleGraph } from "./graph";
import { resolveProgress } from "./progress";
import type {
  ActivityInput, Calendar, DependencyInput, IsoDate, Problem, ScheduleInput,
} from "./types";

export interface LateDates {
  ls: IsoDate;
  lf: IsoDate;
}

export interface BackwardPassResult {
  lateDates: Map<string, LateDates>;
  violations: Problem[];
}

const min = (a: IsoDate, b: IsoDate): IsoDate => (a < b ? a : b);

function effectiveDuration(activity: ActivityInput): number {
  return activity.type === "milestone" ? 0 : activity.remainingDuration;
}

/** Reverse of forward lag: shift back by `lag` working days on `calendar`. */
function removeLag(date: IsoDate, lag: number, calendar: Calendar): IsoDate {
  return lag >= 0
    ? subtractWorkingTime(date, lag, calendar)
    : addWorkingTime(date, -lag, calendar);
}

/**
 * The LF a single outgoing relationship requires of its predecessor.
 * `predDuration`/`predCalendar` belong to the predecessor; lag is measured on
 * the successor's calendar.
 */
function lfFromRelationship(
  dep: DependencyInput,
  successorLate: LateDates,
  predDuration: number,
  predCalendar: Calendar,
  successorCalendar: Calendar,
): IsoDate {
  switch (dep.type) {
    case "FS":
      return removeLag(successorLate.ls, dep.lag, successorCalendar);
    case "FF":
      return removeLag(successorLate.lf, dep.lag, successorCalendar);
    case "SS": {
      const predLs = removeLag(successorLate.ls, dep.lag, successorCalendar);
      return addWorkingTime(predLs, predDuration, predCalendar);
    }
    case "SF": {
      const predLs = removeLag(successorLate.lf, dep.lag, successorCalendar);
      return addWorkingTime(predLs, predDuration, predCalendar);
    }
  }
}

export function backwardPass(
  input: ScheduleInput,
  graph: ScheduleGraph,
  topoOrder: string[],
  projectFinish: IsoDate,
): BackwardPassResult {
  const byId = new Map(input.activities.map((a) => [a.id, a]));
  const calendarOf = (a: ActivityInput): Calendar =>
    resolveCalendar(a, input.calendars, input.defaultCalendarId);
  const lateDates = new Map<string, LateDates>();
  const violations: Problem[] = [];

  for (let i = topoOrder.length - 1; i >= 0; i -= 1) {
    const id = topoOrder[i];
    const activity = byId.get(id) as ActivityInput;
    const calendar = calendarOf(activity);
    const duration = effectiveDuration(activity);

    // Complete activities do not move; their late dates equal their actuals.
    const progress = resolveProgress(activity, input.dataDate);
    if (progress.status === "complete") {
      lateDates.set(id, {
        ls: progress.pinnedStart as IsoDate,
        lf: progress.pinnedFinish as IsoDate,
      });
      continue;
    }

    // Logic-driven LF: the most restrictive requirement across outgoing links.
    // An open end (no successors) seeds at the project finish.
    let logicLateFinish = projectFinish;
    for (const dep of graph.successors.get(id) ?? []) {
      const succLate = lateDates.get(dep.successorId);
      if (!succLate) continue;
      const succCalendar = calendarOf(byId.get(dep.successorId) as ActivityInput);
      logicLateFinish = min(
        logicLateFinish,
        lfFromRelationship(dep, succLate, duration, calendar, succCalendar),
      );
    }

    const clamped = applyBackwardConstraint(
      logicLateFinish, duration, activity.constraint, calendar,
    );
    if (clamped.violated) {
      violations.push({
        type: "constraint_violation",
        severity: "warning",
        activityIds: [id],
        message: `Constraint ${activity.constraint?.type} on '${id}' cannot be honored; network logic forces an earlier finish.`,
      });
    }
    const lf = previousWorkingDay(clamped.lateFinish, calendar);
    lateDates.set(id, { lf, ls: subtractWorkingTime(lf, duration, calendar) });
  }

  return { lateDates, violations };
}
