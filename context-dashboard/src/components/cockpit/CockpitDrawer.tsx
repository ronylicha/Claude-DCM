'use client';

import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart,
  Area,
  BarChart as RechartsBarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDuration } from '@/lib/utils';
import { PremiumKPICard } from '@/components/dashboard/PremiumKPICard';
import { GlassChartTooltip, BAR_COLORS } from '@/components/dashboard';
import apiClient, {
  type StatsResponse,
  type ActionsHourlyResponse,
} from '@/lib/api-client';
import { useRealtimeMetrics } from '@/hooks/useWebSocket';
import {
  FolderKanban,
  Timer,
  RefreshCw,
  Clock4,
  Send,
  Target,
  Save,
  X,
  BarChart3,
} from 'lucide-react';

// ============================================
// CockpitDrawer — right panel with KPIs & charts
// ============================================

interface CockpitDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function CockpitDrawer({ open, onClose }: CockpitDrawerProps) {
  const { metrics: realtimeMetrics, connected: wsConnected } = useRealtimeMetrics();

  const { data: stats, isLoading: statsLoading } = useQuery<StatsResponse>({
    queryKey: ['stats'],
    queryFn: apiClient.getStats,
    refetchInterval: wsConnected ? 30000 : 60000,
    enabled: open,
  });

  const { data: actionsHourlyData } = useQuery<ActionsHourlyResponse>({
    queryKey: ['actionsHourly'],
    queryFn: () => apiClient.getActionsHourly(),
    refetchInterval: 30000,
    enabled: open,
  });

  const { data: agentActionsData } = useQuery({
    queryKey: ['agent-actions-top10'],
    queryFn: () => apiClient.getActions(500, 0, 'agent'),
    refetchInterval: 60000,
    enabled: open,
  });

  const { data: contextStats } = useQuery({
    queryKey: ['agent-context-stats'],
    queryFn: apiClient.getAgentContextStats,
    refetchInterval: 30000,
    enabled: open,
  });

  const { data: routingStats } = useQuery({
    queryKey: ['routing-stats-dashboard'],
    queryFn: apiClient.getRoutingStatsRaw,
    refetchInterval: 60000,
    enabled: open,
  });

  // Actions per hour chart
  const actionsPerHour = useMemo(() =>
    (actionsHourlyData?.data ?? []).map(item => ({
      name: new Date(item.hour).toLocaleTimeString('fr-FR', { hour: '2-digit', hour12: false }),
      actions: item.count,
    })),
    [actionsHourlyData],
  );

  // Top tools
  const topTools = useMemo(() => {
    const actions = agentActionsData?.actions || [];
    if (actions.length === 0) return [];
    const counts = new Map<string, number>();
    for (const a of actions) counts.set(a.tool_name, (counts.get(a.tool_name) || 0) + 1);
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value]) => ({
        name: name.length > 12 ? name.slice(0, 10) + '..' : name,
        value,
      }));
  }, [agentActionsData]);

  // Context freshness
  const [contextFreshness, setContextFreshness] = useState('N/A');
  useEffect(() => {
    if (!open) return;
    function compute() {
      if (!contextStats?.overview?.newest_context) { setContextFreshness('N/A'); return; }
      const ms = Date.now() - new Date(contextStats.overview.newest_context).getTime();
      if (ms < 60000) setContextFreshness(`${Math.floor(ms / 1000)}s`);
      else if (ms < 3600000) setContextFreshness(`${Math.floor(ms / 60000)}m`);
      else setContextFreshness(`${Math.floor(ms / 3600000)}h`);
    }
    compute();
    const t = setInterval(compute, 10000);
    return () => clearInterval(t);
  }, [contextStats, open]);

  const recoveryRate = useMemo(() => {
    if (!contextStats?.overview) return '0%';
    const { total_contexts, completed_agents } = contextStats.overview;
    if (total_contexts === 0) return '0%';
    return `${Math.round((completed_agents / total_contexts) * 100)}%`;
  }, [contextStats]);

  const routingAccuracy = useMemo(() => {
    if (!routingStats?.totals?.avg_score) return 'N/A';
    return `${Math.round((routingStats.totals.avg_score / 5) * 100)}%`;
  }, [routingStats]);

  const avgDuration = realtimeMetrics?.avg_task_duration_ms
    ? formatDuration(realtimeMetrics.avg_task_duration_ms)
    : 'N/A';

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed top-0 right-0 z-50 h-full w-[420px] max-w-[90vw] bg-[var(--md-sys-color-surface)] border-l border-[var(--md-sys-color-outline-variant)] shadow-xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 bg-[var(--md-sys-color-surface)] border-b border-[var(--md-sys-color-outline-variant)]">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-[var(--md-sys-color-primary)]" />
            <h2 className="text-[16px] font-medium text-[var(--md-sys-color-on-surface)]">Metriques</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md-sm hover:bg-[var(--md-sys-color-surface-container)] transition-colors"
          >
            <X className="h-5 w-5 text-[var(--md-sys-color-on-surface-variant)]" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* KPI Grid */}
          <div className="grid grid-cols-2 gap-3">
            <PremiumKPICard
              title="Projects"
              value={stats?.projectCount ?? 0}
              icon={<FolderKanban className="h-4 w-4 text-white" />}
              iconGradient="bg-gradient-to-br from-indigo-500 to-cyan-500"
              loading={statsLoading}
            />
            <PremiumKPICard
              title="Avg Duration"
              value={avgDuration}
              icon={<Timer className="h-4 w-4 text-white" />}
              iconGradient="bg-gradient-to-br from-amber-500 to-orange-500"
              loading={statsLoading && !wsConnected}
            />
            <PremiumKPICard
              title="Recovery"
              value={recoveryRate}
              icon={<RefreshCw className="h-4 w-4 text-white" />}
              iconGradient="bg-gradient-to-br from-emerald-500 to-green-600"
              loading={!contextStats}
            />
            <PremiumKPICard
              title="Freshness"
              value={contextFreshness}
              icon={<Clock4 className="h-4 w-4 text-white" />}
              iconGradient="bg-gradient-to-br from-cyan-500 to-teal-500"
              loading={!contextStats}
            />
            <PremiumKPICard
              title="Messages"
              value={stats?.messageCount ?? 0}
              icon={<Send className="h-4 w-4 text-white" />}
              iconGradient="bg-gradient-to-br from-indigo-500 to-violet-600"
              loading={statsLoading}
            />
            <PremiumKPICard
              title="Routing"
              value={routingAccuracy}
              icon={<Target className="h-4 w-4 text-white" />}
              iconGradient="bg-gradient-to-br from-emerald-500 to-green-600"
              loading={!routingStats}
            />
          </div>

          {/* Actions per Hour chart */}
          <div className="rounded-md-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] p-4">
            <h3 className="text-[13px] font-medium text-[var(--md-sys-color-on-surface-variant)] mb-3">
              Actions / heure (24h)
            </h3>
            {actionsPerHour.length === 0 ? (
              <div className="flex items-center justify-center h-[160px] text-[12px] text-[var(--md-sys-color-outline)]">
                Pas de donnees
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={actionsPerHour} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="drawerActionsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--md-sys-color-primary)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--md-sys-color-primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--md-sys-color-outline-variant)" opacity={0.3} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--md-sys-color-outline)' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--md-sys-color-outline)' }} tickLine={false} axisLine={false} />
                  <RechartsTooltip contentStyle={{ background: 'var(--md-sys-color-surface-container-high)', border: '1px solid var(--md-sys-color-outline-variant)', borderRadius: '8px', fontSize: '12px', color: 'var(--md-sys-color-on-surface)' }} />
                  <Area type="monotone" dataKey="actions" stroke="var(--md-sys-color-primary)" strokeWidth={2} fill="url(#drawerActionsGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Top Tools chart */}
          <div className="rounded-md-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] p-4">
            <h3 className="text-[13px] font-medium text-[var(--md-sys-color-on-surface-variant)] mb-3">
              Top outils
            </h3>
            {topTools.length === 0 ? (
              <div className="flex items-center justify-center h-[200px] text-[12px] text-[var(--md-sys-color-outline)]">
                Pas de donnees
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <RechartsBarChart data={topTools} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--md-sys-color-outline-variant)" opacity={0.3} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--md-sys-color-outline)' }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--md-sys-color-outline)' }} tickLine={false} axisLine={false} width={80} />
                  <RechartsTooltip contentStyle={{ background: 'var(--md-sys-color-surface-container-high)', border: '1px solid var(--md-sys-color-outline-variant)', borderRadius: '8px', fontSize: '12px', color: 'var(--md-sys-color-on-surface)' }} />
                  <Bar dataKey="value" name="Actions" radius={[0, 4, 4, 0]}>
                    {topTools.map((_, i) => (
                      <Cell key={`c-${i}`} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </RechartsBarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Agent Contexts KPI */}
          <div className="grid grid-cols-1">
            <PremiumKPICard
              title="Agent Contexts Sauves"
              value={contextStats?.overview?.total_contexts ?? 0}
              icon={<Save className="h-4 w-4 text-white" />}
              iconGradient="bg-gradient-to-br from-amber-500 to-orange-500"
              loading={!contextStats}
            />
          </div>
        </div>
      </div>
    </>
  );
}
