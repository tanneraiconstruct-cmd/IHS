export function wouldCreateCycle(
  nodes: { id: string; parent_id: string | null }[],
  nodeId: string, newParentId: string,
): boolean {
  if (nodeId === newParentId) return true;
  const parentOf = new Map(nodes.map(n => [n.id, n.parent_id]));
  let cur: string | null = newParentId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === nodeId) return true;
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = parentOf.get(cur) ?? null;
  }
  return false;
}
