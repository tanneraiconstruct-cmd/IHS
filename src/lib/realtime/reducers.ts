import type { BootstrapData } from "@/lib/schedule/types";
import { consumeEcho } from "./echo-set";
import type { RealtimeRowEvent } from "./events";

const now = () => new Date().toISOString();

export function applyRealtimeEvent(
  data: BootstrapData,
  event: RealtimeRowEvent,
): BootstrapData {
  switch (event.table) {
    case "activities":
      return reduceActivities(data, event);
    case "dependencies":
      return reduceDependencies(data, event);
    case "activity_constraints":
      return reduceConstraints(data, event);
    case "wbs_nodes":
      return reduceWbs(data, event);
    case "comments":
      return reduceComments(data, event);
    case "activity_history":
      return reduceHistory(data, event);
  }
}

function reduceActivities(
  data: BootstrapData,
  event: Extract<RealtimeRowEvent, { table: "activities" }>,
): BootstrapData {
  if (event.type === "INSERT") {
    if (data.activities.some((a) => a.id === event.new.id)) return data;
    return { ...data, activities: [...data.activities, event.new] };
  }
  if (event.type === "UPDATE") {
    const idx = data.activities.findIndex((a) => a.id === event.new.id);
    if (idx === -1) return { ...data, activities: [...data.activities, event.new] };
    const cached = data.activities[idx];
    if (event.new.version <= cached.version) return data;  // echo / out-of-order
    const next = [...data.activities];
    next[idx] = event.new;
    return { ...data, activities: next };
  }
  // DELETE
  const idx = data.activities.findIndex((a) => a.id === event.old.id);
  if (idx === -1 || data.activities[idx].deleted_at) return data;
  const next = [...data.activities];
  next[idx] = { ...next[idx], deleted_at: now() };
  return { ...data, activities: next };
}

function reduceDependencies(
  data: BootstrapData,
  event: Extract<RealtimeRowEvent, { table: "dependencies" }>,
): BootstrapData {
  if (event.type === "INSERT") {
    if (consumeEcho(event.new.id)) return data;
    if (data.dependencies.some((d) => d.id === event.new.id)) return data;
    return { ...data, dependencies: [...data.dependencies, event.new] };
  }
  if (event.type === "UPDATE") {
    const idx = data.dependencies.findIndex((d) => d.id === event.new.id);
    if (idx === -1) return { ...data, dependencies: [...data.dependencies, event.new] };
    const next = [...data.dependencies];
    next[idx] = event.new;
    return { ...data, dependencies: next };
  }
  const idx = data.dependencies.findIndex((d) => d.id === event.old.id);
  if (idx === -1 || data.dependencies[idx].deleted_at) return data;
  const next = [...data.dependencies];
  next[idx] = { ...next[idx], deleted_at: now() };
  return { ...data, dependencies: next };
}

function reduceConstraints(
  data: BootstrapData,
  event: Extract<RealtimeRowEvent, { table: "activity_constraints" }>,
): BootstrapData {
  if (event.type === "INSERT") {
    if (consumeEcho(event.new.id)) return data;
    if (data.constraints.some((c) => c.id === event.new.id)) return data;
    return { ...data, constraints: [...data.constraints, event.new] };
  }
  if (event.type === "UPDATE") {
    const idx = data.constraints.findIndex((c) => c.id === event.new.id);
    if (idx === -1) return { ...data, constraints: [...data.constraints, event.new] };
    const next = [...data.constraints];
    next[idx] = event.new;
    return { ...data, constraints: next };
  }
  return {
    ...data,
    constraints: data.constraints.filter((c) => c.id !== event.old.id),
  };
}

function reduceWbs(
  data: BootstrapData,
  event: Extract<RealtimeRowEvent, { table: "wbs_nodes" }>,
): BootstrapData {
  if (event.type === "INSERT") {
    if (consumeEcho(event.new.id)) return data;
    if (data.wbsNodes.some((w) => w.id === event.new.id)) return data;
    return { ...data, wbsNodes: [...data.wbsNodes, event.new] };
  }
  if (event.type === "UPDATE") {
    const idx = data.wbsNodes.findIndex((w) => w.id === event.new.id);
    if (idx === -1) return { ...data, wbsNodes: [...data.wbsNodes, event.new] };
    const next = [...data.wbsNodes];
    next[idx] = event.new;
    return { ...data, wbsNodes: next };
  }
  const idx = data.wbsNodes.findIndex((w) => w.id === event.old.id);
  if (idx === -1 || data.wbsNodes[idx].deleted_at) return data;
  const next = [...data.wbsNodes];
  next[idx] = { ...next[idx], deleted_at: now() };
  return { ...data, wbsNodes: next };
}

function reduceComments(
  data: BootstrapData,
  event: Extract<RealtimeRowEvent, { table: "comments" }>,
): BootstrapData {
  if (event.type === "INSERT") {
    if (consumeEcho(event.new.id)) return data;
    if (data.comments.some((c) => c.id === event.new.id)) return data;
    return { ...data, comments: [event.new, ...data.comments] };  // newest first
  }
  if (event.type === "UPDATE") {
    const idx = data.comments.findIndex((c) => c.id === event.new.id);
    if (idx === -1) return { ...data, comments: [event.new, ...data.comments] };
    const next = [...data.comments];
    next[idx] = event.new;
    return { ...data, comments: next };
  }
  const idx = data.comments.findIndex((c) => c.id === event.old.id);
  if (idx === -1 || data.comments[idx].deleted_at) return data;
  const next = [...data.comments];
  next[idx] = { ...next[idx], deleted_at: now() };
  return { ...data, comments: next };
}

function reduceHistory(
  data: BootstrapData,
  event: Extract<RealtimeRowEvent, { table: "activity_history" }>,
): BootstrapData {
  if (event.type === "INSERT") {
    // append-only; no echo filter
    if (data.history.some((h) => h.id === event.new.id)) return data;
    return { ...data, history: [event.new, ...data.history] };
  }
  // UPDATE — replace by id; no-op if absent (late-bind or echo).
  const idx = data.history.findIndex((h) => h.id === event.new.id);
  if (idx === -1) return data;
  const next = [...data.history];
  next[idx] = event.new;
  return { ...data, history: next };
}
