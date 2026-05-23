import type {
  ScheduleInput, ActivityInput, DependencyInput,
  Calendar, CalendarException, ActivityConstraint,
} from "@/lib/schedule-engine/types";

interface DbProject {
  id: string;
  project_start: string;
  data_date: string | null;
  default_calendar_id: string;
  critical_float_threshold: number;
  version?: number;
}
interface DbCalendar { id: string; working_weekdays: number[]; version?: number; }
interface DbCalendarException { calendar_id: string; exception_date: string; working: boolean; }
interface DbActivity {
  id: string; activity_type: string;
  name: string; wbs_node_id: string;
  original_duration: number; remaining_duration: number;
  calendar_id: string | null;
  actual_start: string | null; actual_finish: string | null;
  percent_complete: number;
  planned_start: string | null; planned_finish: string | null;
  deleted_at: string | null;
  version?: number;
}
interface DbDependency {
  id: string; predecessor_id: string; successor_id: string;
  type: "FS"|"SS"|"FF"|"SF"; lag: number; is_active: boolean;
  deleted_at: string | null;
  version?: number;
}
interface DbConstraint {
  activity_id: string; type: string; constraint_date: string | null;
  version?: number;
}

export interface SnapshotInput {
  project: DbProject;
  calendars: DbCalendar[];
  calendar_exceptions: DbCalendarException[];
  activities: DbActivity[];
  dependencies: DbDependency[];
  activity_constraints: DbConstraint[];
}

export interface SnapshotResult {
  input: ScheduleInput;
  baseVersions: {
    project_version: number;
    activities: Record<string, number>;
    dependencies: Record<string, number>;
    constraints: Record<string, number>;
  };
  raw: SnapshotInput;
}

export function rowsToScheduleInput(s: SnapshotInput): SnapshotResult {
  const exceptionsByCal = new Map<string, CalendarException[]>();
  for (const e of s.calendar_exceptions) {
    const arr = exceptionsByCal.get(e.calendar_id) ?? [];
    arr.push({ date: e.exception_date, working: e.working });
    exceptionsByCal.set(e.calendar_id, arr);
  }

  const calendars: Calendar[] = s.calendars.map(c => ({
    id: c.id,
    workingWeekdays: c.working_weekdays,
    exceptions: exceptionsByCal.get(c.id) ?? [],
  }));

  const constraintsByActivity = new Map<string, ActivityConstraint>();
  for (const c of s.activity_constraints) {
    constraintsByActivity.set(c.activity_id, {
      type: c.type as ActivityConstraint["type"],
      date: c.constraint_date ?? "",
    });
  }

  const activities: ActivityInput[] = s.activities
    .filter(a => a.deleted_at === null)
    .map(a => ({
      id: a.id,
      type: a.activity_type === "milestone" ? "milestone" : "task",
      originalDuration: a.original_duration,
      remainingDuration: a.remaining_duration,
      calendarId: a.calendar_id ?? undefined,
      actualStart: a.actual_start ?? undefined,
      actualFinish: a.actual_finish ?? undefined,
      percentComplete: a.percent_complete,
      constraint: constraintsByActivity.get(a.id),
    }));

  const liveIds = new Set(activities.map(a => a.id));
  const dependencies: DependencyInput[] = s.dependencies
    .filter(d => d.deleted_at === null
                  && liveIds.has(d.predecessor_id) && liveIds.has(d.successor_id))
    .map(d => ({
      id: d.id,
      predecessorId: d.predecessor_id,
      successorId: d.successor_id,
      type: d.type,
      lag: d.lag,
      isActive: d.is_active,
    }));

  const input: ScheduleInput = {
    projectStart: s.project.project_start,
    dataDate: s.project.data_date,
    defaultCalendarId: s.project.default_calendar_id,
    calendars,
    activities,
    dependencies,
    options: { criticalFloatThreshold: s.project.critical_float_threshold },
  };

  const baseVersions = {
    project_version: s.project.version ?? 1,
    activities:   Object.fromEntries(s.activities.map(a => [a.id, a.version ?? 1])),
    dependencies: Object.fromEntries(s.dependencies.map(d => [d.id, d.version ?? 1])),
    constraints:  Object.fromEntries(s.activity_constraints.map(c => [c.activity_id, c.version ?? 1])),
  };

  return { input, baseVersions, raw: s };
}
