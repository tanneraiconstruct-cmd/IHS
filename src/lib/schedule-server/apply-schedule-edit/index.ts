import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApplyScheduleEditResponse, IntentOp } from "../shared/types";
import { err, sqlstateToErrorCode } from "../shared/errors";
import { calculate } from "@/lib/schedule-engine";
import { validateOps } from "./validate";
import { rowsToScheduleInput } from "./load-snapshot";
import { applyOps } from "./apply-ops";
import { buildPayload } from "./build-payload";
import { callApplyScheduleEdit } from "../shared/rpc-client";

export interface ApplyScheduleEditArgs {
  client: SupabaseClient;
  projectId: string;
  editSessionId: string;
  actingUserId: string;
  requestId?: string;
  ops: unknown[];
}

export async function applyScheduleEdit(
  a: ApplyScheduleEditArgs,
): Promise<ApplyScheduleEditResponse> {
  const v = validateOps(a.ops);
  if (!v.ok) return err("VALIDATION_FAILED", v.errors);

  const snapshot = await loadProjectSnapshot(a.client, a.projectId);
  if (!snapshot.ok) return err(snapshot.error);
  const { input, baseVersions, raw } = snapshot.data;

  const applied = applyOps(input, v.ops as IntentOp[]);

  const preEngineActivities = raw.activities.map(r => ({
    id: r.id,
    original_duration: r.original_duration,
    planned_start: r.planned_start ?? null,
    planned_finish: r.planned_finish ?? null,
  }));
  const originalActivityInputs = Object.fromEntries(
    raw.activities.map(r => [r.id, {
      name: r.name,
      wbs_node_id: r.wbs_node_id,
      activity_type: r.activity_type,
    }]),
  );

  const result = calculate(applied.input);
  const hasCycle = result.problems.some(p => p.type === "cycle");
  if (hasCycle) return err("ENGINE_CYCLE", { problems: result.problems });

  const built = buildPayload({
    projectId: a.projectId,
    editSessionId: a.editSessionId,
    actingUserId: a.actingUserId,
    requestId: a.requestId ?? randomUUID(),
    ops: v.ops as IntentOp[],
    tempIdMap: applied.tempIdMap,
    preEngineActivities,
    postEngineActivities: result.activities,
    preEngineDependencies: raw.dependencies.map(d => ({
      id: d.id, is_active: d.is_active, lag: d.lag, type: d.type,
    })),
    preEngineConstraints: raw.activity_constraints.map(c => ({
      activity_id: c.activity_id, type: c.type, constraint_date: c.constraint_date,
    })),
    baseVersions,
    softDeleted: applied.softDeleted,
    projectPatch: applied.projectPatch,
    engineProblems: result.problems,
    originalActivityInputs,
  });

  const r = await callApplyScheduleEdit(a.client, built.payload);
  if (r.rpcError) {
    const code = sqlstateToErrorCode(r.rpcError.code);
    return err(code, r.rpcError.message);
  }
  const body = r.result as Record<string, unknown>;
  if (body.ok === false) {
    return err((body.error as never) ?? "INTERNAL", body);
  }
  return { ok: true, data: body.data as ApplyScheduleEditResponse extends { ok: true; data: infer D } ? D : never };
}

async function loadProjectSnapshot(client: SupabaseClient, projectId: string) {
  const [proj, cals, calExc, acts, deps, cons] = await Promise.all([
    client.from("projects").select("*").eq("id", projectId).single(),
    client.from("calendars").select("*").eq("project_id", projectId),
    client.from("calendar_exceptions").select("*"),
    client.from("activities").select("*").eq("project_id", projectId),
    client.from("dependencies").select("*").eq("project_id", projectId),
    client.from("activity_constraints").select("*"),
  ]);
  for (const r of [proj, cals, calExc, acts, deps, cons]) {
    if (r.error) return { ok: false as const, error: "INTERNAL" as const };
  }
  return {
    ok: true as const,
    data: rowsToScheduleInput({
      project: proj.data!,
      calendars: cals.data ?? [],
      calendar_exceptions: calExc.data ?? [],
      activities: acts.data ?? [],
      dependencies: deps.data ?? [],
      activity_constraints: cons.data ?? [],
    }),
  };
}
