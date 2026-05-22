import { resolveCalendar, workingTimeBetween } from "./calendar";
import type { LateDates } from "./backwardPass";
import type { EarlyDates } from "./forwardPass";
import type { ScheduleGraph } from "./graph";
import type { Calendar, DependencyInput, IsoDate, ScheduleInput } from "./types";

export interface ActivityFloat {
  totalFloat: number;
  freeFloat: number;
  isCritical: boolean;
}

/** Signed working days from `from` to `to`: negative when `to` is earlier. */
function signedWorkingDays(from: IsoDate, to: IsoDate, calendar: Calendar): number {
  return from <= to
    ? workingTimeBetween(from, to, calendar)
    : -workingTimeBetween(to, from, calendar);
}

/** Slack a single relationship leaves before it would delay the successor. */
function freeFloatContribution(
  dep: DependencyInput,
  predEarly: EarlyDates,
  succEarly: EarlyDates,
  calendar: Calendar,
): number {
  switch (dep.type) {
    case "FS":
      return signedWorkingDays(predEarly.ef, succEarly.es, calendar) - dep.lag;
    case "SS":
      return signedWorkingDays(predEarly.es, succEarly.es, calendar) - dep.lag;
    case "FF":
      return signedWorkingDays(predEarly.ef, succEarly.ef, calendar) - dep.lag;
    case "SF":
      return signedWorkingDays(predEarly.es, succEarly.ef, calendar) - dep.lag;
  }
}

export function computeFloat(
  input: ScheduleInput,
  graph: ScheduleGraph,
  earlyDates: Map<string, EarlyDates>,
  lateDates: Map<string, LateDates>,
  criticalFloatThreshold: number,
): Map<string, ActivityFloat> {
  const result = new Map<string, ActivityFloat>();

  for (const activity of input.activities) {
    const calendar = resolveCalendar(activity, input.calendars, input.defaultCalendarId);
    const early = earlyDates.get(activity.id) as EarlyDates;
    const late = lateDates.get(activity.id) as LateDates;

    const totalFloat = signedWorkingDays(early.es, late.ls, calendar);

    const outgoing = graph.successors.get(activity.id) ?? [];
    let freeFloat = totalFloat;
    if (outgoing.length > 0) {
      freeFloat = Math.min(
        ...outgoing.map((dep) =>
          freeFloatContribution(
            dep, early, earlyDates.get(dep.successorId) as EarlyDates, calendar,
          ),
        ),
      );
    }

    result.set(activity.id, {
      totalFloat,
      freeFloat,
      isCritical: totalFloat <= criticalFloatThreshold,
    });
  }
  return result;
}
