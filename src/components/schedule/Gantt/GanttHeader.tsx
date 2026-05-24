"use client";

import { DAY_W, isoAddDays } from "./layout";

interface Props {
  projectStart: string;
  totalDays: number;
}

export function GanttHeader({ projectStart, totalDays }: Props) {
  const months: { x: number; label: string }[] = [];
  const days: { x: number; date: Date; iso: string }[] = [];

  for (let i = 0; i < totalDays; i++) {
    const iso = isoAddDays(projectStart, i);
    const date = new Date(iso + "T00:00:00.000Z");
    days.push({ x: i * DAY_W, date, iso });

    if (date.getUTCDate() === 1 || i === 0) {
      months.push({
        x: i * DAY_W,
        label: date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
      });
    }
  }

  return (
    <div
      className="relative border-b border-slate-200 bg-white"
      style={{ width: totalDays * DAY_W, height: 36 }}
    >
      <div className="absolute inset-x-0 top-0 h-4 border-b border-slate-100">
        {months.map((m) => (
          <div
            key={m.x}
            className="absolute top-0 px-1 text-[10px] font-medium text-slate-600"
            style={{ left: m.x }}
          >
            {m.label}
          </div>
        ))}
      </div>
      <div className="absolute inset-x-0 top-4 bottom-0">
        {days.map((d) => (
          <div
            key={d.iso}
            className="absolute top-0 bottom-0 flex items-center justify-center text-[9px] text-slate-500"
            style={{ left: d.x, width: DAY_W }}
          >
            {d.date.getUTCDate()}
          </div>
        ))}
      </div>
    </div>
  );
}
