"use client";

import { useEffect, useRef } from "react";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    window.addEventListener("mousedown", onDoc);
    return () => window.removeEventListener("mousedown", onDoc);
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[160px] rounded border border-slate-200 bg-white py-1 text-xs shadow-md"
      style={{ left: x, top: y }}
    >
      {items.map((it, i) => (
        <button
          key={i}
          onClick={() => {
            it.onSelect();
            onClose();
          }}
          className={`block w-full px-3 py-1.5 text-left hover:bg-slate-100 ${
            it.destructive ? "text-red-700" : "text-slate-700"
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
