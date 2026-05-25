import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { markInflight } from "@/lib/realtime/echo-set";
import type {
  BootstrapData, DbActivity, DbActivityHistory, DbDependency,
} from "@/lib/schedule/types";
import { runRecalc } from "./recalc";
import { useUiStore } from "./ui-store";
import { toast } from "./toasts";

const ACTIVITY_SELECT =
  "id, project_id, wbs_node_id, name, activity_type, original_duration, remaining_duration, " +
  "calendar_id, actual_start, actual_finish, percent_complete, responsible_company_id, " +
  "early_start, early_finish, late_start, late_finish, planned_start, planned_finish, " +
  "total_float, free_float, is_critical, version, deleted_at";

export function applyOptimisticActivityPatch(
  data: BootstrapData,
  id: string,
  patch: Partial<DbActivity>,
): BootstrapData {
  return {
    ...data,
    activities: data.activities.map((a) =>
      a.id === id ? { ...a, ...patch } : a,
    ),
  };
}

export function applyOptimisticDependencyPatch(
  data: BootstrapData,
  id: string,
  patch: Partial<DbDependency>,
): BootstrapData {
  return {
    ...data,
    dependencies: data.dependencies.map((d) =>
      d.id === id ? { ...d, ...patch } : d,
    ),
  };
}

export type PersistResult<T> =
  | { ok: true; row: T }
  | { ok: false; kind: "conflict"; fresh: T }
  | { ok: false; kind: "error"; message: string };

interface PersistInput<T> {
  currentVersion: number;
  performUpdate: () => Promise<{ data: T | null; error: { message: string } | null }>;
  refetchRow: () => Promise<T>;
}

export async function persistVersioned<T>(input: PersistInput<T>): Promise<PersistResult<T>> {
  const first = await input.performUpdate();
  if (first.error) return { ok: false, kind: "error", message: first.error.message };
  if (first.data) return { ok: true, row: first.data };

  // Conflict: refetch and retry once.
  const fresh = await input.refetchRow();
  const second = await input.performUpdate();
  if (second.error) return { ok: false, kind: "error", message: second.error.message };
  if (second.data) return { ok: true, row: second.data };

  return { ok: false, kind: "conflict", fresh };
}

interface HistoryRowInput {
  projectId: string;
  entityType: string;
  entityId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  sessionNote?: string;
}

async function insertHistoryRows(
  sb: SupabaseClient,
  rows: HistoryRowInput[],
  editSessionId: string | null,
  visibility: "internal" | "shared",
  userId: string,
): Promise<void> {
  if (rows.length === 0) return;
  const payload = rows.map<Omit<DbActivityHistory, "id" | "changed_at">>((r) => ({
    project_id: r.projectId,
    edit_session_id: editSessionId,
    entity_type: r.entityType,
    entity_id: r.entityId,
    field: r.field,
    old_value: r.oldValue,
    new_value: r.newValue,
    changed_by: userId,
    visibility,
    session_note: r.sessionNote ?? null,
  }));
  const { error } = await sb.from("activity_history").insert(payload);
  if (error) {
    toast.warn(`History insert failed: ${error.message}`);
  }
}

/**
 * Save activity fields with version check + retry + history + cascade-write of
 * any engine-shifted dates on other activities.
 */
export function useSaveActivity(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["saveActivity", projectId],
    mutationFn: async (vars: { id: string; patch: Partial<DbActivity> }) => {
      const sb = createSupabaseBrowserClient();
      const data = qc.getQueryData<BootstrapData>(["schedule", projectId]);
      if (!data) throw new Error("No schedule cache");
      const current = data.activities.find((a) => a.id === vars.id);
      if (!current) throw new Error("Activity not in cache");

      const optimistic = applyOptimisticActivityPatch(data, vars.id, vars.patch);
      const prevIndexed = runRecalc(data);
      const nextIndexed = runRecalc(optimistic);

      qc.setQueryData(["schedule", projectId], optimistic);

      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error("No user");
      const sessionId = useUiStore.getState().editSessionId;

      const result = await persistVersioned<DbActivity>({
        currentVersion: current.version,
        performUpdate: async () => {
          const res = await sb
            .from("activities")
            .update({ ...vars.patch, version: current.version + 1 })
            .eq("id", vars.id)
            .eq("version", current.version)
            .select(ACTIVITY_SELECT)
            .maybeSingle();
          return { data: res.data as unknown as DbActivity | null, error: res.error };
        },
        refetchRow: async () => {
          const res = await sb
            .from("activities")
            .select(ACTIVITY_SELECT)
            .eq("id", vars.id)
            .single();
          if (res.error || !res.data) throw new Error(res.error?.message ?? "Refetch failed");
          return res.data as unknown as DbActivity;
        },
      });

      if (!result.ok) {
        // Per-row rollback — do NOT restore the full snapshot, which would clobber
        // realtime updates to sibling rows received during the mutation.
        const snapshotRow = current;
        if (result.kind === "conflict") {
          qc.setQueryData(["schedule", projectId], (cur: BootstrapData | undefined) => {
            if (!cur) return cur;
            return {
              ...cur,
              activities: cur.activities.map((a) => a.id === vars.id ? result.fresh : a),
            };
          });
          toast.error("This activity was changed by someone else — your edit was discarded.");
        } else {
          qc.setQueryData(["schedule", projectId], (cur: BootstrapData | undefined) => {
            if (!cur) return cur;
            return {
              ...cur,
              activities: cur.activities.map((a) => a.id === vars.id ? snapshotRow : a),
            };
          });
          toast.error(`Save failed: ${result.message}`);
        }
        return;
      }

      // Cascade: write any activities whose engine-computed dates changed.
      const cascadeUpdates: DbActivity[] = [];
      const historyRows: HistoryRowInput[] = [];

      for (const [, fieldName] of Object.entries(vars.patch).map(
        ([k]) => [k, k] as const,
      )) {
        const oldVal = (current as unknown as Record<string, unknown>)[fieldName] ?? null;
        const newVal = (vars.patch as unknown as Record<string, unknown>)[fieldName] ?? null;
        if (oldVal !== newVal) {
          historyRows.push({
            projectId,
            entityType: "activity",
            entityId: vars.id,
            field: fieldName,
            oldValue: oldVal === null ? null : String(oldVal),
            newValue: newVal === null ? null : String(newVal),
          });
        }
      }

      for (const a of optimistic.activities) {
        if (a.id === vars.id) continue;
        const prev = prevIndexed.byActivity.get(a.id);
        const next = nextIndexed.byActivity.get(a.id);
        if (!prev || !next) continue;
        if (prev.plannedStart !== next.plannedStart || prev.plannedFinish !== next.plannedFinish) {
          cascadeUpdates.push({
            ...a,
            planned_start: next.plannedStart,
            planned_finish: next.plannedFinish,
            early_start: next.earlyStart,
            early_finish: next.earlyFinish,
            late_start: next.lateStart,
            late_finish: next.lateFinish,
            total_float: next.totalFloat,
            free_float: next.freeFloat,
            is_critical: next.isCritical,
          });
          historyRows.push({
            projectId, entityType: "activity", entityId: a.id, field: "planned_start",
            oldValue: prev.plannedStart, newValue: next.plannedStart, sessionNote: "engine_cascade",
          });
          historyRows.push({
            projectId, entityType: "activity", entityId: a.id, field: "planned_finish",
            oldValue: prev.plannedFinish, newValue: next.plannedFinish, sessionNote: "engine_cascade",
          });
        }
      }

      // Cascade writes: per-row update that bumps version so realtime receivers accept the event.
      if (cascadeUpdates.length > 0) {
        const results = await Promise.all(
          cascadeUpdates.map((a) =>
            sb
              .from("activities")
              .update({
                planned_start: a.planned_start,
                planned_finish: a.planned_finish,
                early_start: a.early_start,
                early_finish: a.early_finish,
                late_start: a.late_start,
                late_finish: a.late_finish,
                total_float: a.total_float,
                free_float: a.free_float,
                is_critical: a.is_critical,
                version: a.version + 1,
              })
              .eq("id", a.id),
          ),
        );
        const cascadeErr = results.find((r) => r.error)?.error;
        if (cascadeErr) toast.warn(`Cascade write failed: ${cascadeErr.message}`);
      }

      // Replace the row in cache with the authoritative result.
      qc.setQueryData(["schedule", projectId], (prev: BootstrapData | undefined) => {
        if (!prev) return prev;
        return {
          ...prev,
          activities: prev.activities.map((a) => (a.id === vars.id ? result.row : a)),
        };
      });

      // Write history rows last so a write failure doesn't roll back the save.
      const visibility = data.project.comment_visibility_default === "shared" ? "shared" : "internal";
      await insertHistoryRows(sb, historyRows, sessionId, visibility, user.id);
    },
  });
}

export function useInsertDependency(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["insertDependency", projectId],
    mutationFn: async (vars: { predecessorId: string; successorId: string; type: DbDependency["type"]; lag: number }) => {
      const sb = createSupabaseBrowserClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error("No user");

      const { data, error } = await sb
        .from("dependencies")
        .insert({
          project_id: projectId,
          predecessor_id: vars.predecessorId,
          successor_id: vars.successorId,
          type: vars.type,
          lag: vars.lag,
          is_active: true,
        })
        .select("id, project_id, predecessor_id, successor_id, type, lag, is_active, deleted_at")
        .single();

      if (error || !data) {
        toast.error(`Insert dependency failed: ${error?.message ?? "unknown"}`);
        return;
      }

      qc.setQueryData(["schedule", projectId], (prev: BootstrapData | undefined) => {
        if (!prev) return prev;
        return { ...prev, dependencies: [...prev.dependencies, data as unknown as DbDependency] };
      });
      markInflight(data.id);

      const sessionId = useUiStore.getState().editSessionId;
      await insertHistoryRows(
        sb,
        [{
          projectId, entityType: "dependency", entityId: data.id, field: "created",
          oldValue: null, newValue: `${vars.predecessorId}→${vars.successorId} ${vars.type}+${vars.lag}`,
        }],
        sessionId,
        "shared",
        user.id,
      );
    },
  });
}

export function useDeleteActivity(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["deleteActivity", projectId],
    mutationFn: async (id: string) => {
      const sb = createSupabaseBrowserClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error("No user");
      const now = new Date().toISOString();
      const { error } = await sb.from("activities").update({ deleted_at: now }).eq("id", id);
      if (error) {
        toast.error(`Delete failed: ${error.message}`);
        return;
      }
      qc.setQueryData(["schedule", projectId], (prev: BootstrapData | undefined) => {
        if (!prev) return prev;
        return {
          ...prev,
          activities: prev.activities.map((a) =>
            a.id === id ? { ...a, deleted_at: now } : a,
          ),
        };
      });
      const sessionId = useUiStore.getState().editSessionId;
      await insertHistoryRows(
        sb,
        [{ projectId, entityType: "activity", entityId: id, field: "deleted_at", oldValue: null, newValue: now }],
        sessionId, "shared", user.id,
      );
    },
  });
}

export function useToggleDependencyActive(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["toggleDep", projectId],
    mutationFn: async (id: string) => {
      const sb = createSupabaseBrowserClient();
      const data = qc.getQueryData<BootstrapData>(["schedule", projectId]);
      if (!data) return;
      const dep = data.dependencies.find((d) => d.id === id);
      if (!dep) return;
      const next = !dep.is_active;

      qc.setQueryData(["schedule", projectId],
        applyOptimisticDependencyPatch(data, id, { is_active: next }));

      const { error } = await sb.from("dependencies").update({ is_active: next }).eq("id", id);
      if (error) {
        qc.setQueryData(["schedule", projectId], (cur: BootstrapData | undefined) => {
          if (!cur) return cur;
          return {
            ...cur,
            dependencies: cur.dependencies.map((d) => d.id === id ? dep : d),
          };
        });
        toast.error(`Toggle failed: ${error.message}`);
        return;
      }

      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const sessionId = useUiStore.getState().editSessionId;
      await insertHistoryRows(
        sb,
        [{ projectId, entityType: "dependency", entityId: id, field: "is_active", oldValue: String(!next), newValue: String(next) }],
        sessionId, "shared", user.id,
      );
    },
  });
}

export function usePostComment(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["postComment", projectId],
    mutationFn: async (vars: {
      body: string;
      scope: "project" | "activity";
      targetActivityId: string | null;
      visibility: "internal" | "shared";
    }) => {
      const sb = createSupabaseBrowserClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error("No user");
      const { data, error } = await sb
        .from("comments")
        .insert({
          project_id: projectId,
          author_user_id: user.id,
          body: vars.body,
          scope: vars.scope,
          target_activity_id: vars.targetActivityId,
          visibility: vars.visibility,
        })
        .select("id, project_id, author_user_id, body, parent_comment_id, scope, target_activity_id, visibility, created_at, edited_at, deleted_at")
        .single();
      if (error || !data) {
        toast.error(`Comment failed: ${error?.message ?? "unknown"}`);
        return;
      }
      qc.setQueryData(["schedule", projectId], (prev: BootstrapData | undefined) => {
        if (!prev) return prev;
        return { ...prev, comments: [data as never, ...prev.comments] };
      });
      markInflight(data.id);
    },
  });
}

export function useUpdateComment(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["updateComment", projectId],
    mutationFn: async (vars: { commentId: string; body: string }) => {
      const sb = createSupabaseBrowserClient();
      const data = qc.getQueryData<BootstrapData>(["schedule", projectId]);
      const prev = data?.comments.find((c) => c.id === vars.commentId);
      if (!data || !prev) {
        toast.error("Comment not in cache");
        return;
      }

      const editedAt = new Date().toISOString();

      // Optimistic patch.
      qc.setQueryData(["schedule", projectId], (cur: BootstrapData | undefined) => {
        if (!cur) return cur;
        return {
          ...cur,
          comments: cur.comments.map((c) =>
            c.id === vars.commentId ? { ...c, body: vars.body, edited_at: editedAt } : c),
        };
      });
      markInflight(vars.commentId);

      const { data: updated, error } = await sb
        .from("comments")
        .update({ body: vars.body, edited_at: editedAt })
        .eq("id", vars.commentId)
        .select("id, project_id, author_user_id, body, parent_comment_id, scope, target_activity_id, visibility, created_at, edited_at, deleted_at")
        .single();

      if (error || !updated) {
        // Rollback.
        qc.setQueryData(["schedule", projectId], (cur: BootstrapData | undefined) => {
          if (!cur) return cur;
          return {
            ...cur,
            comments: cur.comments.map((c) => c.id === vars.commentId ? prev : c),
          };
        });
        toast.error(`Comment edit failed: ${error?.message ?? "unknown"}`);
        return;
      }

      // Replace with authoritative row.
      qc.setQueryData(["schedule", projectId], (cur: BootstrapData | undefined) => {
        if (!cur) return cur;
        return {
          ...cur,
          comments: cur.comments.map((c) => c.id === vars.commentId ? (updated as unknown as typeof c) : c),
        };
      });
    },
  });
}
