"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export interface KPICardProps {
  title: string;
  value: string | number;
  icon?: ReactNode;
  description?: string;
  trend?: {
    value: number;
    label: string;
  };
  loading?: boolean;
  className?: string;
}

export function KPICard({
  title,
  value,
  icon,
  description,
  trend,
  loading,
  className,
}: KPICardProps) {
  const trendIsPositive = trend && trend.value > 0;
  const trendIsNegative = trend && trend.value < 0;

  return (
    <Card className={cn("", className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon && (
          <div className="h-4 w-4 text-muted-foreground">{icon}</div>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <>
            <Skeleton className="h-8 w-20" />
            {description && <Skeleton className="mt-1 h-4 w-28" />}
          </>
        ) : (
          <>
            <div className="text-2xl font-bold">{value}</div>
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
            {trend && (
              <p
                className={cn(
                  "mt-1 text-xs",
                  trendIsPositive && "text-green-600",
                  trendIsNegative && "text-red-600",
                  !trendIsPositive && !trendIsNegative && "text-muted-foreground"
                )}
              >
                {trendIsPositive && "+"}
                {trend.value}% {trend.label}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
