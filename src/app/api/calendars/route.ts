import { createRouteSupabaseClient } from "@/lib/schedule-server/shared/supabase-client";

interface CreateBody { project_id: string; name: string; working_weekdays?: number[]; is_default?: boolean; }
interface PatchBody  { id: string; name?: string; working_weekdays?: number[]; }
interface DeleteBody { id: string; }

export async function POST(request: Request) {
  const body = await safeJson<CreateBody>(request);
  if (!body || !body.project_id || !body.name) return bad("project_id and name required");
  const client = await createRouteSupabaseClient();
  if (!await isAuthed(client)) return unauth();
  const ins = await client.from("calendars").insert({
    project_id: body.project_id, name: body.name,
    working_weekdays: body.working_weekdays ?? [1,2,3,4,5],
    is_default: body.is_default ?? false,
  }).select().single();
  if (ins.error) return j({ ok: false, error: "INTERNAL", details: ins.error }, 500);
  await markDirty(client, body.project_id);
  return j({ ok: true, data: ins.data });
}

export async function PATCH(request: Request) {
  const body = await safeJson<PatchBody>(request);
  if (!body || !body.id) return bad("id required");
  const client = await createRouteSupabaseClient();
  if (!await isAuthed(client)) return unauth();
  const upd = await client.from("calendars").update({
    name: body.name, working_weekdays: body.working_weekdays,
  }).eq("id", body.id).select().single();
  if (upd.error) return j({ ok: false, error: "INTERNAL", details: upd.error }, 500);
  await markDirty(client, upd.data.project_id);
  return j({ ok: true, data: upd.data });
}

export async function DELETE(request: Request) {
  const body = await safeJson<DeleteBody>(request);
  if (!body || !body.id) return bad("id required");
  const client = await createRouteSupabaseClient();
  if (!await isAuthed(client)) return unauth();
  const refs = await client.from("activities").select("id", { count: "exact", head: true })
    .eq("calendar_id", body.id);
  if ((refs.count ?? 0) > 0) return j({ ok: false, error: "CALENDAR_IN_USE" }, 409);
  const del = await client.from("calendars").delete().eq("id", body.id).select().single();
  if (del.error) return j({ ok: false, error: "INTERNAL", details: del.error }, 500);
  await markDirty(client, del.data.project_id);
  return j({ ok: true });
}

async function isAuthed(c: Awaited<ReturnType<typeof createRouteSupabaseClient>>) {
  const { data } = await c.auth.getUser(); return !!data.user;
}
async function markDirty(c: Awaited<ReturnType<typeof createRouteSupabaseClient>>, projectId: string) {
  await c.from("projects").update({ schedule_dirty_at: new Date().toISOString() })
    .eq("id", projectId);
}
async function safeJson<T>(r: Request): Promise<T | null> {
  try { return await r.json() as T; } catch { return null; }
}
function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function bad(msg: string)   { return j({ ok: false, error: "BAD_REQUEST", details: msg }, 400); }
function unauth()           { return j({ ok: false, error: "UNAUTHENTICATED" }, 401); }
