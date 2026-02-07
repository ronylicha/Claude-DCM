"use client";

import { useState, useCallback, useMemo } from "react";
import type { DateRange } from "@/components/filters/DateRangeFilter";
import type { Status } from "@/components/filters/StatusFilter";
import { getDateRangeStart } from "@/components/filters/DateRangeFilter";

export interface Filters {
  dateRange: DateRange;
  status: Status;
  agent: string | null;
  search: string;
}

export interface UseFiltersReturn {
  filters: Filters;
  setDateRange: (range: DateRange) => void;
  setStatus: (status: Status) => void;
  setAgent: (agent: string | null) => void;
  setSearch: (search: string) => void;
  resetFilters: () => void;
  dateRangeStart: Date;
}

const DEFAULT_FILTERS: Filters = {
  dateRange: "24h",
  status: "all",
  agent: null,
  search: "",
};

export function useFilters(initialFilters?: Partial<Filters>): UseFiltersReturn {
  const [filters, setFilters] = useState<Filters>({
    ...DEFAULT_FILTERS,
    ...initialFilters,
  });

  const setDateRange = useCallback((dateRange: DateRange) => {
    setFilters((prev) => ({ ...prev, dateRange }));
  }, []);

  const setStatus = useCallback((status: Status) => {
    setFilters((prev) => ({ ...prev, status }));
  }, []);

  const setAgent = useCallback((agent: string | null) => {
    setFilters((prev) => ({ ...prev, agent }));
  }, []);

  const setSearch = useCallback((search: string) => {
    setFilters((prev) => ({ ...prev, search }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  const dateRangeStart = useMemo(
    () => getDateRangeStart(filters.dateRange),
    [filters.dateRange]
  );

  return {
    filters,
    setDateRange,
    setStatus,
    setAgent,
    setSearch,
    resetFilters,
    dateRangeStart,
  };
}
