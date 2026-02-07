"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Filter } from "lucide-react";

export type Status = "all" | "active" | "completed" | "failed";

export interface StatusFilterProps {
  value: Status;
  onChange: (status: Status) => void;
  className?: string;
}

const STATUSES: { value: Status; label: string; color?: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active", color: "text-green-500" },
  { value: "completed", label: "Completed", color: "text-blue-500" },
  { value: "failed", label: "Failed", color: "text-red-500" },
];

export function StatusFilter({ value, onChange, className }: StatusFilterProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Filter className="h-4 w-4 text-muted-foreground" />
      <div className="flex rounded-md border">
        {STATUSES.map((status) => (
          <Button
            key={status.value}
            variant={value === status.value ? "default" : "ghost"}
            size="sm"
            onClick={() => onChange(status.value)}
            className={cn(
              "rounded-none first:rounded-l-md last:rounded-r-md",
              value === status.value && "pointer-events-none"
            )}
          >
            <span className={status.color}>{status.label}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
