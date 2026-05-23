import { createRouteSupabaseClient } from "@/lib/schedule-server/shared/supabase-client";
import { applyScheduleEdit } from "@/lib/schedule-server/apply-schedule-edit";
import { err } from "@/lib/schedule-server/shared/errors";

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return j(err("VALIDATION_FAILED", "invalid JSON"), 400); }

  if (typeof body !== "object" || body === null) {
    return j(err("VALIDATION_FAILED", "body must be an object"), 400);
  }
  const b = body as Record<string, unknown>;
  const projectId      = b.projectId      as string | undefined;
  const editSessionId  = b.editSessionId  as string | undefined;
  const requestId      = b.requestId      as string | undefined;
  const ops            = b.ops            as unknown[] | undefined;

  if (!projectId || !editSessionId || !Array.isArray(ops)) {
    return j(err("VALIDATION_FAILED", "missing projectId / editSessionId / ops[]"), 400);
  }

  const client = await createRouteSupabaseClient();
  const { data: userData, error: userErr } = await client.auth.getUser();
  if (userErr || !userData.user) return j(err("UNAUTHENTICATED"), 401);

  const response = await applyScheduleEdit({
    client, projectId, editSessionId, requestId,
    actingUserId: userData.user.id, ops,
  });
  return j(response, response.ok ? 200 : statusFor(response.error));
}

function j(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });
}
function statusFor(code: string): number {
  switch (code) {
    case "UNAUTHENTICATED":    return 401;
    case "FORBIDDEN":          return 403;
    case "VALIDATION_FAILED":
    case "ENGINE_CYCLE":
    case "PAYLOAD_INVALID":
    case "IDENTITY_MISMATCH":  return 400;
    case "STALE_STATE":        return 409;
    default:                   return 500;
  }
}
