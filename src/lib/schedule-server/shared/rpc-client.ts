import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApplyScheduleEditPayload } from "./types";

export async function callApplyScheduleEdit(
  client: SupabaseClient, payload: ApplyScheduleEditPayload,
) {
  const { data, error } = await client.rpc("apply_schedule_edit", {
    p_payload: payload as unknown as Record<string, unknown>,
  });
  if (error) return { rpcError: error };
  return { result: data as Record<string, unknown> };
}
