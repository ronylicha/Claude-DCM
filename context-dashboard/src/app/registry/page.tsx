"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageContainer } from "@/components/PageContainer";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import apiClient, { type AgentRegistryEntry } from "@/lib/api-client";
import {
  BookOpen,
  Users,
  Search,
  Shield,
  Code,
  Wrench,
  Layers,
  X,
  Brain,
  Sparkles,
  FileText,
} from "lucide-react";

// ============================================
// Constants
// ============================================

const CATEGORIES = [
  { value: "all", label: "All Agents", icon: Layers },
  { value: "orchestrator", label: "Orchestrators", icon: Brain },
  { value: "developer", label: "Developers", icon: Code },
  { value: "validator", label: "Validators", icon: Shield },
  { value: "specialist", label: "Specialists", icon: Sparkles },
  { value: "researcher", label: "Researchers", icon: BookOpen },
  { value: "writer", label: "Writers", icon: FileText },
] as const;

const CATEGORY_COLORS: Record<string, string> = {
  orchestrator: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  developer: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  validator: "bg-teal-500/10 text-teal-400 border-teal-500/20",
  specialist: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  researcher: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  writer: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};

// ============================================
// Helper Functions
// ============================================

function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] || "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
}

function getCategoryIcon(category: string) {
  const cat = CATEGORIES.find((c) => c.value === category);
  return cat?.icon || Layers;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

// ============================================
// Agent Card Component
// ============================================

interface AgentCardProps {
  agent: AgentRegistryEntry;
  onClick: () => void;
  isSelected: boolean;
}

function AgentCard({ agent, onClick, isSelected }: AgentCardProps) {
  const CategoryIcon = getCategoryIcon(agent.category);

  return (
    <div
      onClick={onClick}
      className={`glass-card rounded-xl p-5 cursor-pointer transition-all hover:scale-[1.02] hover:border-border ${
        isSelected ? "border-primary ring-2 ring-primary/20" : ""
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div
          className={`flex items-center justify-center h-10 w-10 rounded-lg ${getCategoryColor(agent.category)}`}
        >
          <CategoryIcon className="h-5 w-5" />
        </div>
        <Badge
          variant="outline"
          className={`text-[10px] px-2 py-0.5 ${getCategoryColor(agent.category)}`}
        >
          {agent.category}
        </Badge>
      </div>

      {/* Agent Type */}
      <div className="mb-2">
        <code className="text-sm font-semibold text-foreground bg-zinc-800/50 px-2 py-1 rounded">
          {agent.agent_type}
        </code>
      </div>

      {/* Display Name */}
      {agent.display_name && (
        <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
          {agent.display_name}
        </p>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">Model</span>
          <span className="font-medium text-foreground truncate">
            {agent.recommended_model || "default"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">Max Files</span>
          <span className="font-medium text-foreground">
            {agent.max_files || "∞"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">Tools</span>
          <span className="font-medium text-foreground">
            {agent.allowed_tools?.length || 0}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">Waves</span>
          <span className="font-medium text-foreground">
            {agent.wave_assignments?.length || 0}
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Agent Detail Panel Component
// ============================================

interface AgentDetailPanelProps {
  agent: AgentRegistryEntry;
  onClose: () => void;
}

function AgentDetailPanel({ agent, onClose }: AgentDetailPanelProps) {
  return (
    <div className="glass-card rounded-xl p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className={`flex items-center justify-center h-12 w-12 rounded-lg ${getCategoryColor(agent.category)}`}
          >
            {(() => {
              const Icon = getCategoryIcon(agent.category);
              return <Icon className="h-6 w-6" />;
            })()}
          </div>
          <div>
            <code className="text-base font-bold text-foreground bg-zinc-800/50 px-2 py-1 rounded">
              {agent.agent_type}
            </code>
            {agent.display_name && (
              <p className="text-sm text-muted-foreground mt-1">
                {agent.display_name}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-zinc-800 rounded-lg transition-colors"
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      {/* Category & Model */}
      <div className="flex gap-2 mb-4">
        <Badge
          variant="outline"
          className={`text-xs ${getCategoryColor(agent.category)}`}
        >
          {agent.category}
        </Badge>
        {agent.recommended_model && (
          <Badge variant="outline" className="text-xs">
            {agent.recommended_model}
          </Badge>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-4 mb-6 p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Max Files</span>
          <span className="text-lg font-bold text-foreground">
            {agent.max_files || "∞"}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Allowed Tools</span>
          <span className="text-lg font-bold text-foreground">
            {agent.allowed_tools?.length || 0}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Wave Assignments</span>
          <span className="text-lg font-bold text-foreground">
            {agent.wave_assignments?.length || 0}
          </span>
        </div>
      </div>

      {/* Default Scope */}
      <div className="mb-4">
        <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Wrench className="h-4 w-4" />
          Default Scope
        </h4>
        <pre className="text-xs bg-zinc-900 border border-zinc-800 rounded-lg p-3 overflow-auto max-h-[200px]">
          {JSON.stringify(agent.default_scope, null, 2)}
        </pre>
      </div>

      {/* Allowed Tools */}
      {agent.allowed_tools && agent.allowed_tools.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Code className="h-4 w-4" />
            Allowed Tools ({agent.allowed_tools.length})
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {agent.allowed_tools.map((tool) => (
              <Badge
                key={tool}
                variant="secondary"
                className="text-xs font-mono"
              >
                {tool}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Forbidden Actions */}
      {agent.forbidden_actions && agent.forbidden_actions.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold mb-2 flex items-center gap-2 text-red-400">
            <Shield className="h-4 w-4" />
            Forbidden Actions ({agent.forbidden_actions.length})
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {agent.forbidden_actions.map((action) => (
              <Badge
                key={action}
                variant="outline"
                className="text-xs font-mono text-red-400 border-red-500/20"
              >
                {action}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Wave Assignments */}
      {agent.wave_assignments && agent.wave_assignments.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Wave Assignments
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {agent.wave_assignments.map((wave) => (
              <Badge
                key={wave}
                variant="outline"
                className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/20"
              >
                Wave {wave}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// Main Registry Page
// ============================================

export default function RegistryPage() {
  const [category, setCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedAgent, setSelectedAgent] = useState<AgentRegistryEntry | null>(
    null
  );

  // Debounce search query
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Fetch registry data
  const { data, isLoading, error } = useQuery({
    queryKey: ["registry", category === "all" ? undefined : category],
    queryFn: () =>
      apiClient.getRegistry({
        category: category === "all" ? undefined : category,
      }),
    refetchInterval: 60000,
  });

  // Filter agents by search
  const filteredAgents = useMemo(() => {
    if (!data?.agents) return [];

    return data.agents.filter((agent) => {
      const searchLower = debouncedSearch.toLowerCase();
      return (
        agent.agent_type.toLowerCase().includes(searchLower) ||
        agent.display_name?.toLowerCase().includes(searchLower) ||
        agent.category.toLowerCase().includes(searchLower)
      );
    });
  }, [data?.agents, debouncedSearch]);

  // Handle agent selection
  const handleAgentClick = useCallback((agent: AgentRegistryEntry) => {
    setSelectedAgent(agent);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedAgent(null);
  }, []);

  return (
    <PageContainer
      title="Agent Registry"
      description="Browse registered agent types with their scopes and configurations"
    >
      <div className="flex flex-col gap-6">
        {/* Filters Row */}
        <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center">
          {/* Category Tabs */}
          <Tabs
            value={category}
            onValueChange={setCategory}
            className="flex-1 w-full"
          >
            <TabsList variant="line" className="w-full overflow-x-auto">
              {CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                return (
                  <TabsTrigger key={cat.value} value={cat.value} className="gap-1.5">
                    <Icon className="h-3.5 w-3.5" />
                    {cat.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>

          {/* Search */}
          <div className="relative w-full lg:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by agent type or name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="glass-card rounded-xl p-5">
                <div className="flex items-start justify-between mb-3">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <Skeleton className="h-5 w-20 rounded" />
                </div>
                <Skeleton className="h-6 w-32 mb-2" />
                <Skeleton className="h-4 w-full mb-3" />
                <div className="grid grid-cols-2 gap-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {error && (
          <Card className="glass-card p-8 text-center">
            <Shield className="h-12 w-12 text-red-500 mx-auto mb-3" />
            <h3 className="text-lg font-semibold mb-2">Failed to Load Registry</h3>
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
          </Card>
        )}

        {/* Empty State */}
        {!isLoading && !error && filteredAgents.length === 0 && (
          <Card className="glass-card p-8 text-center">
            <Users className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-lg font-semibold mb-2">No Agents Found</h3>
            <p className="text-sm text-muted-foreground">
              {searchQuery
                ? `No agents match "${searchQuery}"`
                : `No agents in category "${category}"`}
            </p>
          </Card>
        )}

        {/* Main Content: Grid + Detail Panel */}
        {!isLoading && !error && filteredAgents.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Agent Cards Grid */}
            <div
              className={`grid gap-4 grid-cols-1 md:grid-cols-2 ${
                selectedAgent ? "lg:col-span-2" : "lg:col-span-3 lg:grid-cols-3"
              }`}
            >
              {filteredAgents.map((agent) => (
                <AgentCard
                  key={agent.agent_type}
                  agent={agent}
                  onClick={() => handleAgentClick(agent)}
                  isSelected={selectedAgent?.agent_type === agent.agent_type}
                />
              ))}
            </div>

            {/* Detail Panel */}
            {selectedAgent && (
              <div className="lg:col-span-1 animate-slide-in-right">
                <AgentDetailPanel
                  agent={selectedAgent}
                  onClose={handleCloseDetail}
                />
              </div>
            )}
          </div>
        )}

        {/* Count Badge */}
        {!isLoading && !error && data && (
          <div className="flex justify-between items-center text-xs text-muted-foreground">
            <span>
              Showing {filteredAgents.length} of {data.total} agents
            </span>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="flex items-center gap-1 hover:text-foreground transition-colors"
              >
                <X className="h-3 w-3" />
                Clear search
              </button>
            )}
          </div>
        )}
      </div>
    </PageContainer>
  );
}
