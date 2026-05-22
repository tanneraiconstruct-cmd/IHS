import { addWorkingTime, nextWorkingDay, resolveCalendar, subtractWorkingTime } from "./calendar";
import { applyForwardConstraint } from "./constraints";
import type { ScheduleGraph } from "./graph";
import { resolveProgress } from "./progress";
import type {
  ActivityInput, Calendar, DependencyInput, IsoDate, Problem, ScheduleInput,
} from "./types";

export interface EarlyDates {
  es: IsoDate;
  ef: IsoDate;
}

export interface ForwardPassResult {
  earlyDates: Map<string, EarlyDates>;
  projectFinish: IsoDate;
  violations: Problem[];
}

const max = (a: IsoDate, b: IsoDate): IsoDate => (a > b ? a : b);

/** Effective duration: milestones are always zero. */
function effectiveDuration(activity: ActivityInput): number {
  return activity.type === "milestone" ? 0 : activity.remainingDuration;
}

/** Shift `date` by `lag` working days (negative lag = a lead) on `calendar`. */
function applyLag(date: IsoDate, lag: number, calendar: Calendar): IsoDate {
  return lag >= 0
    ? addWorkingTime(date, lag, calendar)
    : subtractWorkingTime(date, -lag, calendar);
}

/**
 * The ES a single incoming relationship requires of its successor.
 * Lag is measured on the successor's calendar (locked decision).
 */
function esFromRelationship(
  dep: DependencyInput,
  predEarly: EarlyDates,
  successorDuration: number,
  successorCalendar: Calendar,
): IsoDate {
  switch (dep.type) {
    case "FS":
      return applyLag(predEarly.ef, dep.lag, successorCalendar);
    case "SS":
      return applyLag(predEarly.es, dep.lag, successorCalendar);
    case "FF": {
      const efFloor = applyLag(predEarly.ef, dep.lag, successorCalendar);
      return subtractWorkingTime(efFloor, successorDuration, successorCalendar);
    }
    case "SF": {
      const efFloor = applyLag(predEarly.es, dep.lag, successorCalendar);
      return subtractWorkingTime(efFloor, successorDuration, successorCalendar);
    }
  }
}

export function forwardPass(
  input: ScheduleInput,
  graph: ScheduleGraph,
  topoOrder: string[],
): ForwardPassResult {
  const byId = new Map(input.activities.map((a) => [a.id, a]));
  const earlyDates = new Map<string, EarlyDates>();
  const violations: Problem[] = [];

  for (const id of topoOrder) {
    const activity = byId.get(id) as ActivityInput;
    const calendar = resolveCalendar(activity, input.calendars, input.defaultCalendarId);
    const duration = effectiveDuration(activity);
    const progress = resolveProgress(activity, input.dataDate);

    if (progress.status === "complete") {
      earlyDates.set(id, {
        es: progress.pinnedStart as IsoDate,
        ef: progress.pinnedFinish as IsoDate,
      });
      continue;
    }

    // Logic-driven ES: the latest requirement across all incoming relationships.
    let logicEarlyStart = input.projectStart;
    for (const dep of graph.predecessors.get(id) ?? []) {
      const predEarly = earlyDates.get(dep.predecessorId);
      if (!predEarly) continue;
      logicEarlyStart = max(
        logicEarlyStart,
        esFromRelationship(dep, predEarly, duration, calendar),
      );
    }

    if (progress.status === "in_progress") {
      // ES is the actual start; remaining work schedules from the data-date floor.
      const es = progress.pinnedStart as IsoDate;
      let remainingStart = logicEarlyStart;
      if (progress.remainingFloor) remainingStart = max(remainingStart, progress.remainingFloor);
      remainingStart = nextWorkingDay(remainingStart, calendar);
      earlyDates.set(id, {
        es,
        ef: addWorkingTime(remainingStart, progress.remainingDuration, calendar),
      });
      continue;
    }

    // not_started: floor at the data date, apply forward constraints, normalize.
    let es = logicEarlyStart;
    if (progress.remainingFloor) es = max(es, progress.remainingFloor);
    const clamped = applyForwardConstraint(es, duration, activity.constraint, calendar);
    es = nextWorkingDay(clamped.earlyStart, calendar);
    if (clamped.violated) {
      violations.push({
        type: "constraint_violation",
        severity: "warning",
        activityIds: [id],
        message: `Constraint ${activity.constraint?.type} on '${id}' cannot be honored; network logic forces a later start.`,
      });
    }
    earlyDates.set(id, { es, ef: addWorkingTime(es, duration, calendar) });
  }

  let projectFinish = input.projectStart;
  for (const { ef } of earlyDates.values()) projectFinish = max(projectFinish, ef);

  return { earlyDates, projectFinish, violations };
}
