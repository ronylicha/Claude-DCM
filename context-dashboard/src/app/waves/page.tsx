"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer } from "@/components/PageContainer";
import { PremiumKPICard } from "@/components/dashboard";
import apiClient, {
  type WaveState,
  type AgentCapacity,
  type ActiveSessionsResponse,
} from "@/lib/api-client";
import { useWaveEvents } from "@/hooks/useWebSocket";
import {
  Layers,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Target,
  TrendingUp,
  Radio,
  Users,
  Bot,
  Hash,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================
// Constants & Config
// ============================================

const ZONE_COLORS: Record<string, string> = {
  green: "#22c55e",
  yellow: "#eab308",
  orange: "#f97316",
  red: "#ef4444",
  critical: "#dc2626",
};

const STATUS_CONFIG: Record<string, { color: string; bg: string; border: string; icon: string; label: string }> = {
  completed: { color: "text-emerald-400", bg: "bg-emerald-500/20", border: "border-emerald-500/40", icon: "emerald", label: "Completed" },
  running:   { color: "text-blue-400",    bg: "bg-blue-500/20",    border: "border-blue-500/40",    icon: "blue",    label: "Running" },
  failed:    { color: "text-red-400",     bg: "bg-red-500/20",     border: "border-red-500/40",     icon: "red",     label: "Failed" },
  blocked:   { color: "text-amber-400",   bg: "bg-amber-500/20",   border: "border-amber-500/40",   icon: "amber",   label: "Blocked" },
  pending:   { color: "text-zinc-300",    bg: "bg-zinc-500/20",    border: "border-zinc-500/40",    icon: "zinc",    label: "Pending" },
};

// ============================================
// Helpers
// ============================================

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function cfg(status: string) {
  return STATUS_CONFIG[status] || STATUS_CONFIG.pending;
}

function statusIcon(status: string, size = "h-4 w-4") {
  switch (status) {
    case "completed": return <CheckCircle2 className={size} />;
    case "running":   return <Activity className={cn(size, "animate-pulse")} />;
    case "failed":    return <XCircle className={size} />;
    case "blocked":   return <AlertTriangle className={size} />;
    default:          return <Clock className={size} />;
  }
}

// ============================================
// Wave Timeline Item
// ============================================

function WaveTimelineItem({ wave, isSelected, isLast, onClick }: {
  wave: WaveState; isSelected: boolean; isLast: boolean; onClick: () => void;
}) {
  const progress = wave.total_tasks > 0 ? (wave.completed_tasks / wave.total_tasks) * 100 : 0;
  const c = cfg(wave.status);

  return (
    <div className="relative flex gap-3 cursor-pointer" onClick={onClick}>
      {/* Connector line + circle */}
      <div className="flex flex-col items-center shrink-0">
        <div className={cn(
          "flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all duration-200",
          c.border, c.bg,
          isSelected ? "ring-2 ring-blue-500/50 scale-110" : "hover:scale-105",
        )}>
          <span className={cn("text-sm font-bold", c.color)}>{wave.wave_number}</span>
        </div>
        {!isLast && (
          <div className={cn(
            "w-0.5 flex-1 min-h-[20px]",
            wave.status === "completed" ? "bg-emerald-500/50" : "bg-zinc-600/40",
          )} />
        )}
      </div>

      {/* Card */}
      <div className={cn(
        "flex-1 rounded-lg p-3 mb-2 transition-all duration-200 border",
        isSelected
          ? "bg-zinc-800/90 border-blue-500/50 shadow-lg shadow-blue-500/5"
          : "bg-zinc-800/40 border-zinc-700/40 hover:bg-zinc-800/60 hover:border-zinc-600/60",
      )}>
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-100">Wave {wave.wave_number}</span>
            <Badge variant="outline" className={cn("text-[11px] px-1.5 py-0", c.color, c.border)}>
              {c.label}
            </Badge>
          </div>
          <span className="text-xs text-zinc-400 font-mono tabular-nums">
            {wave.completed_tasks}/{wave.total_tasks}
          </span>
        </div>

        {/* Progress bar */}
        <div className="relative h-1.5 bg-zinc-700/50 rounded-full overflow-hidden">
          <div
            className={cn(
              "absolute top-0 left-0 h-full rounded-full transition-all duration-700",
              wave.status === "completed" ? "bg-emerald-500" :
              wave.status === "running" ? "bg-blue-500" :
              wave.status === "failed" ? "bg-red-500" : "bg-zinc-500",
            )}
            style={{ width: `${Math.max(progress, 2)}%` }}
          />
        </div>

        {/* Meta */}
        <div className="flex items-center gap-3 mt-1.5 text-xs text-zinc-400">
          {wave.started_at && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {new Date(wave.started_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {wave.failed_tasks > 0 && (
            <span className="flex items-center gap-1 text-red-400">
              <XCircle className="h-3 w-3" /> {wave.failed_tasks} failed
            </span>
          )}
          {wave.status === "completed" && wave.started_at && wave.completed_at && (
            <span className="text-emerald-400">
              {formatDuration(new Date(wave.completed_at).getTime() - new Date(wave.started_at).getTime())}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Wave Detail Panel
// ============================================

function WaveDetailPanel({ wave, sessionId }: { wave: WaveState; sessionId: string }) {
  const { data: tasksData, isLoading: tasksLoading } = useQuery({
    queryKey: ["wave-tasks", sessionId, wave.wave_number],
    queryFn: async () => {
      const requests = await apiClient.getRequests({ session_id: sessionId });
      if (!requests || requests.length === 0) return [];
      const allTasks = await Promise.all(
        requests.map(req => apiClient.getTasks({ request_id: req.id }).catch(() => []))
      );
      return allTasks.flat().filter(task => task.wave_number === wave.wave_number);
    },
    enabled: !!sessionId,
  });

  const duration = wave.started_at && wave.completed_at
    ? new Date(wave.completed_at).getTime() - new Date(wave.started_at).getTime()
    : wave.started_at
    ? Date.now() - new Date(wave.started_at).getTime()
    : 0;

  const c = cfg(wave.status);

  return (
    <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/60 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-zinc-700/40 flex items-center gap-3">
        <div className={cn("flex items-center justify-center h-10 w-10 rounded-lg", c.bg, c.border, "border")}>
          <span className={c.color}>{statusIcon(wave.status)}</span>
        </div>
        <div>
          <h3 className="text-base font-semibold text-zinc-100">Wave {wave.wave_number}</h3>
          <p className={cn("text-xs font-medium", c.color)}>{c.label}</p>
        </div>
        {wave.status === "running" && (
          <div className="ml-auto flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-xs text-blue-400 font-medium">In Progress</span>
          </div>
        )}
      </div>

      <div className="p-5 space-y-4">
        {/* Timing row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-zinc-800/60 border border-zinc-700/30">
            <div className="text-[11px] uppercase tracking-wider text-zinc-400 mb-1">Started</div>
            <div className="text-sm font-medium text-zinc-100">
              {wave.started_at
                ? new Date(wave.started_at).toLocaleString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                : "Not started"}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-zinc-800/60 border border-zinc-700/30">
            <div className="text-[11px] uppercase tracking-wider text-zinc-400 mb-1">Duration</div>
            <div className="text-sm font-medium text-zinc-100">
              {duration > 0 ? formatDuration(duration) : "\u2014"}
            </div>
          </div>
        </div>

        {/* Task counters */}
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center p-3 rounded-lg bg-zinc-800/60 border border-zinc-700/30">
            <div className="text-2xl font-bold text-zinc-100">{wave.total_tasks}</div>
            <div className="text-[11px] uppercase tracking-wider text-zinc-400 mt-0.5">Total</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-emerald-950/30 border border-emerald-700/30">
            <div className="text-2xl font-bold text-emerald-400">{wave.completed_tasks}</div>
            <div className="text-[11px] uppercase tracking-wider text-emerald-400/70 mt-0.5">Done</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-red-950/30 border border-red-700/30">
            <div className="text-2xl font-bold text-red-400">{wave.failed_tasks}</div>
            <div className="text-[11px] uppercase tracking-wider text-red-400/70 mt-0.5">Failed</div>
          </div>
        </div>

        {/* Task list */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2 flex items-center gap-1.5">
            <ChevronRight className="h-3.5 w-3.5" />
            Tasks ({tasksData?.length ?? 0})
          </h4>
          {tasksLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : tasksData && tasksData.length > 0 ? (
            <div className="space-y-1.5 max-h-[220px] overflow-y-auto">
              {tasksData.map((task) => {
                const tc = cfg(task.status);
                return (
                  <div key={task.id} className="flex items-center gap-2 p-2.5 rounded-lg bg-zinc-800/40 border border-zinc-700/30">
                    <span className={tc.color}>{statusIcon(task.status, "h-3.5 w-3.5")}</span>
                    <span className="text-sm flex-1 truncate text-zinc-200">
                      {task.name || `Task ${task.id.slice(0, 8)}`}
                    </span>
                    <Badge variant="outline" className={cn("text-[10px]", tc.color, tc.border)}>{task.status}</Badge>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-zinc-500 text-center py-4 bg-zinc-800/20 rounded-lg border border-zinc-800/40">
              No tasks in this wave
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Agent Capacity Gauge
// ============================================

function AgentCapacityGauge({ agentId }: { agentId: string }) {
  const { data, isLoading } = useQuery<AgentCapacity>({
    queryKey: ["capacity", agentId],
    queryFn: () => apiClient.getCapacity(agentId),
    refetchInterval: 30000,
  });

  if (isLoading) return <Skeleton className="h-16 w-full rounded-lg" />;
  if (!data) return null;

  const strokeColor = ZONE_COLORS[data.zone] || ZONE_COLORS.green;
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (data.usage_percent / 100) * circumference;

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/40 border border-zinc-700/30">
      <div className="relative shrink-0">
        <svg viewBox="0 0 64 64" className="w-12 h-12">
          <circle cx="32" cy="32" r={radius} fill="none" stroke="currentColor" strokeWidth="4" className="text-zinc-700" />
          <circle
            cx="32" cy="32" r={radius} fill="none" stroke={strokeColor} strokeWidth="4"
            strokeDasharray={circumference} strokeDashoffset={offset}
            strokeLinecap="round" transform="rotate(-90 32 32)"
            style={{ transition: "stroke-dashoffset 0.5s ease-out" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[11px] font-bold" style={{ color: strokeColor }}>
            {Math.round(data.usage_percent)}%
          </span>
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate text-zinc-200">{agentId}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0" style={{ borderColor: strokeColor, color: strokeColor }}>
            {data.zone}
          </Badge>
          <span className="text-[11px] text-zinc-400 flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5" /> {data.minutes_remaining}m
          </span>
        </div>
        {data.shouldIntervene && (
          <div className="flex items-center gap-1 mt-0.5 text-[11px] text-amber-400 font-medium">
            <AlertTriangle className="h-2.5 w-2.5" /> Needs intervention
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Wave Distribution Chart
// ============================================

function WaveDistributionChart({ waves }: { waves: WaveState[] }) {
  const chartData = useMemo(() => {
    return waves.map(w => ({
      name: `W${w.wave_number}`,
      completed: w.completed_tasks,
      failed: w.failed_tasks,
      pending: Math.max(0, w.total_tasks - w.completed_tasks - w.failed_tasks),
    }));
  }, [waves]);

  if (chartData.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={180}>
      <RechartsBarChart data={chartData} barSize={24}>
        <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" opacity={0.3} />
        <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#a1a1aa" }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 12, fill: "#a1a1aa" }} tickLine={false} axisLine={false} width={30} />
        <RechartsTooltip
          contentStyle={{
            backgroundColor: "#18181b",
            border: "1px solid #3f3f46",
            borderRadius: "8px",
            fontSize: "12px",
            color: "#e4e4e7",
          }}
        />
        <Bar dataKey="completed" stackId="a" fill="#22c55e" radius={[0, 0, 0, 0]} name="Done" />
        <Bar dataKey="failed" stackId="a" fill="#ef4444" name="Failed" />
        <Bar dataKey="pending" stackId="a" fill="#52525b" radius={[3, 3, 0, 0]} name="Pending" />
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}

// ============================================
// Live Events Feed
// ============================================

function WaveEventsFeed({ events }: { events: Array<{ event: string; data: unknown; timestamp: number }> }) {
  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-zinc-500 text-sm">
        <Radio className="h-6 w-6 mx-auto mb-2 opacity-40" />
        Waiting for live events...
      </div>
    );
  }

  return (
    <div className="space-y-1 max-h-[240px] overflow-y-auto">
      {events.slice(0, 20).map((evt, i) => {
        const data = evt.data as Record<string, unknown> | null;
        return (
          <div key={`${evt.timestamp}-${i}`} className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs hover:bg-zinc-800/40 transition-colors">
            <span className="text-zinc-400 font-mono w-[56px] shrink-0 tabular-nums">
              {new Date(evt.timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 border-zinc-600 text-zinc-300">
              {evt.event}
            </Badge>
            <span className="text-zinc-400 truncate">
              {(data?.description as string) || (data?.status as string) || ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ============================================
// Active Agents Panel (enrichment when waves are sparse)
// ============================================

function SessionAgentsPanel({ agents }: { agents: Array<{ agent_type: string; agent_id: string; description: string; started_at: string | null }> }) {
  if (agents.length === 0) {
    return (
      <div className="text-center py-6 text-zinc-500 text-sm">
        <Bot className="h-6 w-6 mx-auto mb-2 opacity-40" />
        No agents in this session
      </div>
    );
  }

  return (
    <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
      {agents.map((agent) => (
        <div key={agent.agent_id || agent.agent_type} className="flex items-center gap-2.5 p-2.5 rounded-lg bg-zinc-800/40 border border-zinc-700/30">
          <div className="flex items-center justify-center h-8 w-8 rounded-md bg-blue-500/15 border border-blue-500/20 shrink-0">
            <Bot className="h-3.5 w-3.5 text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-zinc-200 truncate">{agent.agent_type}</div>
            <div className="text-[11px] text-zinc-500 truncate">{agent.description}</div>
          </div>
          {agent.started_at && (
            <span className="text-[11px] text-zinc-500 shrink-0 tabular-nums">
              {new Date(agent.started_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 border-emerald-500/30 text-emerald-400">
            active
          </Badge>
        </div>
      ))}
    </div>
  );
}

// ============================================
// Main Page
// ============================================

export default function WavesPage() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedWaveId, setSelectedWaveId] = useState<string | null>(null);

  // --- Data: sessions (both active-sessions + recent) ---

  const { data: activeData, isLoading: activeLoading } = useQuery<ActiveSessionsResponse>({
    queryKey: ["active-sessions"],
    queryFn: () => apiClient.getActiveSessions(),
    refetchInterval: 8000,
  });

  const { data: recentSessionsData } = useQuery({
    queryKey: ["recent-sessions"],
    queryFn: () => apiClient.getSessions(1, 10),
    refetchInterval: 15000,
  });

  // Merged session list: active first, then recent non-active
  const sessionOptions = useMemo(() => {
    const activeAgents = activeData?.active_agents ?? [];
    const activeSessionIds = new Set<string>();
    const options: Array<{ id: string; label: string; isActive: boolean; agentCount: number }> = [];

    // Active sessions (deduplicated)
    for (const agent of activeAgents) {
      if (activeSessionIds.has(agent.session_id)) continue;
      activeSessionIds.add(agent.session_id);
      const count = activeAgents.filter(a => a.session_id === agent.session_id).length;
      options.push({
        id: agent.session_id,
        label: `${agent.session_id.slice(0, 12)}... - ${agent.project_name || "Unknown"}`,
        isActive: true,
        agentCount: count,
      });
    }

    // Recent non-active sessions
    const recentSessions = recentSessionsData?.data ?? [];
    for (const sess of recentSessions) {
      if (activeSessionIds.has(sess.id)) continue;
      options.push({
        id: sess.id,
        label: `${sess.id.slice(0, 12)}... - ${sess.ended_at ? "ended" : "idle"}`,
        isActive: false,
        agentCount: 0,
      });
    }

    return options;
  }, [activeData, recentSessionsData]);

  // Auto-select first session
  useEffect(() => {
    if (!selectedSessionId && sessionOptions.length > 0) {
      setSelectedSessionId(sessionOptions[0].id);
    }
  }, [sessionOptions, selectedSessionId]);

  // --- Data: waves ---

  const { data: waveHistoryData, isLoading: wavesLoading } = useQuery({
    queryKey: ["wave-history", selectedSessionId],
    queryFn: () => apiClient.getWaveHistory(selectedSessionId!),
    enabled: !!selectedSessionId,
    refetchInterval: 5000,
  });

  const { data: currentWaveData } = useQuery({
    queryKey: ["wave-current", selectedSessionId],
    queryFn: () => apiClient.getWaveCurrent(selectedSessionId!),
    enabled: !!selectedSessionId,
    refetchInterval: 5000,
  });

  // --- Data: agents for selected session ---

  const sessionAgents = useMemo(() => {
    if (!selectedSessionId || !activeData) return [];
    return activeData.active_agents.filter(a => a.session_id === selectedSessionId);
  }, [activeData, selectedSessionId]);

  const agentIds = useMemo(() => {
    return sessionAgents
      .map(a => a.agent_id)
      .filter((id): id is string => !!id)
      .slice(0, 6);
  }, [sessionAgents]);

  const { events: waveEvents } = useWaveEvents(selectedSessionId || undefined);

  const waves = waveHistoryData?.waves ?? [];
  const selectedWave = waves.find(w => w.id === selectedWaveId) || currentWaveData?.wave || waves[0];

  // Auto-select first wave
  useEffect(() => {
    if (!selectedWaveId && waves.length > 0) {
      setSelectedWaveId(waves[0].id);
    }
  }, [waves, selectedWaveId]);

  // --- Computed KPIs ---

  const kpis = useMemo(() => {
    const totalTasks = waves.reduce((sum, w) => sum + w.total_tasks, 0);
    const completedTasks = waves.reduce((sum, w) => sum + w.completed_tasks, 0);
    const failedTasks = waves.reduce((sum, w) => sum + w.failed_tasks, 0);
    const runningWaves = waves.filter(w => w.status === "running").length;
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    return { totalWaves: waves.length, totalTasks, completedTasks, failedTasks, runningWaves, completionRate };
  }, [waves]);

  const selectedOption = sessionOptions.find(o => o.id === selectedSessionId);

  return (
    <PageContainer
      title="Waves"
      description="Monitor wave execution across sessions"
      actions={
        <div className="flex items-center gap-2">
          {waveEvents.length > 0 && (
            <Badge variant="outline" className="text-xs gap-1.5 border-emerald-500/30 text-emerald-400">
              <Radio className="h-3 w-3" />
              {waveEvents.length} events
            </Badge>
          )}
          <Badge variant="outline" className="text-xs gap-1.5 border-zinc-600 text-zinc-300">
            <Users className="h-3 w-3" />
            {sessionAgents.length} agents
          </Badge>
        </div>
      }
    >
      {/* ========== KPI Strip ========== */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <PremiumKPICard
          title="Total Waves"
          value={kpis.totalWaves}
          icon={<Layers className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-violet-500 to-purple-600"
          loading={wavesLoading}
        />
        <PremiumKPICard
          title="Tasks Completed"
          value={kpis.completedTasks}
          icon={<CheckCircle2 className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-emerald-500 to-green-600"
          trend={kpis.totalTasks > 0 ? { value: kpis.completionRate, label: "completion" } : undefined}
          loading={wavesLoading}
        />
        <PremiumKPICard
          title="Running Waves"
          value={kpis.runningWaves}
          icon={<Activity className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-blue-500 to-cyan-600"
          loading={wavesLoading}
        />
        <PremiumKPICard
          title="Failed Tasks"
          value={kpis.failedTasks}
          icon={<XCircle className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-red-500 to-rose-600"
          loading={wavesLoading}
        />
      </div>

      {/* ========== Session Selector ========== */}
      <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/60 p-4">
        <div className="flex items-center justify-between mb-2.5">
          <label className="text-sm font-medium text-zinc-200 flex items-center gap-2">
            <Hash className="h-4 w-4 text-zinc-400" />
            Session
          </label>
          <div className="flex items-center gap-2">
            {selectedOption?.isActive && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-emerald-500/30 text-emerald-400">
                Active
              </Badge>
            )}
            <span className="text-xs text-zinc-400">
              {sessionOptions.filter(s => s.isActive).length} active / {sessionOptions.length} total
            </span>
          </div>
        </div>
        {activeLoading ? (
          <Skeleton className="h-10 w-full rounded-lg" />
        ) : sessionOptions.length === 0 ? (
          <div className="text-sm text-zinc-500 text-center py-6">
            <Target className="h-8 w-8 mx-auto mb-2 opacity-40" />
            No sessions found
          </div>
        ) : (
          <div className="relative">
            <select
              className="w-full p-2.5 pr-8 rounded-lg bg-zinc-800/80 border border-zinc-600/50 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-colors appearance-none cursor-pointer"
              value={selectedSessionId || ""}
              onChange={(e) => {
                setSelectedSessionId(e.target.value);
                setSelectedWaveId(null);
              }}
            >
              {sessionOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.isActive ? "\u25CF " : "\u25CB "}{opt.label}{opt.agentCount > 0 ? ` (${opt.agentCount} agents)` : ""}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
          </div>
        )}
      </div>

      {/* ========== Main Content ========== */}
      {selectedSessionId && (
        <>
          {/* Two-column layout: Timeline + Detail */}
          <div className="grid gap-4 lg:grid-cols-5">
            {/* Left column: Wave Timeline */}
            <div className="lg:col-span-2 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2 text-zinc-300 uppercase tracking-wider">
                <Layers className="h-4 w-4 text-zinc-400" />
                Timeline
              </h3>

              {wavesLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-20 w-full rounded-lg" />
                  <Skeleton className="h-20 w-full rounded-lg" />
                </div>
              ) : waves.length === 0 ? (
                <div className="rounded-xl border border-zinc-700/40 bg-zinc-900/40 p-8 text-center">
                  <Layers className="h-10 w-10 mx-auto mb-3 text-zinc-600" />
                  <p className="text-sm text-zinc-400 font-medium">No waves for this session</p>
                  <p className="text-xs text-zinc-500 mt-1">Waves are created during orchestrated execution</p>
                </div>
              ) : (
                <div className="max-h-[500px] overflow-y-auto pr-1">
                  {waves.map((wave, i) => (
                    <WaveTimelineItem
                      key={wave.id}
                      wave={wave}
                      isSelected={selectedWaveId === wave.id}
                      isLast={i === waves.length - 1}
                      onClick={() => setSelectedWaveId(wave.id)}
                    />
                  ))}
                </div>
              )}

              {/* Agents in session (below timeline) */}
              {sessionAgents.length > 0 && (
                <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/60 p-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3 flex items-center gap-2">
                    <Bot className="h-3.5 w-3.5" />
                    Session Agents ({sessionAgents.length})
                  </h4>
                  <SessionAgentsPanel agents={sessionAgents} />
                </div>
              )}
            </div>

            {/* Right column: Selected wave detail + chart */}
            <div className="lg:col-span-3 space-y-4">
              {selectedWave && selectedSessionId ? (
                <WaveDetailPanel wave={selectedWave} sessionId={selectedSessionId} />
              ) : (
                <div className="rounded-xl border border-zinc-700/40 bg-zinc-900/40 p-8 text-center">
                  <ChevronRight className="h-8 w-8 mx-auto mb-2 text-zinc-600" />
                  <p className="text-sm text-zinc-400">Select a wave to see details</p>
                </div>
              )}

              {/* Distribution Chart */}
              {waves.length > 0 && (
                <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/60 p-5">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
                    Task Distribution
                  </h4>
                  <WaveDistributionChart waves={waves} />
                </div>
              )}
            </div>
          </div>

          {/* Bottom row: Agent Capacity + Live Events */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Agent Capacity */}
            <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/60 p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3 flex items-center gap-2">
                <Zap className="h-4 w-4" />
                Agent Capacity
              </h3>
              {agentIds.length === 0 ? (
                <div className="text-center py-6">
                  <Activity className="h-6 w-6 mx-auto mb-2 text-zinc-600" />
                  <p className="text-sm text-zinc-500">No capacity data</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {agentIds.map((id) => (
                    <AgentCapacityGauge key={id} agentId={id} />
                  ))}
                </div>
              )}
            </div>

            {/* Live Events */}
            <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/60 p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3 flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Live Events
              </h3>
              <WaveEventsFeed events={waveEvents} />
            </div>
          </div>
        </>
      )}
    </PageContainer>
  );
}
