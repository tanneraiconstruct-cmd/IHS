import { addWorkingTime, subtractWorkingTime } from "./calendar";
import type { ActivityConstraint, Calendar, IsoDate } from "./types";

export interface ForwardConstraintResult {
  earlyStart: IsoDate;
  /** true when logic forces a start later than an MSO constraint allows. */
  violated: boolean;
}

export interface BackwardConstraintResult {
  lateFinish: IsoDate;
  /** true when logic forces a finish earlier than an MFO constraint allows. */
  violated: boolean;
}

const max = (a: IsoDate, b: IsoDate): IsoDate => (a > b ? a : b);
const min = (a: IsoDate, b: IsoDate): IsoDate => (a < b ? a : b);

/**
 * Clamp a logic-driven ES with a forward constraint (SNET, FNET, MSO).
 * SNLT/FNLT/MFO/ALAP are backward-only and pass through unchanged.
 */
export function applyForwardConstraint(
  logicEarlyStart: IsoDate,
  duration: number,
  constraint: ActivityConstraint | undefined,
  calendar: Calendar,
): ForwardConstraintResult {
  if (!constraint) return { earlyStart: logicEarlyStart, violated: false };
  switch (constraint.type) {
    case "SNET":
      return { earlyStart: max(logicEarlyStart, constraint.date), violated: false };
    case "FNET": {
      const esFloor = subtractWorkingTime(constraint.date, duration, calendar);
      return { earlyStart: max(logicEarlyStart, esFloor), violated: false };
    }
    case "MSO":
      return {
        earlyStart: max(logicEarlyStart, constraint.date),
        violated: logicEarlyStart > constraint.date,
      };
    default:
      return { earlyStart: logicEarlyStart, violated: false };
  }
}

/**
 * Clamp a logic-driven LF with a backward constraint (SNLT, FNLT, MFO).
 * SNET/FNET/ALAP are not backward clamps and pass through unchanged.
 */
export function applyBackwardConstraint(
  logicLateFinish: IsoDate,
  duration: number,
  constraint: ActivityConstraint | undefined,
  calendar: Calendar,
): BackwardConstraintResult {
  if (!constraint) return { lateFinish: logicLateFinish, violated: false };
  switch (constraint.type) {
    case "FNLT":
      return { lateFinish: min(logicLateFinish, constraint.date), violated: false };
    case "SNLT": {
      const lfCeiling = addWorkingTime(constraint.date, duration, calendar);
      return { lateFinish: min(logicLateFinish, lfCeiling), violated: false };
    }
    case "MFO":
      return {
        lateFinish: min(logicLateFinish, constraint.date),
        violated: logicLateFinish < constraint.date,
      };
    default:
      return { lateFinish: logicLateFinish, violated: false };
  }
}
