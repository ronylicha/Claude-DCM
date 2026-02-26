"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Search,
  Terminal,
  FolderKanban,
  Users,
  Wrench,
  Clock,
  Command,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import apiClient from "@/lib/api-client";
import type { Session, Project, Subtask } from "@/lib/api-client";

// ============================================
// Types
// ============================================

type SearchCategory = "sessions" | "projects" | "agents" | "tools";

interface SearchResult {
  id: string;
  name: string;
  category: SearchCategory;
  timestamp: string;
  path: string;
  metadata?: string;
}

interface CategoryConfig {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const CATEGORIES: Record<SearchCategory, CategoryConfig> = {
  sessions: { label: "Sessions", icon: Terminal },
  projects: { label: "Projects", icon: FolderKanban },
  agents: { label: "Agents", icon: Users },
  tools: { label: "Tools", icon: Wrench },
};

const RECENT_SEARCHES_KEY = "dcm_recent_searches";
const MAX_RECENT_SEARCHES = 5;

// ============================================
// Utilities
// ============================================

function saveRecentSearch(query: string) {
  if (!query.trim()) return;

  try {
    const recent = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || "[]") as string[];
    const updated = [query, ...recent.filter((q) => q !== query)].slice(0, MAX_RECENT_SEARCHES);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
  } catch {
    // Ignore localStorage errors
  }
}

function getRecentSearches(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || "[]") as string[];
  } catch {
    return [];
  }
}


// ============================================
// Main Component
// ============================================

export function GlobalSearch() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Fetch and filter results
  const searchData = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    setIsLoading(true);
    try {
      const [sessionsData, projectsData, agentsData] = await Promise.all([
        apiClient.getSessions(1, 50).catch(() => ({ data: [], total: 0, page: 1, limit: 50, totalPages: 0 })),
        apiClient.getProjects(1, 50).catch(() => ({ data: [], total: 0, page: 1, limit: 50, totalPages: 0 })),
        apiClient.getSubtasks({ limit: 50 }).catch(() => ({ subtasks: [], count: 0, limit: 50, offset: 0 })),
      ]);

      const lowerQuery = searchQuery.toLowerCase();
      const searchResults: SearchResult[] = [];

      // Sessions
      sessionsData.data.forEach((session: Session) => {
        const sessionName = `Session ${session.id.slice(0, 8)}`;
        if (sessionName.toLowerCase().includes(lowerQuery) || session.id.includes(lowerQuery)) {
          searchResults.push({
            id: session.id,
            name: sessionName,
            category: "sessions",
            timestamp: session.started_at,
            path: `/sessions/${session.id}`,
            metadata: session.status,
          });
        }
      });

      // Projects
      projectsData.data.forEach((project: Project) => {
        const projectName = project.name || project.path.split("/").pop() || "Unnamed";
        if (projectName.toLowerCase().includes(lowerQuery) || project.path.toLowerCase().includes(lowerQuery)) {
          searchResults.push({
            id: project.id,
            name: projectName,
            category: "projects",
            timestamp: project.updated_at,
            path: `/projects/${project.id}`,
            metadata: project.path,
          });
        }
      });

      // Agents
      const uniqueAgents = new Map<string, Subtask>();
      agentsData.subtasks.forEach((subtask: Subtask) => {
        if (subtask.agent_type && !uniqueAgents.has(subtask.agent_type)) {
          uniqueAgents.set(subtask.agent_type, subtask);
        }
      });

      uniqueAgents.forEach((subtask, agentType) => {
        if (agentType.toLowerCase().includes(lowerQuery)) {
          searchResults.push({
            id: subtask.id,
            name: agentType,
            category: "agents",
            timestamp: subtask.created_at,
            path: `/agents?type=${encodeURIComponent(agentType)}`,
            metadata: subtask.status,
          });
        }
      });

      // Sort by relevance (exact match first, then by timestamp)
      searchResults.sort((a, b) => {
        const aExact = a.name.toLowerCase() === lowerQuery;
        const bExact = b.name.toLowerCase() === lowerQuery;
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });

      setResults(searchResults);
      setSelectedIndex(0);
    } catch (error) {
      console.error("Search error:", error);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Debounced search
  const debouncedSearchRef = useRef<NodeJS.Timeout | null>(null);
  const debouncedSearch = useCallback((q: string) => {
    if (debouncedSearchRef.current) clearTimeout(debouncedSearchRef.current);
    debouncedSearchRef.current = setTimeout(() => searchData(q), 300);
  }, [searchData]);

  // Handle query change
  useEffect(() => {
    debouncedSearch(query);
  }, [query, debouncedSearch]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debouncedSearchRef.current) clearTimeout(debouncedSearchRef.current);
    };
  }, []);

  // Load recent searches on open
  useEffect(() => {
    if (isOpen) {
      setRecentSearches(getRecentSearches());
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Keyboard shortcuts (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Modal keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(results.length, 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + Math.max(results.length, 1)) % Math.max(results.length, 1));
      } else if (e.key === "Enter" && results.length > 0) {
        e.preventDefault();
        handleSelect(results[selectedIndex]);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, results, selectedIndex]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Handle result selection
  const handleSelect = (result: SearchResult) => {
    saveRecentSearch(query);
    setIsOpen(false);
    router.push(result.path);
  };

  // Handle recent search click
  const handleRecentSearchClick = (search: string) => {
    setQuery(search);
  };

  // Group results by category
  const groupedResults = results.reduce((acc, result) => {
    if (!acc[result.category]) {
      acc[result.category] = [];
    }
    acc[result.category].push(result);
    return acc;
  }, {} as Record<SearchCategory, SearchResult[]>);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[20vh]">
      <div
        ref={modalRef}
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden"
      >
        {/* Search Input */}
        <div className="relative border-b border-zinc-700">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-zinc-400" />
          <Input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sessions, projects, agents..."
            className="w-full h-14 pl-12 pr-4 bg-transparent border-0 text-base focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          {isLoading && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2">
              <div className="h-4 w-4 border-2 border-zinc-600 border-t-violet-500 rounded-full animate-spin" />
            </div>
          )}
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {!query && recentSearches.length > 0 && (
            <div className="p-2">
              <div className="px-3 py-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                <Clock className="h-3 w-3" />
                Recent Searches
              </div>
              {recentSearches.map((search, idx) => (
                <button
                  key={idx}
                  onClick={() => handleRecentSearchClick(search)}
                  className="w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors"
                >
                  {search}
                </button>
              ))}
            </div>
          )}

          {query && results.length === 0 && !isLoading && (
            <div className="p-8 text-center text-zinc-400">
              <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No results found for &quot;{query}&quot;</p>
            </div>
          )}

          {query && results.length > 0 && (
            <div className="p-2">
              {(Object.keys(groupedResults) as SearchCategory[]).map((category) => {
                const categoryResults = groupedResults[category];
                if (!categoryResults?.length) return null;

                const CategoryIcon = CATEGORIES[category].icon;
                const globalStartIndex = results.findIndex((r) => r.category === category);

                return (
                  <div key={category} className="mb-4 last:mb-0">
                    <div className="px-3 py-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                      <CategoryIcon className="h-3 w-3" />
                      {CATEGORIES[category].label}
                    </div>
                    {categoryResults.map((result, idx) => {
                      const globalIndex = globalStartIndex + idx;
                      const isSelected = globalIndex === selectedIndex;

                      return (
                        <button
                          key={result.id}
                          onClick={() => handleSelect(result)}
                          className={`w-full px-3 py-2.5 text-left rounded-lg transition-all ${
                            isSelected
                              ? "bg-zinc-800 ring-2 ring-violet-500"
                              : "hover:bg-zinc-800"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-zinc-100 truncate">
                                {result.name}
                              </div>
                              {result.metadata && (
                                <div className="text-xs text-zinc-400 truncate mt-0.5">
                                  {result.metadata}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge variant="outline" className="text-xs">
                                {CATEGORIES[result.category].label.slice(0, -1)}
                              </Badge>
                              <span className="text-xs text-zinc-500">
                                {new Date(result.timestamp).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="border-t border-zinc-700 px-4 py-2.5 flex items-center justify-between text-xs text-zinc-500">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400 font-mono">↑↓</kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400 font-mono">↵</kbd>
              Select
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400 font-mono">Esc</kbd>
              Close
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Trigger Button Component
// ============================================

export function GlobalSearchTrigger() {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(navigator.platform.toLowerCase().includes("mac"));
  }, []);

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 gap-2 text-zinc-400 hover:text-zinc-100"
      onClick={() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true }));
      }}
    >
      <Search className="h-4 w-4" />
      <span className="hidden sm:inline">Search</span>
      <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-zinc-800 rounded text-xs font-mono text-zinc-400">
        {isMac ? <Command className="h-3 w-3" /> : "Ctrl+"}K
      </kbd>
    </Button>
  );
}
