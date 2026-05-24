export const DAY_W = 28;
export const ROW_H = 36;
export const BAR_H = 16;
export const BAR_TOP_OFFSET = 10;

const MS_PER_DAY = 86_400_000;

function parseIso(iso: string): Date {
  return new Date(iso + "T00:00:00.000Z");
}

export function isoDiffDays(a: string, b: string): number {
  return Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / MS_PER_DAY);
}

export function isoAddDays(iso: string, n: number): string {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayToX(projectStart: string, iso: string): number {
  return isoDiffDays(projectStart, iso) * DAY_W;
}

export function xToDay(projectStart: string, x: number): string {
  const n = Math.round(x / DAY_W);
  return isoAddDays(projectStart, n);
}

export interface BarRectInput {
  projectStart: string;
  plannedStart: string;
  plannedFinish: string;
  rowIndex: number;
}

export interface BarRect {
  left: number;
  top: number;
  width: number;
}

export function barRect({ projectStart, plannedStart, plannedFinish, rowIndex }: BarRectInput): BarRect {
  const startX = dayToX(projectStart, plannedStart);
  const finishX = dayToX(projectStart, plannedFinish) + DAY_W;
  return {
    left: startX,
    width: Math.max(DAY_W, finishX - startX),
    top: rowIndex * ROW_H,
  };
}

export function dependencyPath(pred: BarRect, succ: BarRect): string {
  const px = pred.left + pred.width;
  const py = pred.top + BAR_TOP_OFFSET + BAR_H / 2;
  const sx = succ.left;
  const sy = succ.top + BAR_TOP_OFFSET + BAR_H / 2;
  const midX = px + Math.max(8, (sx - px) / 2);
  return `M ${px} ${py} L ${midX} ${py} L ${midX} ${sy} L ${sx} ${sy}`;
}
