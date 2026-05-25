import type { RealtimeRowEvent, RealtimeTable } from "./events";
import { REALTIME_TABLES } from "./events";

interface SupabasePayload {
  schema: string;
  table: string;
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
}

function isRealtimeTable(table: string): table is RealtimeTable {
  return (REALTIME_TABLES as readonly string[]).includes(table);
}

export function normalize(
  payload: SupabasePayload,
  projectId: string,
): RealtimeRowEvent | null {
  if (!isRealtimeTable(payload.table)) return null;

  if (payload.eventType === "DELETE") {
    const id = payload.old?.["id"];
    if (typeof id !== "string") return null;
    return { table: payload.table, type: "DELETE", old: { id } } as RealtimeRowEvent;
  }

  const row = payload.new;
  if (!row || typeof row !== "object") return null;

  // Project-id mismatch defense (server filter should already catch this).
  const rowProjectId = row["project_id"];
  if (typeof rowProjectId === "string" && rowProjectId !== projectId) return null;

  return {
    table: payload.table,
    type: payload.eventType,
    new: row,
  } as RealtimeRowEvent;
}
