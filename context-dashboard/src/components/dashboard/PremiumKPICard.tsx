"use client";

import { Skeleton } from "@/components/ui/skeleton";
import {
  LineChart as RechartsLineChart,
  Line,
  ResponsiveContainer,
} from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export interface PremiumKPIProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  iconGradient: string;
  trend?: { value: number; label: string };
  sparklineData?: { value: number }[];
  sparklineColor?: string;
  loading?: boolean;
}

export function PremiumKPICard({
  title,
  value,
  icon,
  iconGradient,
  trend,
  sparklineData,
  sparklineColor = "#3b82f6",
  loading,
}: PremiumKPIProps) {
  return (
    <div className="glass-card rounded-xl p-5 flex flex-col gap-3">
      {/* Header: icon + title */}
      <div className="flex items-center gap-2.5">
        <div
          className={`flex items-center justify-center h-8 w-8 rounded-lg ${iconGradient}`}
        >
          {icon}
        </div>
        <span className="text-sm font-medium text-muted-foreground">
          {title}
        </span>
      </div>

      {/* Value */}
      {loading ? (
        <Skeleton className="h-9 w-24" />
      ) : (
        <div className="animate-count-up gradient-text text-3xl font-bold tracking-tight">
          {value}
        </div>
      )}

      {/* Trend indicator */}
      {trend && !loading && (
        <div className="flex items-center gap-1">
          {trend.value > 0 ? (
            <TrendingUp className="h-3.5 w-3.5 text-green-500" />
          ) : trend.value < 0 ? (
            <TrendingDown className="h-3.5 w-3.5 text-red-500" />
          ) : (
            <Minus className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span
            className={`text-xs font-medium ${
              trend.value > 0
                ? "text-green-500"
                : trend.value < 0
                  ? "text-red-500"
                  : "text-muted-foreground"
            }`}
          >
            {trend.value > 0 ? "+" : ""}
            {trend.value}% {trend.label}
          </span>
        </div>
      )}

      {/* Mini Sparkline */}
      {sparklineData && sparklineData.length > 1 && !loading && (
        <div className="h-[50px] w-full -mb-1">
          <ResponsiveContainer width="100%" height={50}>
            <RechartsLineChart data={sparklineData}>
              <Line
                type="monotone"
                dataKey="value"
                stroke={sparklineColor}
                strokeWidth={1.5}
                dot={false}
              />
            </RechartsLineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
