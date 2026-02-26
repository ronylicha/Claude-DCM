"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Users, ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";

export interface AgentFilterProps {
  agents: string[];
  value: string | null;
  onChange: (agent: string | null) => void;
  className?: string;
}

export function AgentFilter({ agents, value, onChange, className }: AgentFilterProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className={cn("relative flex items-center gap-2", className)} ref={dropdownRef}>
      <Users className="h-4 w-4 text-muted-foreground" />
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(!open)}
        className="w-[180px] justify-between"
      >
        <span className="truncate">
          {value || "All Agents"}
        </span>
        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
      {open && (
        <div className="absolute left-6 top-full z-50 mt-1 max-h-60 w-[180px] overflow-auto rounded-md border bg-popover p-1 shadow-md">
          <button
            className={cn(
              "w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
              value === null && "bg-accent"
            )}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            All Agents
          </button>
          {agents.map((agent) => (
            <button
              key={agent}
              className={cn(
                "w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                value === agent && "bg-accent"
              )}
              onClick={() => {
                onChange(agent);
                setOpen(false);
              }}
            >
              {agent}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
