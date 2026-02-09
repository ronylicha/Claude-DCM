"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Radio } from "lucide-react";
import { useRealtimeEvents } from "@/hooks/useWebSocket";
import {
  relativeTime,
  getEventIcon,
  getEventColor,
  extractAgentFromEvent,
} from "./utils";

export function ActivityFeed() {
  const { events, connected } = useRealtimeEvents({
    channels: ["global", "metrics"],
    maxEvents: 10,
  });

  if (!connected) {
    return (
      <Card className="glass-card">
        <div className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Radio className="h-5 w-5 text-muted-foreground" />
            <h3 className="text-base font-semibold">Activity Feed</h3>
          </div>
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <div className="h-2 w-2 rounded-full dot-warning" />
            <span className="text-sm">Live feed offline</span>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="glass-card">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Radio className="h-5 w-5 text-green-500" />
            <h3 className="text-base font-semibold">Activity Feed</h3>
          </div>
          <Badge variant="outline" className="text-xs gap-1">
            <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            Live
          </Badge>
        </div>

        {events.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <span className="text-sm">Waiting for events...</span>
          </div>
        ) : (
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {events.map((event, index) => (
              <div
                key={`${event.timestamp}-${index}`}
                className="animate-slide-in-right flex items-center gap-3 rounded-lg border border-border/50 bg-card/50 px-3 py-2"
              >
                <div className={getEventColor(event.event)}>
                  {getEventIcon(event.event)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {event.event
                        .replace(".", " ")
                        .replace(/\b\w/g, (c) => c.toUpperCase())}
                    </span>
                    <Badge
                      variant="secondary"
                      className="text-[10px] px-1.5 py-0 shrink-0"
                    >
                      {extractAgentFromEvent(event)}
                    </Badge>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                  {relativeTime(event.timestamp)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
