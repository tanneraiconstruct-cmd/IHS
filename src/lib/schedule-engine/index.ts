import { backwardPass } from "./backwardPass";
import { computeFloat } from "./float";
import { forwardPass } from "./forwardPass";
import { buildGraph, detectCycles, topologicalSort } from "./graph";
import type {
  ActivityResult, Problem, ScheduleInput, ScheduleResult,
} from "./types";

export type { ScheduleInput, ScheduleResult, ActivityResult, Problem } from "./types";

const ACTIVITY_TYPES = new Set(["task", "milestone"]);
const DEPENDENCY_TYPES = new Set(["FS", "SS", "FF", "SF"]);
const CONSTRAINT_TYPES = new Set(["SNET", "SNLT", "FNET", "FNLT", "MSO", "MFO", "ALAP"]);

/** Structural checks. Any returned problem is fatal — calculate() stops. */
function validate(input: ScheduleInput): Problem[] {
  const problems: Problem[] = [];
  const add = (message: string, activityIds: string[] = []): void => {
    problems.push({ type: "invalid_input", severity: "error", activityIds, message });
  };

  const calendarIds = new Set(input.calendars.map((c) => c.id));
  if (!calendarIds.has(input.defaultCalendarId)) {
    add(`defaultCalendarId '${input.defaultCalendarId}' is not a defined calendar`);
  }
  const seenCalendarIds = new Set<string>();
  for (const cal of input.calendars) {
    if (seenCalendarIds.has(cal.id)) add(`duplicate calendar id '${cal.id}'`);
    seenCalendarIds.add(cal.id);
    if (cal.workingWeekdays.length === 0) {
      add(`calendar '${cal.id}' has no working weekdays`);
    }
  }

  const activityIds = new Set<string>();
  for (const a of input.activities) {
    if (activityIds.has(a.id)) add(`duplicate activity id '${a.id}'`, [a.id]);
    activityIds.add(a.id);
    if (!ACTIVITY_TYPES.has(a.type)) add(`activity '${a.id}' has an invalid type`, [a.id]);
    if (a.originalDuration < 0 || a.remainingDuration < 0) {
      add(`activity '${a.id}' has a negative duration`, [a.id]);
    }
    if (a.percentComplete !== undefined && (a.percentComplete < 0 || a.percentComplete > 100)) {
      add(`activity '${a.id}' has a percentComplete outside 0-100`, [a.id]);
    }
    if (a.calendarId !== undefined && !calendarIds.has(a.calendarId)) {
      add(`activity '${a.id}' references unknown calendar '${a.calendarId}'`, [a.id]);
    }
    if (a.constraint && !CONSTRAINT_TYPES.has(a.constraint.type)) {
      add(`activity '${a.id}' has an invalid constraint type`, [a.id]);
    }
    const pct = a.percentComplete ?? 0;
    if (pct > 0 && !a.actualStart) {
      add(`activity '${a.id}' is in progress but has no actualStart`, [a.id]);
    }
    if (pct >= 100 && !a.actualFinish) {
      add(`activity '${a.id}' is complete but has no actualFinish`, [a.id]);
    }
  }

  const dependencyIds = new Set<string>();
  for (const d of input.dependencies) {
    if (dependencyIds.has(d.id)) add(`duplicate dependency id '${d.id}'`);
    dependencyIds.add(d.id);
    if (!DEPENDENCY_TYPES.has(d.type)) add(`dependency '${d.id}' has an invalid type`);
    if (!activityIds.has(d.predecessorId)) {
      add(`dependency '${d.id}' references unknown predecessor '${d.predecessorId}'`);
    }
    if (!activityIds.has(d.successorId)) {
      add(`dependency '${d.id}' references unknown successor '${d.successorId}'`);
    }
  }
  return problems;
}

/** Run the CPM pipeline. Always returns a result; never throws for data problems. */
export function calculate(input: ScheduleInput): ScheduleResult {
  const invalid = validate(input);
  if (invalid.length > 0) {
    return { activities: [], projectFinish: null, problems: invalid };
  }

  const graph = buildGraph(input.activities, input.dependencies);

  const cycles = detectCycles(input.activities, graph);
  if (cycles.length > 0) {
    return {
      activities: [],
      projectFinish: null,
      problems: cycles.map((chain) => ({
        type: "cycle" as const,
        severity: "error" as const,
        activityIds: chain,
        message: `Dependency cycle: ${chain.join(" -> ")} -> ${chain[0]}`,
      })),
    };
  }

  const topoOrder = topologicalSort(input.activities, graph);
  const forward = forwardPass(input, graph, topoOrder);
  const backward = backwardPass(input, graph, topoOrder, forward.projectFinish);
  const threshold = input.options?.criticalFloatThreshold ?? 0;
  const float = computeFloat(input, graph, forward.earlyDates, backward.lateDates, threshold);

  const problems: Problem[] = [...forward.violations, ...backward.violations];

  // Open-end warnings: no active predecessor or no active successor.
  for (const a of input.activities) {
    const hasPred = (graph.predecessors.get(a.id) ?? []).length > 0;
    const hasSucc = (graph.successors.get(a.id) ?? []).length > 0;
    if (!hasPred || !hasSucc) {
      problems.push({
        type: "open_end",
        severity: "warning",
        activityIds: [a.id],
        message: `Activity '${a.id}' is open-ended (${!hasPred ? "no predecessor" : ""}${!hasPred && !hasSucc ? ", " : ""}${!hasSucc ? "no successor" : ""}).`,
      });
    }
  }

  const activities: ActivityResult[] = input.activities.map((a) => {
    const early = forward.earlyDates.get(a.id);
    const late = backward.lateDates.get(a.id);
    const f = float.get(a.id);
    if (!early || !late || !f) {
      throw new Error(`internal: missing computed dates for '${a.id}'`);
    }
    const isAlap = a.constraint?.type === "ALAP";
    return {
      id: a.id,
      earlyStart: early.es,
      earlyFinish: early.ef,
      lateStart: late.ls,
      lateFinish: late.lf,
      plannedStart: isAlap ? late.ls : early.es,
      plannedFinish: isAlap ? late.lf : early.ef,
      totalFloat: f.totalFloat,
      freeFloat: f.freeFloat,
      isCritical: f.isCritical,
    };
  });

  return { activities, projectFinish: forward.projectFinish, problems };
}
