import type { ActivityInput, IsoDate } from "./types";

export type ProgressStatus = "complete" | "in_progress" | "not_started";

export interface ProgressResolution {
  status: ProgressStatus;
  /** complete & in_progress: ES is pinned to this actual start. */
  pinnedStart?: IsoDate;
  /** complete: EF is pinned to this actual finish. */
  pinnedFinish?: IsoDate;
  /**
   * in_progress & not_started: the earliest the remaining work may begin
   * (the data date). null when the project has not started.
   */
  remainingFloor: IsoDate | null;
  /** Working days of remaining work to schedule. */
  remainingDuration: number;
}

/**
 * Resolve how the forward pass should treat an activity, given the data date.
 * Complete = percentComplete 100; in-progress = strictly between 0 and 100;
 * everything else is not-started.
 */
export function resolveProgress(
  activity: ActivityInput,
  dataDate: IsoDate | null,
): ProgressResolution {
  const pct = activity.percentComplete ?? 0;
  if (pct >= 100) {
    return {
      status: "complete",
      pinnedStart: activity.actualStart,
      pinnedFinish: activity.actualFinish,
      remainingFloor: dataDate,
      remainingDuration: 0,
    };
  }
  if (pct > 0) {
    return {
      status: "in_progress",
      pinnedStart: activity.actualStart,
      remainingFloor: dataDate,
      remainingDuration: activity.remainingDuration,
    };
  }
  return {
    status: "not_started",
    remainingFloor: dataDate,
    remainingDuration: activity.remainingDuration,
  };
}
