"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Calendar } from "lucide-react";

export type DateRange = "1h" | "24h" | "7d" | "30d" | "custom";

export interface DateRangeFilterProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
}

const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: "1h", label: "1 hour" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

export function DateRangeFilter({ value, onChange, className }: DateRangeFilterProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Calendar className="h-4 w-4 text-muted-foreground" />
      <div className="flex rounded-md border">
        {DATE_RANGES.map((range) => (
          <Button
            key={range.value}
            variant={value === range.value ? "default" : "ghost"}
            size="sm"
            onClick={() => onChange(range.value)}
            className={cn(
              "rounded-none first:rounded-l-md last:rounded-r-md",
              value === range.value && "pointer-events-none"
            )}
          >
            {range.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function getDateRangeStart(range: DateRange): Date {
  const now = new Date();
  switch (range) {
    case "1h":
      return new Date(now.getTime() - 60 * 60 * 1000);
    case "24h":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    default:
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }
}
