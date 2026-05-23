import { randomUUID } from "node:crypto";
import type { IntentOp } from "../shared/types";
import type { ScheduleInput, ActivityInput, DependencyInput }
  from "@/lib/schedule-engine/types";

export interface ApplyOpsResult {
  input: ScheduleInput;
  tempIdMap: Record<string, string>;
  softDeleted: { activityIds: string[]; dependencyIds: string[] };
  projectPatch: { data_date?: string };
}

export function applyOps(input: ScheduleInput, ops: IntentOp[]): ApplyOpsResult {
  const activities = input.activities.map(a => ({ ...a }));
  const dependencies = input.dependencies.map(d => ({ ...d }));
  const tempIdMap: Record<string, string> = {};
  const softDeletedActivities: string[] = [];
  const softDeletedDeps: string[] = [];
  let dataDate = input.dataDate;

  const idx = <T extends { id: string }>(arr: T[], id: string) =>
    arr.findIndex(x => x.id === id);

  for (const op of ops) {
    switch (op.type) {
      case "createActivity": {
        const id = randomUUID();
        tempIdMap[op.tempId] = id;
        const a: ActivityInput = {
          id,
          type: op.activityType === "milestone" ? "milestone" : "task",
          originalDuration: op.originalDuration,
          remainingDuration: op.originalDuration,
          calendarId: op.calendarId,
        };
        activities.push(a);
        break;
      }
      case "softDeleteActivity": {
        const i = idx(activities, op.activityId);
        if (i >= 0) {
          softDeletedActivities.push(op.activityId);
          activities.splice(i, 1);
        }
        for (let j = dependencies.length - 1; j >= 0; j--) {
          const d = dependencies[j];
          if (d.predecessorId === op.activityId || d.successorId === op.activityId) {
            softDeletedDeps.push(d.id);
            dependencies.splice(j, 1);
          }
        }
        break;
      }
      case "setActivityFields": {
        const i = idx(activities, op.activityId);
        if (i < 0) throw new Error(`activity not found: ${op.activityId}`);
        const a = activities[i];
        const p = op.patch;
        if (p.originalDuration  !== undefined) a.originalDuration  = p.originalDuration;
        if (p.remainingDuration !== undefined) a.remainingDuration = p.remainingDuration;
        if (p.calendarId        !== undefined) a.calendarId        = p.calendarId;
        if (p.activityType      !== undefined)
          a.type = p.activityType === "milestone" ? "milestone" : "task";
        break;
      }
      case "setProgress": {
        const i = idx(activities, op.activityId);
        if (i < 0) throw new Error(`activity not found: ${op.activityId}`);
        const a = activities[i];
        if (op.percentComplete !== undefined) a.percentComplete = op.percentComplete;
        if (op.actualStart  !== undefined) a.actualStart  = op.actualStart;
        if (op.actualFinish !== undefined) a.actualFinish = op.actualFinish;
        break;
      }
      case "addDependency": {
        const id = randomUUID();
        tempIdMap[op.tempId] = id;
        const predecessorId = tempIdMap[op.predecessorId] ?? op.predecessorId;
        const successorId   = tempIdMap[op.successorId]   ?? op.successorId;
        const d: DependencyInput = {
          id,
          predecessorId, successorId,
          type: op.relType, lag: op.lag, isActive: true,
        };
        dependencies.push(d);
        break;
      }
      case "deactivateDependency": {
        const i = idx(dependencies, op.dependencyId);
        if (i >= 0) dependencies[i].isActive = false;
        break;
      }
      case "reactivateDependency": {
        const i = idx(dependencies, op.dependencyId);
        if (i >= 0) dependencies[i].isActive = true;
        break;
      }
      case "softDeleteDependency": {
        const i = idx(dependencies, op.dependencyId);
        if (i >= 0) {
          softDeletedDeps.push(op.dependencyId);
          dependencies.splice(i, 1);
        }
        break;
      }
      case "setConstraint": {
        const i = idx(activities, op.activityId);
        if (i < 0) throw new Error(`activity not found: ${op.activityId}`);
        activities[i] = {
          ...activities[i],
          constraint: { type: op.constraintType, date: op.date ?? "" },
        };
        break;
      }
      case "clearConstraint": {
        const i = idx(activities, op.activityId);
        if (i < 0) throw new Error(`activity not found: ${op.activityId}`);
        const a = { ...activities[i] };
        delete a.constraint;
        activities[i] = a;
        break;
      }
      case "setProjectDataDate":
        dataDate = op.dataDate;
        break;
    }
  }

  return {
    input: { ...input, activities, dependencies, dataDate },
    tempIdMap,
    softDeleted: { activityIds: softDeletedActivities, dependencyIds: softDeletedDeps },
    projectPatch: dataDate !== input.dataDate ? { data_date: dataDate ?? undefined } : {},
  };
}
