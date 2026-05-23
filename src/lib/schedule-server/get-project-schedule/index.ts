import type { SupabaseClient } from "@supabase/supabase-js";

export async function getProjectSchedule(client: SupabaseClient, projectId: string) {
  const [proj, cals, calExc, wbs, acts, deps, cons, res, ras] = await Promise.all([
    client.from("projects").select("*").eq("id", projectId).single(),
    client.from("calendars").select("*").eq("project_id", projectId),
    client.from("calendar_exceptions").select("*"),
    client.from("wbs_nodes").select("*").eq("project_id", projectId),
    client.from("activities").select("*").eq("project_id", projectId).is("deleted_at", null),
    client.from("dependencies").select("*").eq("project_id", projectId).is("deleted_at", null),
    client.from("activity_constraints").select("*"),
    client.from("resources").select("*").eq("project_id", projectId).is("deleted_at", null),
    client.from("resource_assignments").select("*").is("deleted_at", null),
  ]);
  for (const r of [proj, cals, calExc, wbs, acts, deps, cons, res, ras]) {
    if (r.error) return { ok: false as const, error: "INTERNAL" as const, details: r.error };
  }
  return {
    ok: true as const,
    data: {
      project: proj.data!,
      calendars: cals.data ?? [],
      calendar_exceptions: calExc.data ?? [],
      wbs_nodes: wbs.data ?? [],
      activities: acts.data ?? [],
      dependencies: deps.data ?? [],
      constraints: cons.data ?? [],
      resources: res.data ?? [],
      resource_assignments: ras.data ?? [],
      stale: !!(proj.data?.schedule_dirty_at),
    },
  };
}
