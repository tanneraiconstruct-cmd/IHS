import { createRouteSupabaseClient } from "@/lib/schedule-server/shared/supabase-client";
import { wouldCreateCycle } from "@/lib/schedule-server/shared/wbs-cycle";

interface CreateBody { project_id: string; parent_id?: string | null; name: string; }
interface PatchBody  { id: string; name?: string; parent_id?: string | null; }
interface DeleteBody { id: string; cascade?: boolean; }

export async function POST(request: Request) {
  const body = await safeJson<CreateBody>(request);
  if (!body || !body.project_id || !body.name) return bad("project_id and name required");
  const client = await createRouteSupabaseClient();
  if (!await authed(client)) return unauth();
  const ins = await client.from("wbs_nodes").insert({
    project_id: body.project_id, parent_id: body.parent_id ?? null, name: body.name,
  }).select().single();
  if (ins.error) return j({ ok: false, error: "INTERNAL", details: ins.error }, 500);
  return j({ ok: true, data: ins.data });
}

export async function PATCH(request: Request) {
  const body = await safeJson<PatchBody>(request);
  if (!body || !body.id) return bad("id required");
  const client = await createRouteSupabaseClient();
  if (!await authed(client)) return unauth();

  if (body.parent_id !== undefined) {
    const node = await client.from("wbs_nodes").select("project_id").eq("id", body.id).single();
    if (node.error) return j({ ok: false, error: "NOT_FOUND" }, 404);
    const all = await client.from("wbs_nodes").select("id, parent_id")
      .eq("project_id", node.data.project_id).is("deleted_at", null);
    if (all.error) return j({ ok: false, error: "INTERNAL" }, 500);
    if (body.parent_id && wouldCreateCycle(all.data, body.id, body.parent_id)) {
      return j({ ok: false, error: "WBS_CYCLE" }, 409);
    }
    await client.from("projects").update({ schedule_dirty_at: new Date().toISOString() })
      .eq("id", node.data.project_id);
  }

  const upd = await client.from("wbs_nodes").update({
    name: body.name, parent_id: body.parent_id,
  }).eq("id", body.id).select().single();
  if (upd.error) return j({ ok: false, error: "INTERNAL", details: upd.error }, 500);
  return j({ ok: true, data: upd.data });
}

export async function DELETE(request: Request) {
  const body = await safeJson<DeleteBody>(request);
  if (!body || !body.id) return bad("id required");
  const client = await createRouteSupabaseClient();
  if (!await authed(client)) return unauth();

  const children = await client.from("wbs_nodes").select("id", { count: "exact", head: true })
    .eq("parent_id", body.id).is("deleted_at", null);
  if ((children.count ?? 0) > 0 && !body.cascade) {
    return j({ ok: false, error: "WBS_HAS_CHILDREN" }, 409);
  }
  const upd = await client.from("wbs_nodes").update({
    deleted_at: new Date().toISOString(),
  }).eq("id", body.id).select().single();
  if (upd.error) return j({ ok: false, error: "INTERNAL", details: upd.error }, 500);
  return j({ ok: true });
}

async function authed(c: Awaited<ReturnType<typeof createRouteSupabaseClient>>) {
  const { data } = await c.auth.getUser(); return !!data.user;
}
async function safeJson<T>(r: Request): Promise<T | null> {
  try { return await r.json() as T; } catch { return null; }
}
function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function bad(m: string) { return j({ ok: false, error: "BAD_REQUEST", details: m }, 400); }
function unauth()       { return j({ ok: false, error: "UNAUTHENTICATED" }, 401); }
