"use client";

import { useEffect, useMemo, useState } from "react";
import { useRealtimeEvents } from "@/hooks/useWebSocket";

export function SystemPulseBar() {
  const { events, connected } = useRealtimeEvents({
    channels: ["global", "metrics"],
    maxEvents: 60,
  });

  const [clock, setClock] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const dots = useMemo(() => {
    const slots: Array<{ color: string; label: string }> = [];
    for (let i = 0; i < 60; i++) {
      if (i < events.length) {
        const evt = events[i];
        let color = "#6b7280";
        const label = evt.event;
        if (evt.event.includes("completed")) {
          color = "#22C55E";
        } else if (
          evt.event.includes("agent.") ||
          evt.event.includes("subtask.running")
        ) {
          color = "#8B5CF6";
        } else if (evt.event.includes("message.")) {
          color = "#06B6D4";
        } else if (
          evt.event.includes("compact") ||
          evt.event.includes("capacity")
        ) {
          color = "#F59E0B";
        } else if (
          evt.event.includes("error") ||
          evt.event.includes("failed")
        ) {
          color = "#EF4444";
        }
        slots.push({ color, label });
      } else {
        slots.push({ color: "#1f2937", label: "no data" });
      }
    }
    return slots;
  }, [events]);

  return (
    <div className="system-pulse-bar">
      <div className="flex items-center gap-[3px] flex-1">
        {dots.map((dot, i) => (
          <div
            key={i}
            className="pulse-dot-item"
            style={{ backgroundColor: dot.color }}
            title={dot.label}
          />
        ))}
      </div>

      <div className="flex items-center gap-4 ml-4 shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-1.5 rounded-full dot-healthy" />
          <span className="text-[10px] text-muted-foreground font-mono">
            API:3847
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className={`h-1.5 w-1.5 rounded-full ${connected ? "dot-healthy" : "dot-error"}`}
          />
          <span className="text-[10px] text-muted-foreground font-mono">
            WS:3849
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-1.5 rounded-full dot-healthy" />
          <span className="text-[10px] text-muted-foreground font-mono">
            PG:5432
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">
          {clock.toLocaleTimeString("en-US", { hour12: false })}
        </span>
      </div>
    </div>
  );
}
