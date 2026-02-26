"use client";

import React from "react";
import {
  ListChecks,
  CheckCircle,
  MessageSquare,
  Bot,
  Activity,
  AlertTriangle,
  Radio,
} from "lucide-react";
import type { WSEvent } from "@/hooks/useWebSocket";

export function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function getEventIcon(eventType: string): React.ReactNode {
  if (eventType.startsWith("task."))
    return <ListChecks className="h-4 w-4" />;
  if (eventType.startsWith("subtask."))
    return <CheckCircle className="h-4 w-4" />;
  if (eventType.startsWith("message."))
    return <MessageSquare className="h-4 w-4" />;
  if (eventType.startsWith("agent.")) return <Bot className="h-4 w-4" />;
  if (eventType.startsWith("metric."))
    return <Activity className="h-4 w-4" />;
  if (eventType.startsWith("system."))
    return <AlertTriangle className="h-4 w-4" />;
  return <Radio className="h-4 w-4" />;
}

export function getEventColor(eventType: string): string {
  if (eventType.includes("completed")) return "text-green-500";
  if (eventType.includes("failed") || eventType.includes("error"))
    return "text-red-500";
  if (eventType.includes("created") || eventType.includes("new"))
    return "text-blue-500";
  if (eventType.includes("connected")) return "text-emerald-500";
  if (eventType.includes("disconnected")) return "text-amber-500";
  return "text-muted-foreground";
}

export function extractAgentFromEvent(event: WSEvent): string {
  const data = event.data as Record<string, unknown>;
  return (
    (data?.agent_type as string) ||
    (data?.agent_id as string) ||
    (data?.from_agent as string) ||
    "system"
  );
}
