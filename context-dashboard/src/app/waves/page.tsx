"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer } from "@/components/PageContainer";
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
  Minus,
  ChevronRight,
} from "lucide-react";

// ============================================
// Constants
// ============================================

const ZONE_COLORS: Record<string, string> = {
  green: "#22c55e",
  yellow: "#eab308",
  orange: "#f97316",
  red: "#ef4444",
  critical: "#dc2626",
};

// ============================================
// Helpers
// ============================================

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function getStatusColor(status: string): string {
  switch (status) {
    case "completed":
      return "text-green-500";
    case "running":
      return "text-violet-500";
    case "failed":
      return "text-red-500";
    case "blocked":
      return "text-amber-500";
    default:
      return "text-zinc-500";
  }
}

function getStatusBgColor(status: string): string {
  switch (status) {
    case "completed":
      return "bg-green-500";
    case "running":
      return "bg-violet-500";
    case "failed":
      return "bg-red-500";
    case "blocked":
      return "bg-amber-500";
    default:
      return "bg-zinc-500";
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-4 w-4" />;
    case "running":
      return <Activity className="h-4 w-4" />;
    case "failed":
      return <XCircle className="h-4 w-4" />;
    case "blocked":
      return <AlertTriangle className="h-4 w-4" />;
    default:
      return <Clock className="h-4 w-4" />;
  }
}

function getStatusEmoji(status: string): string {
  switch (status) {
    case "completed":
      return "✓";
    case "running":
      return "⚙";
    case "failed":
      return "✗";
    case "blocked":
      return "🔒";
    default:
      return "○";
  }
}

// ============================================
// Wave Progress Bar Component
// ============================================

interface WaveProgressBarProps {
  wave: WaveState;
  onClick: () => void;
  isSelected: boolean;
}

function WaveProgressBar({ wave, onClick, isSelected }: WaveProgressBarProps) {
  const progress = wave.total_tasks > 0
    ? (wave.completed_tasks / wave.total_tasks) * 100
    : 0;

  const statusColor = getStatusBgColor(wave.status);

  return (
    <div
      className={`glass-card rounded-lg p-4 cursor-pointer transition-all hover:border-violet-500/50 ${
        isSelected ? "border-violet-500" : ""
      }`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Layers className={`h-4 w-4 ${getStatusColor(wave.status)}`} />
          <span className="text-sm font-semibold">Wave {wave.wave_number}</span>
          <Badge variant="outline" className="text-xs">
            {wave.status}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {wave.completed_tasks}/{wave.total_tasks} tasks
          </span>
          <span className="text-lg">{getStatusEmoji(wave.status)}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="relative h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`absolute top-0 left-0 h-full ${statusColor} transition-all duration-500`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
        {wave.started_at && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {new Date(wave.started_at).toLocaleTimeString()}
          </span>
        )}
        {wave.failed_tasks > 0 && (
          <span className="flex items-center gap-1 text-red-500">
            <XCircle className="h-3 w-3" />
            {wave.failed_tasks} failed
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================
// Wave Detail Card Component
// ============================================

interface WaveDetailCardProps {
  wave: WaveState;
  sessionId: string;
}

function WaveDetailCard({ wave, sessionId }: WaveDetailCardProps) {
  // Fetch subtasks for this wave (we'll need to get them from tasks)
  const { data: tasksData } = useQuery({
    queryKey: ["wave-tasks", sessionId, wave.wave_number],
    queryFn: async () => {
      // Get all requests for this session
      const requests = await apiClient.getRequests({ session_id: sessionId });

      // Get all tasks for those requests, filtered by wave number
      const allTasks = await Promise.all(
        requests.map(req => apiClient.getTasks({ request_id: req.id }))
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

  return (
    <Card className="glass-card">
      <div className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className={`flex items-center justify-center h-10 w-10 rounded-lg ${getStatusBgColor(wave.status)}`}>
            {getStatusIcon(wave.status)}
          </div>
          <div>
            <h3 className="text-lg font-semibold">Wave {wave.wave_number} Details</h3>
            <p className="text-sm text-muted-foreground">
              {wave.status === "completed" ? "Completed" : wave.status === "running" ? "In Progress" : wave.status}
            </p>
          </div>
        </div>

        {/* Timing */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="p-3 rounded-lg bg-zinc-900/50 border border-zinc-800">
            <div className="text-xs text-muted-foreground mb-1">Started</div>
            <div className="text-sm font-medium">
              {wave.started_at ? new Date(wave.started_at).toLocaleString() : "Not started"}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-zinc-900/50 border border-zinc-800">
            <div className="text-xs text-muted-foreground mb-1">Duration</div>
            <div className="text-sm font-medium">
              {duration > 0 ? formatDuration(duration) : "—"}
            </div>
          </div>
        </div>

        {/* Task Stats */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="text-center p-3 rounded-lg bg-zinc-900/50 border border-zinc-800">
            <div className="text-2xl font-bold text-zinc-300">{wave.total_tasks}</div>
            <div className="text-xs text-muted-foreground">Total</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-green-950/30 border border-green-800/30">
            <div className="text-2xl font-bold text-green-500">{wave.completed_tasks}</div>
            <div className="text-xs text-muted-foreground">Completed</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-red-950/30 border border-red-800/30">
            <div className="text-2xl font-bold text-red-500">{wave.failed_tasks}</div>
            <div className="text-xs text-muted-foreground">Failed</div>
          </div>
        </div>

        {/* Task List */}
        <div>
          <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <ChevronRight className="h-4 w-4" />
            Tasks ({tasksData?.length || 0})
          </h4>
          {tasksData && tasksData.length > 0 ? (
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              {tasksData.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center gap-2 p-2 rounded-lg bg-zinc-900/50 border border-zinc-800"
                >
                  <div className={getStatusColor(task.status)}>
                    {getStatusIcon(task.status)}
                  </div>
                  <span className="text-sm flex-1 truncate">
                    {task.name || `Task ${task.id.slice(0, 8)}`}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {task.status}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-4">
              No tasks available
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ============================================
// Agent Capacity Gauge Component
// ============================================

interface AgentCapacityGaugeProps {
  agentId: string;
}

function AgentCapacityGauge({ agentId }: AgentCapacityGaugeProps) {
  const { data, isLoading } = useQuery<AgentCapacity>({
    queryKey: ["capacity", agentId],
    queryFn: () => apiClient.getCapacity(agentId),
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="glass-card rounded-lg p-4">
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const strokeColor = ZONE_COLORS[data.zone] || ZONE_COLORS.green;
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (data.usage_percent / 100) * circumference;

  return (
    <div className="glass-card rounded-lg p-4">
      <div className="flex items-center gap-3">
        {/* Gauge */}
        <div className="relative shrink-0">
          <svg viewBox="0 0 80 80" className="w-16 h-16">
            <circle
              cx="40"
              cy="40"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="5"
              className="text-zinc-800"
            />
            <circle
              cx="40"
              cy="40"
              r={radius}
              fill="none"
              stroke={strokeColor}
              strokeWidth="5"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              transform="rotate(-90 40 40)"
              style={{ transition: "stroke-dashoffset 0.5s ease-out" }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm font-bold" style={{ color: strokeColor }}>
              {Math.round(data.usage_percent)}%
            </span>
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate mb-1">{agentId}</div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge
              variant="outline"
              className="text-xs"
              style={{ borderColor: strokeColor, color: strokeColor }}
            >
              {data.zone}
            </Badge>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {data.minutes_remaining}
            </span>
          </div>
          {data.shouldIntervene && (
            <div className="flex items-center gap-1 mt-1 text-xs text-amber-500">
              <AlertTriangle className="h-3 w-3" />
              Intervention needed
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Wave Distribution Chart Component
// ============================================

interface WaveDistributionChartProps {
  waves: WaveState[];
}

function WaveDistributionChart({ waves }: WaveDistributionChartProps) {
  const chartData = useMemo(() => {
    return waves.map(w => ({
      name: `W${w.wave_number}`,
      completed: w.completed_tasks,
      failed: w.failed_tasks,
      pending: w.total_tasks - w.completed_tasks - w.failed_tasks,
    }));
  }, [waves]);

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground">
        No wave data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <RechartsBarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
        />
        <RechartsTooltip
          contentStyle={{
            backgroundColor: "rgba(0, 0, 0, 0.8)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            borderRadius: "8px",
          }}
        />
        <Bar dataKey="completed" stackId="a" fill="#22c55e" name="Completed" />
        <Bar dataKey="failed" stackId="a" fill="#ef4444" name="Failed" />
        <Bar dataKey="pending" stackId="a" fill="#71717a" name="Pending" />
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}

// ============================================
// Main Waves Page
// ============================================

export default function WavesPage() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedWaveId, setSelectedWaveId] = useState<string | null>(null);

  // Fetch active sessions for the dropdown
  const { data: sessionsData, isLoading: sessionsLoading } = useQuery<ActiveSessionsResponse>({
    queryKey: ["active-sessions"],
    queryFn: () => apiClient.getActiveSessions(),
    refetchInterval: 10000,
  });

  // Auto-select first session
  const sessions = sessionsData?.active_agents || [];
  const uniqueSessions = useMemo(() => {
    const seen = new Set<string>();
    return sessions.filter(agent => {
      if (seen.has(agent.session_id)) return false;
      seen.add(agent.session_id);
      return true;
    });
  }, [sessions]);

  // Auto-select first session if none selected
  if (!selectedSessionId && uniqueSessions.length > 0) {
    setSelectedSessionId(uniqueSessions[0].session_id);
  }

  // Fetch wave history for selected session
  const { data: waveHistoryData, isLoading: wavesLoading } = useQuery({
    queryKey: ["wave-history", selectedSessionId],
    queryFn: () => apiClient.getWaveHistory(selectedSessionId!),
    enabled: !!selectedSessionId,
    refetchInterval: 5000,
  });

  // Fetch current wave
  const { data: currentWaveData } = useQuery({
    queryKey: ["wave-current", selectedSessionId],
    queryFn: () => apiClient.getWaveCurrent(selectedSessionId!),
    enabled: !!selectedSessionId,
    refetchInterval: 5000,
  });

  // Get agent IDs for capacity gauges (from active agents in selected session)
  const agentIds = useMemo(() => {
    if (!selectedSessionId) return [];
    return sessions
      .filter(agent => agent.session_id === selectedSessionId && agent.agent_id)
      .map(agent => agent.agent_id)
      .filter((id): id is string => !!id)
      .slice(0, 5); // Limit to 5 agents
  }, [sessions, selectedSessionId]);

  // WebSocket events
  const { events: waveEvents } = useWaveEvents(selectedSessionId || undefined);

  const waves = waveHistoryData?.waves || [];
  const selectedWave = waves.find(w => w.id === selectedWaveId) || currentWaveData?.wave || waves[0];

  // Auto-select first wave
  if (!selectedWaveId && waves.length > 0) {
    setSelectedWaveId(waves[0].id);
  }

  return (
    <PageContainer
      title="Wave Progress"
      description="Monitor wave execution and agent capacity across sessions"
      actions={
        <Badge variant="outline" className="text-xs">
          {waveEvents.length} live events
        </Badge>
      }
    >
      {/* Session Selector */}
      <div className="glass-card rounded-xl p-4">
        <label className="block text-sm font-medium mb-2">Select Session</label>
        {sessionsLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : uniqueSessions.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-4">
            No active sessions found
          </div>
        ) : (
          <select
            className="w-full p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            value={selectedSessionId || ""}
            onChange={(e) => {
              setSelectedSessionId(e.target.value);
              setSelectedWaveId(null); // Reset selected wave
            }}
          >
            {uniqueSessions.map((session) => (
              <option key={session.session_id} value={session.session_id}>
                {session.session_id.slice(0, 20)}... - {session.project_name || session.project_path || "Unknown"}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Wave Progress Overview */}
      {selectedSessionId && (
        <>
          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Wave Overview
            </h3>
            {wavesLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : waves.length === 0 ? (
              <Card className="glass-card">
                <div className="p-6 text-center text-muted-foreground">
                  <Layers className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No waves found for this session</p>
                </div>
              </Card>
            ) : (
              <div className="space-y-3">
                {waves.map((wave) => (
                  <WaveProgressBar
                    key={wave.id}
                    wave={wave}
                    onClick={() => setSelectedWaveId(wave.id)}
                    isSelected={selectedWaveId === wave.id}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Wave Distribution Chart */}
          {waves.length > 0 && (
            <Card className="glass-card">
              <div className="p-6">
                <h3 className="text-base font-semibold mb-4">Task Distribution by Wave</h3>
                <WaveDistributionChart waves={waves} />
              </div>
            </Card>
          )}

          {/* Bottom Row: Wave Details + Agent Capacity */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Wave Detail Card */}
            {selectedWave && selectedSessionId && (
              <WaveDetailCard wave={selectedWave} sessionId={selectedSessionId} />
            )}

            {/* Agent Capacity Gauges */}
            <Card className="glass-card">
              <div className="p-6">
                <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  Agent Capacity
                </h3>
                {agentIds.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    <Activity className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">No active agents in this session</p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[400px] overflow-y-auto">
                    {agentIds.map((agentId) => (
                      <AgentCapacityGauge key={agentId} agentId={agentId} />
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </div>
        </>
      )}
    </PageContainer>
  );
}
