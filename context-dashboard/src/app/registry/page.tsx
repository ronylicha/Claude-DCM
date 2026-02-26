"use client";

import { useState, useCallback, useEffect, createElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageContainer } from "@/components/PageContainer";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import apiClient, {
  type CatalogAgent,
  type CatalogSkill,
  type CatalogCommand,
} from "@/lib/api-client";
import {
  BookOpen,
  Brain,
  Briefcase,
  Code,
  FileText,
  GitBranch,
  Layers,
  Megaphone,
  Palette,
  Search,
  Shield,
  Sparkles,
  Terminal,
  TestTube,
  Workflow,
  Wrench,
  X,
  Zap,
  Bot,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ============================================
// Constants
// ============================================

type CategoryDef = {
  value: string;
  label: string;
  icon: LucideIcon;
  color?: string;
};

const AGENT_CATEGORIES: CategoryDef[] = [
  { value: "all", label: "All", icon: Layers },
  { value: "orchestrator", label: "Orchestrators", icon: Brain, color: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" },
  { value: "developer", label: "Developers", icon: Code, color: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" },
  { value: "validator", label: "Validators", icon: Shield, color: "bg-teal-500/10 text-teal-400 border-teal-500/20" },
  { value: "specialist", label: "Specialists", icon: Sparkles, color: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
  { value: "researcher", label: "Researchers", icon: BookOpen, color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  { value: "writer", label: "Writers", icon: FileText, color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
];

const SKILL_CATEGORIES: CategoryDef[] = [
  { value: "all", label: "All", icon: Layers },
  { value: "workflow", label: "Workflow", icon: Workflow, color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  { value: "git", label: "Git", icon: GitBranch, color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  { value: "code-quality", label: "Code Quality", icon: Code, color: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" },
  { value: "testing", label: "Testing", icon: TestTube, color: "bg-lime-500/10 text-lime-400 border-lime-500/20" },
  { value: "security", label: "Security", icon: Shield, color: "bg-red-500/10 text-red-400 border-red-500/20" },
  { value: "documentation", label: "Docs", icon: FileText, color: "bg-sky-500/10 text-sky-400 border-sky-500/20" },
  { value: "engineering", label: "Engineering", icon: Wrench, color: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20" },
  { value: "design", label: "Design", icon: Palette, color: "bg-pink-500/10 text-pink-400 border-pink-500/20" },
  { value: "marketing", label: "Marketing", icon: Megaphone, color: "bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20" },
  { value: "business", label: "Business", icon: Briefcase, color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
];

const COMMAND_CATEGORIES: CategoryDef[] = [
  { value: "all", label: "All", icon: Layers },
  { value: "workflow", label: "Workflow", icon: Workflow, color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  { value: "git", label: "Git", icon: GitBranch, color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  { value: "utility", label: "Utility", icon: Wrench, color: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20" },
];

const TAB_CONFIG = {
  agents: { icon: Bot, label: "Agents", categories: AGENT_CATEGORIES },
  skills: { icon: Zap, label: "Skills", categories: SKILL_CATEGORIES },
  commands: { icon: Terminal, label: "Commands", categories: COMMAND_CATEGORIES },
} as const;

type ActiveTab = keyof typeof TAB_CONFIG;

// ============================================
// Helper Functions
// ============================================

function getCategoryColor(tab: ActiveTab, category: string): string {
  const cats = TAB_CONFIG[tab].categories;
  const found = cats.find((c) => c.value === category);
  return found?.color || "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
}

function getCategoryIconDef(tab: ActiveTab, category: string): LucideIcon {
  const cats = TAB_CONFIG[tab].categories;
  const found = cats.find((c) => c.value === category);
  return found?.icon || Layers;
}

// Renders a category icon without triggering React Compiler's static-components rule
function renderCatIcon(tab: ActiveTab, category: string, className?: string) {
  return createElement(getCategoryIconDef(tab, category), { className });
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

function matchesSearch(search: string, ...fields: (string | undefined | null)[]): boolean {
  if (!search) return true;
  const lower = search.toLowerCase();
  return fields.some((f) => f?.toLowerCase().includes(lower));
}

// ============================================
// Agent Card
// ============================================

interface AgentCardProps {
  agent: CatalogAgent;
  onClick: () => void;
  isSelected: boolean;
}

function AgentCard({ agent, onClick, isSelected }: AgentCardProps) {
  return (
    <div
      onClick={onClick}
      className={`glass-card rounded-xl p-5 cursor-pointer transition-all hover:scale-[1.02] hover:border-border ${
        isSelected ? "border-primary ring-2 ring-primary/20" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div
          className={`flex items-center justify-center h-10 w-10 rounded-lg ${getCategoryColor("agents", agent.category)}`}
        >
          {renderCatIcon("agents", agent.category, "h-5 w-5")}
        </div>
        <Badge
          variant="outline"
          className={`text-[10px] px-2 py-0.5 ${getCategoryColor("agents", agent.category)}`}
        >
          {agent.category}
        </Badge>
      </div>

      <div className="mb-1.5">
        <code className="text-sm font-semibold text-foreground bg-zinc-800/50 px-2 py-1 rounded">
          {agent.id}
        </code>
      </div>

      <p className="text-xs font-medium text-foreground mb-1">{agent.name}</p>
      <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
        {agent.description}
      </p>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Wrench className="h-3 w-3" />
          <span>{agent.tools?.length || 0} tools</span>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Skill Card
// ============================================

interface SkillCardProps {
  skill: CatalogSkill;
  onClick: () => void;
  isSelected: boolean;
}

function SkillCard({ skill, onClick, isSelected }: SkillCardProps) {
  return (
    <div
      onClick={onClick}
      className={`glass-card rounded-xl p-5 cursor-pointer transition-all hover:scale-[1.02] hover:border-border ${
        isSelected ? "border-primary ring-2 ring-primary/20" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div
          className={`flex items-center justify-center h-10 w-10 rounded-lg ${getCategoryColor("skills", skill.category)}`}
        >
          {renderCatIcon("skills", skill.category, "h-5 w-5")}
        </div>
        <Badge
          variant="outline"
          className={`text-[10px] px-2 py-0.5 ${getCategoryColor("skills", skill.category)}`}
        >
          {skill.category}
        </Badge>
      </div>

      <div className="mb-1.5">
        <code className="text-sm font-semibold text-foreground bg-zinc-800/50 px-2 py-1 rounded">
          /{skill.id}
        </code>
      </div>

      <p className="text-xs font-medium text-foreground mb-1">{skill.name}</p>
      <p className="text-xs text-muted-foreground line-clamp-2">
        {skill.description}
      </p>
    </div>
  );
}

// ============================================
// Command Card
// ============================================

interface CommandCardProps {
  command: CatalogCommand;
  onClick: () => void;
  isSelected: boolean;
}

function CommandCard({ command, onClick, isSelected }: CommandCardProps) {
  return (
    <div
      onClick={onClick}
      className={`glass-card rounded-xl p-5 cursor-pointer transition-all hover:scale-[1.02] hover:border-border ${
        isSelected ? "border-primary ring-2 ring-primary/20" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div
          className={`flex items-center justify-center h-10 w-10 rounded-lg ${getCategoryColor("commands", command.category)}`}
        >
          {renderCatIcon("commands", command.category, "h-5 w-5")}
        </div>
        <Badge
          variant="outline"
          className={`text-[10px] px-2 py-0.5 ${getCategoryColor("commands", command.category)}`}
        >
          {command.category}
        </Badge>
      </div>

      <div className="mb-1.5">
        <code className="text-sm font-semibold text-foreground bg-zinc-800/50 px-2 py-1 rounded">
          /{command.name}
        </code>
      </div>

      <p className="text-xs text-muted-foreground line-clamp-2">
        {command.description}
      </p>
    </div>
  );
}

// ============================================
// Detail Panels
// ============================================

function AgentDetailPanel({ agent, onClose }: { agent: CatalogAgent; onClose: () => void }) {
  return (
    <div className="glass-card rounded-xl p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className={`flex items-center justify-center h-12 w-12 rounded-lg ${getCategoryColor("agents", agent.category)}`}
          >
            {renderCatIcon("agents", agent.category, "h-6 w-6")}
          </div>
          <div>
            <code className="text-base font-bold text-foreground bg-zinc-800/50 px-2 py-1 rounded">
              {agent.id}
            </code>
            <p className="text-sm text-muted-foreground mt-1">{agent.name}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-zinc-800 rounded-lg transition-colors"
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <Badge
          variant="outline"
          className={`text-xs ${getCategoryColor("agents", agent.category)}`}
        >
          {agent.category}
        </Badge>
      </div>

      <div className="mb-6">
        <h4 className="text-sm font-semibold mb-2">Description</h4>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {agent.description}
        </p>
      </div>

      {agent.tools && agent.tools.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Wrench className="h-4 w-4" />
            Tools ({agent.tools.length})
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {agent.tools.map((tool) => (
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
    </div>
  );
}

function SkillDetailPanel({ skill, onClose }: { skill: CatalogSkill; onClose: () => void }) {
  return (
    <div className="glass-card rounded-xl p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className={`flex items-center justify-center h-12 w-12 rounded-lg ${getCategoryColor("skills", skill.category)}`}
          >
            {renderCatIcon("skills", skill.category, "h-6 w-6")}
          </div>
          <div>
            <code className="text-base font-bold text-foreground bg-zinc-800/50 px-2 py-1 rounded">
              /{skill.id}
            </code>
            <p className="text-sm text-muted-foreground mt-1">{skill.name}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-zinc-800 rounded-lg transition-colors"
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <Badge
          variant="outline"
          className={`text-xs ${getCategoryColor("skills", skill.category)}`}
        >
          {skill.category}
        </Badge>
      </div>

      <div className="mb-6">
        <h4 className="text-sm font-semibold mb-2">Description</h4>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {skill.description}
        </p>
      </div>

      <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
        <h4 className="text-xs font-semibold text-muted-foreground mb-2">Usage</h4>
        <code className="text-sm text-foreground">
          Skill tool -&gt; skill: &quot;{skill.id}&quot;
        </code>
      </div>
    </div>
  );
}

function CommandDetailPanel({ command, onClose }: { command: CatalogCommand; onClose: () => void }) {
  return (
    <div className="glass-card rounded-xl p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className={`flex items-center justify-center h-12 w-12 rounded-lg ${getCategoryColor("commands", command.category)}`}
          >
            {renderCatIcon("commands", command.category, "h-6 w-6")}
          </div>
          <div>
            <code className="text-base font-bold text-foreground bg-zinc-800/50 px-2 py-1 rounded">
              /{command.name}
            </code>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-zinc-800 rounded-lg transition-colors"
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <Badge
          variant="outline"
          className={`text-xs ${getCategoryColor("commands", command.category)}`}
        >
          {command.category}
        </Badge>
      </div>

      <div className="mb-6">
        <h4 className="text-sm font-semibold mb-2">Description</h4>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {command.description}
        </p>
      </div>

      <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
        <h4 className="text-xs font-semibold text-muted-foreground mb-2">Usage</h4>
        <code className="text-sm text-foreground">/{command.name}</code>
      </div>
    </div>
  );
}

// ============================================
// Skeleton Loader
// ============================================

function CardSkeleton() {
  return (
    <div className="glass-card rounded-xl p-5">
      <div className="flex items-start justify-between mb-3">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <Skeleton className="h-5 w-20 rounded" />
      </div>
      <Skeleton className="h-6 w-32 mb-2" />
      <Skeleton className="h-4 w-full mb-1" />
      <Skeleton className="h-4 w-3/4 mb-3" />
      <Skeleton className="h-4 w-20" />
    </div>
  );
}

// ============================================
// Category Filter Chips
// ============================================

function CategoryChips({
  categories,
  active,
  onChange,
}: {
  categories: CategoryDef[];
  active: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {categories.map((cat) => {
        const Icon = cat.icon;
        const isActive = active === cat.value;
        return (
          <button
            key={cat.value}
            onClick={() => onChange(cat.value)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
              isActive
                ? cat.color
                  ? `${cat.color} border-current`
                  : "bg-foreground/10 text-foreground border-foreground/20"
                : "bg-transparent text-muted-foreground border-zinc-800 hover:border-zinc-700 hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {cat.label}
          </button>
        );
      })}
    </div>
  );
}

// ============================================
// Main Registry Page
// ============================================

type SelectedItem =
  | { type: "agent"; data: CatalogAgent }
  | { type: "skill"; data: CatalogSkill }
  | { type: "command"; data: CatalogCommand };

export default function RegistryPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("agents");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selected, setSelected] = useState<SelectedItem | null>(null);

  const debouncedSearch = useDebounce(searchQuery, 300);

  // Fetch ALL catalog data once, filter client-side
  const { data, isLoading, error } = useQuery({
    queryKey: ["registry-catalog"],
    queryFn: () => apiClient.getRegistryCatalog(),
    refetchInterval: 60000,
  });

  // Reset category filter and selection when switching tabs
  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab as ActiveTab);
    setCategoryFilter("all");
    setSelected(null);
  }, []);

  // Reset selection when category changes
  const handleCategoryChange = useCallback((cat: string) => {
    setCategoryFilter(cat);
    setSelected(null);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelected(null);
  }, []);

  // Filtered lists - React Compiler handles memoization automatically
  const agents = data?.agents ?? [];
  const skills = data?.skills ?? [];
  const commands = data?.commands ?? [];

  const filteredAgents = agents.filter((a) => {
    if (categoryFilter !== "all" && a.category !== categoryFilter) return false;
    return matchesSearch(debouncedSearch, a.id, a.name, a.description);
  });

  const filteredSkills = skills.filter((s) => {
    if (categoryFilter !== "all" && s.category !== categoryFilter) return false;
    return matchesSearch(debouncedSearch, s.id, s.name, s.description);
  });

  const filteredCommands = commands.filter((c) => {
    if (categoryFilter !== "all" && c.category !== categoryFilter) return false;
    return matchesSearch(debouncedSearch, c.id, c.name, c.description);
  });

  // Counts from API response
  const counts = data?.counts || { agents: 0, skills: 0, commands: 0 };

  // Current filtered count for footer
  const currentFilteredCount =
    activeTab === "agents"
      ? filteredAgents.length
      : activeTab === "skills"
        ? filteredSkills.length
        : filteredCommands.length;

  const currentTotalCount =
    activeTab === "agents"
      ? agents.length
      : activeTab === "skills"
        ? skills.length
        : commands.length;

  // Search placeholder per tab
  const searchPlaceholder =
    activeTab === "agents"
      ? "Search agents by id, name, or description..."
      : activeTab === "skills"
        ? "Search skills by id, name, or description..."
        : "Search commands by name or description...";

  return (
    <PageContainer
      title="Registry"
      description="Browse agents, skills, and commands"
    >
      <div className="flex flex-col gap-6">
        {/* Top-level Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
        >
          <TabsList variant="line" className="w-full">
            {(Object.keys(TAB_CONFIG) as ActiveTab[]).map((tabKey) => {
              const config = TAB_CONFIG[tabKey];
              const Icon = config.icon;
              const count = counts[tabKey];
              return (
                <TabsTrigger key={tabKey} value={tabKey} className="gap-1.5">
                  <Icon className="h-3.5 w-3.5" />
                  {config.label}
                  <span className="ml-1 text-muted-foreground text-[10px]">
                    ({count})
                  </span>
                </TabsTrigger>
              );
            })}
          </TabsList>

          {/* Shared controls below tabs */}
          <div className="flex flex-col gap-4 mt-4">
            {/* Search bar */}
            <div className="relative w-full lg:w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-9"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 hover:bg-zinc-800 rounded transition-colors"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              )}
            </div>

            {/* Category filter chips */}
            <CategoryChips
              categories={TAB_CONFIG[activeTab].categories}
              active={categoryFilter}
              onChange={handleCategoryChange}
            />
          </div>

          {/* Loading State */}
          {isLoading && (
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 mt-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          )}

          {/* Error State */}
          {error && (
            <Card className="glass-card p-8 text-center mt-4">
              <Shield className="h-12 w-12 text-red-500 mx-auto mb-3" />
              <h3 className="text-lg font-semibold mb-2">Failed to Load Registry</h3>
              <p className="text-sm text-muted-foreground">
                {error instanceof Error ? error.message : "Unknown error"}
              </p>
            </Card>
          )}

          {/* Agents Tab Content */}
          {!isLoading && !error && (
            <TabsContent value="agents" className="mt-4">
              {filteredAgents.length === 0 ? (
                <Card className="glass-card p-8 text-center">
                  <Bot className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                  <h3 className="text-lg font-semibold mb-2">No Agents Found</h3>
                  <p className="text-sm text-muted-foreground">
                    {debouncedSearch
                      ? `No agents match "${debouncedSearch}"`
                      : `No agents in category "${categoryFilter}"`}
                  </p>
                </Card>
              ) : (
                <div className="grid gap-4 lg:grid-cols-3">
                  <div
                    className={`grid gap-4 grid-cols-1 md:grid-cols-2 ${
                      selected?.type === "agent"
                        ? "lg:col-span-2"
                        : "lg:col-span-3 lg:grid-cols-3"
                    }`}
                  >
                    {filteredAgents.map((agent) => (
                      <AgentCard
                        key={agent.id}
                        agent={agent}
                        onClick={() => setSelected({ type: "agent", data: agent })}
                        isSelected={selected?.type === "agent" && selected.data.id === agent.id}
                      />
                    ))}
                  </div>

                  {selected?.type === "agent" && (
                    <div className="lg:col-span-1 animate-slide-in-right">
                      <div className="sticky top-6">
                        <AgentDetailPanel
                          agent={selected.data}
                          onClose={handleCloseDetail}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
          )}

          {/* Skills Tab Content */}
          {!isLoading && !error && (
            <TabsContent value="skills" className="mt-4">
              {filteredSkills.length === 0 ? (
                <Card className="glass-card p-8 text-center">
                  <Zap className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                  <h3 className="text-lg font-semibold mb-2">No Skills Found</h3>
                  <p className="text-sm text-muted-foreground">
                    {debouncedSearch
                      ? `No skills match "${debouncedSearch}"`
                      : `No skills in category "${categoryFilter}"`}
                  </p>
                </Card>
              ) : (
                <div className="grid gap-4 lg:grid-cols-3">
                  <div
                    className={`grid gap-4 grid-cols-1 md:grid-cols-2 ${
                      selected?.type === "skill"
                        ? "lg:col-span-2"
                        : "lg:col-span-3 lg:grid-cols-3"
                    }`}
                  >
                    {filteredSkills.map((skill) => (
                      <SkillCard
                        key={skill.id}
                        skill={skill}
                        onClick={() => setSelected({ type: "skill", data: skill })}
                        isSelected={selected?.type === "skill" && selected.data.id === skill.id}
                      />
                    ))}
                  </div>

                  {selected?.type === "skill" && (
                    <div className="lg:col-span-1 animate-slide-in-right">
                      <div className="sticky top-6">
                        <SkillDetailPanel
                          skill={selected.data}
                          onClose={handleCloseDetail}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
          )}

          {/* Commands Tab Content */}
          {!isLoading && !error && (
            <TabsContent value="commands" className="mt-4">
              {filteredCommands.length === 0 ? (
                <Card className="glass-card p-8 text-center">
                  <Terminal className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                  <h3 className="text-lg font-semibold mb-2">No Commands Found</h3>
                  <p className="text-sm text-muted-foreground">
                    {debouncedSearch
                      ? `No commands match "${debouncedSearch}"`
                      : `No commands in category "${categoryFilter}"`}
                  </p>
                </Card>
              ) : (
                <div className="grid gap-4 lg:grid-cols-3">
                  <div
                    className={`grid gap-4 grid-cols-1 md:grid-cols-2 ${
                      selected?.type === "command"
                        ? "lg:col-span-2"
                        : "lg:col-span-3 lg:grid-cols-3"
                    }`}
                  >
                    {filteredCommands.map((command) => (
                      <CommandCard
                        key={command.id}
                        command={command}
                        onClick={() => setSelected({ type: "command", data: command })}
                        isSelected={selected?.type === "command" && selected.data.id === command.id}
                      />
                    ))}
                  </div>

                  {selected?.type === "command" && (
                    <div className="lg:col-span-1 animate-slide-in-right">
                      <div className="sticky top-6">
                        <CommandDetailPanel
                          command={selected.data}
                          onClose={handleCloseDetail}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
          )}
        </Tabs>

        {/* Footer count */}
        {!isLoading && !error && data && (
          <div className="flex justify-between items-center text-xs text-muted-foreground">
            <span>
              Showing {currentFilteredCount} of {currentTotalCount} {activeTab}
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
