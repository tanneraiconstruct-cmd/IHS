import { createRouteSupabaseClient } from "@/lib/schedule-server/shared/supabase-client";
import { getProjectSchedule } from "@/lib/schedule-server/get-project-schedule";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const client = await createRouteSupabaseClient();
  const { data: userData } = await client.auth.getUser();
  if (!userData.user) {
    return new Response(JSON.stringify({ ok: false, error: "UNAUTHENTICATED" }),
      { status: 401, headers: { "content-type": "application/json" } });
  }
  const result = await getProjectSchedule(client, id);
  return new Response(JSON.stringify(result),
    { status: result.ok ? 200 : 500, headers: { "content-type": "application/json" } });
}
