import type { ScheduleInput, ScheduleResult } from "@/lib/schedule-engine";
import { calculate } from "@/lib/schedule-engine";
import type {
  BootstrapData,
  DbActivity,
  DbActivityConstraint,
  DbCalendar,
  DbCalendarException,
  DbDependency,
  IndexedResult,
} from "@/lib/schedule/types";

function toEngineCalendar(
  c: DbCalendar,
  exceptions: DbCalendarException[],
): ScheduleInput["calendars"][number] {
  return {
    id: c.id,
    workingWeekdays: c.working_weekdays,
    exceptions: exceptions
      .filter((ex) => ex.calendar_id === c.id)
      .map((ex) => ({ date: ex.exception_date, working: ex.working })),
  };
}

function toEngineActivity(
  a: DbActivity,
  constraintsByActivity: Map<string, DbActivityConstraint>,
): ScheduleInput["activities"][number] {
  const c = constraintsByActivity.get(a.id);
  return {
    id: a.id,
    type: a.activity_type === "milestone" ? "milestone" : "task",
    originalDuration: a.original_duration,
    remainingDuration: a.remaining_duration,
    calendarId: a.calendar_id ?? undefined,
    actualStart: a.actual_start ?? undefined,
    actualFinish: a.actual_finish ?? undefined,
    percentComplete: a.percent_complete,
    constraint: c
      ? {
          type: c.type,
          date: c.constraint_date ?? "1970-01-01",
        }
      : undefined,
  };
}

function toEngineDependency(d: DbDependency): ScheduleInput["dependencies"][number] {
  return {
    id: d.id,
    predecessorId: d.predecessor_id,
    successorId: d.successor_id,
    type: d.type,
    lag: d.lag,
    isActive: d.is_active,
  };
}

export function buildEngineInput(data: BootstrapData): ScheduleInput {
  const aliveActivities = data.activities.filter(
    (a) =>
      a.deleted_at === null &&
      (a.activity_type === "task" || a.activity_type === "milestone"),
  );
  const aliveDeps = data.dependencies.filter((d) => d.deleted_at === null);
  const consByActivity = new Map<string, DbActivityConstraint>(
    data.constraints.map((c) => [c.activity_id, c]),
  );

  return {
    projectStart: data.project.project_start,
    dataDate: data.project.data_date,
    defaultCalendarId: data.project.default_calendar_id,
    calendars: data.calendars.map((c) => toEngineCalendar(c, data.calendarExceptions)),
    activities: aliveActivities.map((a) => toEngineActivity(a, consByActivity)),
    dependencies: aliveDeps.map(toEngineDependency),
    options: { criticalFloatThreshold: data.project.critical_float_threshold },
  };
}

export function indexResult(result: ScheduleResult): IndexedResult {
  return {
    byActivity: new Map(result.activities.map((a) => [a.id, a])),
    projectFinish: result.projectFinish,
    problems: result.problems,
  };
}

/** Convenience: build input + run engine + index in one call. */
export function runRecalc(data: BootstrapData): IndexedResult {
  return indexResult(calculate(buildEngineInput(data)));
}
