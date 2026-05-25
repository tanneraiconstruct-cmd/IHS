import type {
  DbActivity,
  DbActivityConstraint,
  DbActivityHistory,
  DbComment,
  DbDependency,
  DbWbsNode,
} from "@/lib/schedule/types";

export type RealtimeRowEvent =
  | { table: "activities"; type: "INSERT"; new: DbActivity }
  | { table: "activities"; type: "UPDATE"; new: DbActivity }
  | { table: "activities"; type: "DELETE"; old: { id: string } }
  | { table: "dependencies"; type: "INSERT"; new: DbDependency }
  | { table: "dependencies"; type: "UPDATE"; new: DbDependency }
  | { table: "dependencies"; type: "DELETE"; old: { id: string } }
  | { table: "activity_constraints"; type: "INSERT"; new: DbActivityConstraint }
  | { table: "activity_constraints"; type: "UPDATE"; new: DbActivityConstraint }
  | { table: "activity_constraints"; type: "DELETE"; old: { id: string } }
  | { table: "wbs_nodes"; type: "INSERT"; new: DbWbsNode }
  | { table: "wbs_nodes"; type: "UPDATE"; new: DbWbsNode }
  | { table: "wbs_nodes"; type: "DELETE"; old: { id: string } }
  | { table: "comments"; type: "INSERT"; new: DbComment }
  | { table: "comments"; type: "UPDATE"; new: DbComment }
  | { table: "comments"; type: "DELETE"; old: { id: string } }
  | { table: "activity_history"; type: "INSERT"; new: DbActivityHistory };

export const REALTIME_TABLES = [
  "activities",
  "dependencies",
  "activity_constraints",
  "wbs_nodes",
  "comments",
  "activity_history",
] as const;

export type RealtimeTable = (typeof REALTIME_TABLES)[number];
