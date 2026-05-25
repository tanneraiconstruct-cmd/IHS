const inflight = new Map<string, number>();  // id → expiry epoch ms
const TTL_MS = 30_000;

export function markInflight(id: string): void {
  inflight.set(id, Date.now() + TTL_MS);
}

export function consumeEcho(id: string): boolean {
  const expiry = inflight.get(id);
  if (expiry === undefined) return false;
  inflight.delete(id);
  return expiry > Date.now();
}

export function _resetForTests(): void {
  inflight.clear();
}
