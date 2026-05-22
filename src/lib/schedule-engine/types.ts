/** ISO calendar date, 'YYYY-MM-DD'. Compares chronologically as a string. */
export type IsoDate = string;

export type ActivityType = "task" | "milestone";
export type DependencyType = "FS" | "SS" | "FF" | "SF";
export type ConstraintType =
  | "SNET" | "SNLT" | "FNET" | "FNLT" | "MSO" | "MFO" | "ALAP";

export interface CalendarException {
  /** The specific date this exception applies to. */
  date: IsoDate;
  /** true = a working day despite the weekday rule; false = a non-working day. */
  working: boolean;
}

export interface Calendar {
  id: string;
  /** Working weekdays as JS getUTCDay values: 0 = Sunday ... 6 = Saturday. */
  workingWeekdays: number[];
  exceptions: CalendarException[];
}

export interface ActivityConstraint {
  type: ConstraintType;
  /** Ignored for ALAP. */
  date: IsoDate;
}

export interface ActivityInput {
  id: string;
  type: ActivityType;
  /** Working days, >= 0. */
  originalDuration: number;
  /** Working days, >= 0. Milestones are treated as 0 regardless. */
  remainingDuration: number;
  /** Overrides the project default calendar when set. */
  calendarId?: string;
  actualStart?: IsoDate;
  actualFinish?: IsoDate;
  /** 0-100. Absent means 0. */
  percentComplete?: number;
  /** At most one constraint per activity in v1. */
  constraint?: ActivityConstraint;
}

export interface DependencyInput {
  id: string;
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  /** Working days, may be negative (a lead). Measured on the successor's calendar. */
  lag: number;
  /** Inactive dependencies are ignored for logic. */
  isActive: boolean;
}

export interface ScheduleOptions {
  /** isCritical = totalFloat <= this. Default 0. */
  criticalFloatThreshold?: number;
}

export interface ScheduleInput {
  projectStart: IsoDate;
  /** null = the project has not started; pure forecast. */
  dataDate: IsoDate | null;
  defaultCalendarId: string;
  calendars: Calendar[];
  activities: ActivityInput[];
  dependencies: DependencyInput[];
  options?: ScheduleOptions;
}

export interface ActivityResult {
  id: string;
  earlyStart: IsoDate;
  earlyFinish: IsoDate;
  lateStart: IsoDate;
  lateFinish: IsoDate;
  /** The dates the Gantt draws. ES/EF normally; LS/LF for ALAP activities. */
  plannedStart: IsoDate;
  plannedFinish: IsoDate;
  /** Working days. May be negative. */
  totalFloat: number;
  freeFloat: number;
  isCritical: boolean;
}

export type ProblemType =
  | "invalid_input" | "cycle" | "constraint_violation" | "open_end";
export type ProblemSeverity = "error" | "warning";

export interface Problem {
  type: ProblemType;
  severity: ProblemSeverity;
  /** The activities involved (predecessor/successor ids, the looped chain, etc.). */
  activityIds: string[];
  message: string;
}

export interface ScheduleResult {
  activities: ActivityResult[];
  /** null when the schedule is unsolvable (invalid input or a cycle). */
  projectFinish: IsoDate | null;
  problems: Problem[];
}

/** WBS tree node for rollup. Not part of calculate(). */
export interface WbsNode {
  id: string;
  parentId: string | null;
  /** Activities attached directly to this node. */
  activityIds: string[];
}

export interface WbsRollup {
  nodeId: string;
  start: IsoDate | null;
  finish: IsoDate | null;
  /** Duration-weighted, 0-100. */
  percentComplete: number;
}
