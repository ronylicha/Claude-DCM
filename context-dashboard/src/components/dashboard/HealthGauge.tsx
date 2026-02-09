"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import apiClient, { type HealthResponse } from "@/lib/api-client";
import { Heart, XCircle } from "lucide-react";

export function HealthGauge() {
  const { data, isLoading, error } = useQuery<HealthResponse, Error>({
    queryKey: ["health"],
    queryFn: apiClient.getHealth,
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="glass-card rounded-xl p-5">
        <div className="flex flex-col items-center gap-3">
          <Skeleton className="h-24 w-24 rounded-full" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card rounded-xl p-5 border-destructive/30">
        <div className="flex flex-col items-center gap-3 py-2">
          <XCircle className="h-10 w-10 text-destructive" />
          <span className="text-sm font-medium text-destructive">
            Unreachable
          </span>
        </div>
      </div>
    );
  }

  const isHealthy = data?.status === "healthy" && data?.database?.healthy;
  const isDegraded = data?.status === "healthy" && !data?.database?.healthy;

  const healthPercent = isHealthy ? 100 : isDegraded ? 60 : 10;
  const statusLabel = isHealthy ? "Healthy" : isDegraded ? "Degraded" : "Down";
  const strokeColor = isHealthy
    ? "#22c55e"
    : isDegraded
      ? "#f59e0b"
      : "#ef4444";

  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (healthPercent / 100) * circumference;

  const phases = data?.features
    ? Object.entries(data.features).map(([key, value]) => ({
        name: key.replace("phase", "P"),
        status: value,
      }))
    : [];

  return (
    <div className="glass-card rounded-xl p-5 flex flex-col items-center gap-3">
      {/* SVG Ring Gauge */}
      <div className="relative">
        <svg viewBox="0 0 100 100" className="w-24 h-24">
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            className="text-muted/20"
          />
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth="6"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform="rotate(-90 50 50)"
            style={{ transition: "stroke-dashoffset 1s ease-out" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <Heart className="h-5 w-5" style={{ color: strokeColor }} />
          <span
            className="text-[11px] font-semibold mt-0.5"
            style={{ color: strokeColor }}
          >
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Version */}
      <Badge variant="outline" className="text-[10px] px-2 py-0">
        v{data?.version}
      </Badge>

      {/* Phase dots (compact grid) */}
      {phases.length > 0 && (
        <div className="grid grid-cols-4 gap-x-2 gap-y-1 w-full">
          {phases.map((phase) => (
            <div
              key={phase.name}
              className="flex items-center gap-1"
              title={`${phase.name}: ${phase.status}`}
            >
              <div
                className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                  phase.status === "active" || phase.status === "enabled"
                    ? "dot-healthy"
                    : phase.status === "partial"
                      ? "dot-warning"
                      : "dot-error"
                }`}
              />
              <span className="text-[9px] text-muted-foreground truncate">
                {phase.name}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
