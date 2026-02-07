"use client";

import { Button } from "@/components/ui/button";
import { Download, ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { exportToCSV, exportToJSON, getExportFilename } from "@/lib/export";
import { cn } from "@/lib/utils";

export interface ExportButtonProps<T extends Record<string, unknown>> {
  data: T[];
  filenamePrefix: string;
  disabled?: boolean;
  className?: string;
}

export function ExportButton<T extends Record<string, unknown>>({
  data,
  filenamePrefix,
  disabled,
  className,
}: ExportButtonProps<T>) {
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

  const handleExportCSV = () => {
    exportToCSV(data, getExportFilename(filenamePrefix));
    setOpen(false);
  };

  const handleExportJSON = () => {
    exportToJSON(data, getExportFilename(filenamePrefix));
    setOpen(false);
  };

  return (
    <div className={cn("relative", className)} ref={dropdownRef}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(!open)}
        disabled={disabled || data.length === 0}
      >
        <Download className="mr-2 h-4 w-4" />
        Export
        <ChevronDown className="ml-2 h-4 w-4" />
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-32 rounded-md border bg-popover p-1 shadow-md">
          <button
            className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            onClick={handleExportCSV}
          >
            Export CSV
          </button>
          <button
            className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
            onClick={handleExportJSON}
          >
            Export JSON
          </button>
        </div>
      )}
    </div>
  );
}
