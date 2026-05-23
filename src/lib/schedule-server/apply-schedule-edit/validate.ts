import { z } from "zod";
import type { IntentOp } from "../shared/types";

// Shape-only UUID check. The DB's uuid column is the real validator; zod 4's
// strict v4 check rejects fixture IDs like 11111111-... that Postgres accepts.
const uuid = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  "Expected UUID",
);
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const dur = z.number().int().min(0);

const ActivityTypeEnum  = z.enum(["task", "milestone"]);
const DepTypeEnum       = z.enum(["FS", "SS", "FF", "SF"]);
const ConstraintEnum    = z.enum(["SNET","SNLT","FNET","FNLT","MSO","MFO","ALAP"]);

const createActivity = z.object({
  type: z.literal("createActivity"),
  tempId: z.string().min(1),
  wbsNodeId: uuid,
  name: z.string().min(1),
  activityType: ActivityTypeEnum,
  originalDuration: dur,
  calendarId: uuid.optional(),
});

const softDeleteActivity = z.object({
  type: z.literal("softDeleteActivity"),
  activityId: uuid,
});

const setActivityFields = z.object({
  type: z.literal("setActivityFields"),
  activityId: uuid,
  patch: z.object({
    name: z.string().min(1).optional(),
    originalDuration: dur.optional(),
    remainingDuration: dur.optional(),
    wbsNodeId: uuid.optional(),
    calendarId: uuid.optional(),
    activityType: ActivityTypeEnum.optional(),
    responsiblePartyCompanyId: uuid.nullable().optional(),
  }).refine(p => Object.keys(p).length > 0, "patch must change at least one field"),
});

const setProgress = z.object({
  type: z.literal("setProgress"),
  activityId: uuid,
  percentComplete: z.number().min(0).max(100).optional(),
  actualStart:  iso.optional(),
  actualFinish: iso.optional(),
}).refine(o => o.percentComplete !== undefined || o.actualStart || o.actualFinish,
  "setProgress must change at least one field");

// addDependency's predecessor/successor can be either a real UUID (referencing
// an existing activity) or a tempId string (referencing a createActivity op
// earlier in the same batch). applyOps resolves the tempId -> UUID before the
// engine sees the dep.
const idOrTempId = z.string().min(1);
const addDependency = z.object({
  type: z.literal("addDependency"),
  tempId: z.string().min(1),
  predecessorId: idOrTempId,
  successorId: idOrTempId,
  relType: DepTypeEnum,
  lag: z.number().int(),
}).refine(o => o.predecessorId !== o.successorId, "self-loop not allowed");

const depIdOnly = (tag: string) => z.object({ type: z.literal(tag), dependencyId: uuid });

const setConstraint = z.object({
  type: z.literal("setConstraint"),
  activityId: uuid,
  constraintType: ConstraintEnum,
  date: iso.optional(),
}).refine(o => o.constraintType === "ALAP" || o.date !== undefined,
  "date required for all constraint types except ALAP");

const clearConstraint = z.object({
  type: z.literal("clearConstraint"),
  activityId: uuid,
});

const setProjectDataDate = z.object({
  type: z.literal("setProjectDataDate"),
  dataDate: iso,
});

const opSchema = z.discriminatedUnion("type", [
  createActivity, softDeleteActivity, setActivityFields, setProgress,
  addDependency,
  depIdOnly("deactivateDependency"),
  depIdOnly("reactivateDependency"),
  depIdOnly("softDeleteDependency"),
  setConstraint, clearConstraint, setProjectDataDate,
]);

export type ValidateResult =
  | { ok: true;  ops: IntentOp[] }
  | { ok: false; errors: { path: PropertyKey[]; message: string }[] };

export function validateOps(input: unknown[]): ValidateResult {
  const parsed = z.array(opSchema).safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(i => ({ path: i.path, message: i.message })),
    };
  }
  return { ok: true, ops: parsed.data as IntentOp[] };
}
