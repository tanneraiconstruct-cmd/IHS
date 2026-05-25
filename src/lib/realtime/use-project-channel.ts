"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useRef } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { toast } from "@/lib/state/toasts";
import { useUiStore } from "@/lib/state/ui-store";
import { usePresenceStore } from "@/lib/state/presence-store";
import { REALTIME_TABLES } from "./events";
import { applyRealtimeEvent } from "./reducers";
import { normalize } from "./normalize";
import { deriveColor, type PresencePayload } from "./presence";
import type { BootstrapData } from "@/lib/schedule/types";

export function useProjectChannel(projectId: string): void {
  const qc = useQueryClient();
  const chRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    const sb = createSupabaseBrowserClient();
    let cancelled = false;
    const setOnline = usePresenceStore.getState().setOnline;
    const setConnection = usePresenceStore.getState().setConnection;
    const key = ["schedule", projectId] as const;

    (async () => {
      const { data: { user } } = await sb.auth.getUser();
      if (!user || cancelled) return;
      const displayName = user.email?.split("@")[0] ?? user.id.slice(0, 8);
      const color = deriveColor(user.id);

      const ch = sb.channel(`project:${projectId}`, {
        config: { presence: { key: user.id } },
      });
      chRef.current = ch;

      for (const table of REALTIME_TABLES) {
        ch.on(
          "postgres_changes",
          { event: "*", schema: "public", table, filter: `project_id=eq.${projectId}` },
          (payload) => {
            const event = normalize(payload as never, projectId);
            if (!event) return;
            qc.setQueryData(key, (prev: BootstrapData | undefined) =>
              prev ? applyRealtimeEvent(prev, event) : prev);
          },
        );
      }

      ch.on("presence", { event: "sync" }, () => {
        setOnline(ch.presenceState<PresencePayload>());
      });

      ch.subscribe(async (status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          setConnection("live");
          void qc.invalidateQueries({ queryKey: key });
          await ch.track({
            userId: user.id,
            displayName,
            color,
            editMode: useUiStore.getState().mode === "edit",
            joinedAt: new Date().toISOString(),
          } satisfies PresencePayload);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnection("offline");
          toast.warn("Live updates disconnected — refresh to reconnect");
        }
      });
    })();

    // Re-track when edit mode flips
    const editUnsub = useUiStore.subscribe((s, prev) => {
      if (s.mode === prev.mode) return;
      const ch = chRef.current;
      if (!ch) return;
      void (async () => {
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return;
        await ch.track({
          userId: user.id,
          displayName: user.email?.split("@")[0] ?? user.id.slice(0, 8),
          color: deriveColor(user.id),
          editMode: s.mode === "edit",
          joinedAt: new Date().toISOString(),
        } satisfies PresencePayload);
      })();
    });

    const onVis = () => {
      if (document.visibilityState === "visible") {
        void qc.invalidateQueries({ queryKey: key });
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      editUnsub();
      document.removeEventListener("visibilitychange", onVis);
      const ch = chRef.current;
      if (ch) {
        void ch.untrack();
        void ch.unsubscribe();
        chRef.current = null;
      }
    };
  }, [projectId, qc]);
}
