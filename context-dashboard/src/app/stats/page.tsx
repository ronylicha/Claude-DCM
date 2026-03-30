"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer } from "@/components/PageContainer";
import { AreaChart } from "@/components/charts/AreaChart";
import { BarChart } from "@/components/charts/BarChart";
import { PieChart } from "@/components/charts/PieChart";
import apiClient, {
  type StatsPeriod,
  type StatsActivity,
} from "@/lib/api-client";
import {
  Coins,
  Activity,
  Bot,
  TrendingUp,
  TrendingDown,
  Minus,
  Flame,
  Clock,
  Zap,
} from "lucide-react";

// ============================================
// Lazy-loaded heavy components
// ============================================

const TokenSphere = dynamic(
  () => import("@/components/stats/TokenSphere"),
  { ssr: false, loading: () => <Skeleton className="w-full h-[380px] rounded-xl" /> }
);

const StatsRecap = dynamic(
  () => import("@/components/stats/StatsRecap"),
  { ssr: false, loading: () => <Skeleton className="w-full h-[160px] rounded-xl" /> }
);

// ============================================
// Helpers
// ============================================

function fmtCompact(n: number): string {
  return new Intl.NumberFormat("fr-FR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

function fmtDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("fr-FR", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

// ============================================
// Period tabs
// ============================================

const PERIODS: { key: StatsPeriod; label: string }[] = [
  { key: "day", label: "Aujourd'hui" },
  { key: "week", label: "Semaine" },
  { key: "month", label: "Mois" },
  { key: "year", label: "Année" },
  { key: "all", label: "Tout" },
];

function PeriodTabs({
  value,
  onChange,
}: {
  value: StatsPeriod;
  onChange: (p: StatsPeriod) => void;
}) {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-xl p-1"
      style={{
        backgroundColor: "var(--md-sys-color-surface-container)",
        border: "1px solid var(--md-sys-color-outline-variant)",
      }}
    >
      {PERIODS.map((p) => {
        const active = p.key === value;
        return (
          <button
            key={p.key}
            onClick={() => onChange(p.key)}
            className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200"
            style={{
              backgroundColor: active
                ? "var(--md-sys-color-primary-container)"
                : "transparent",
              color: active
                ? "var(--md-sys-color-on-primary-container)"
                : "var(--md-sys-color-on-surface-variant)",
            }}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

// ============================================
// Stats KPI Card (premium style)
// ============================================

interface StatsKPIProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  iconColor: string;
  trend?: number;
  trendLabel?: string;
  description?: string;
  loading?: boolean;
}

function StatsKPICard({
  title,
  value,
  icon,
  iconColor,
  trend,
  trendLabel,
  description,
  loading,
}: StatsKPIProps) {
  const hasTrend = trend !== undefined && trend !== null;
  const isUp = hasTrend && trend > 0;
  const isDown = hasTrend && trend < 0;

  return (
    <div
      className="flex flex-col gap-3 rounded-xl p-5"
      style={{
        backgroundColor: "var(--md-sys-color-surface-container-low)",
        border: "1px solid var(--md-sys-color-outline-variant)",
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div
          className="flex items-center justify-center h-8 w-8 rounded-lg"
          style={{ backgroundColor: iconColor }}
        >
          {icon}
        </div>
        <span className="text-sm font-medium text-muted-foreground">{title}</span>
      </div>

      {/* Value */}
      {loading ? (
        <Skeleton className="h-9 w-24" />
      ) : (
        <div className="gradient-text text-3xl font-bold tracking-tight animate-count-up">
          {value}
        </div>
      )}

      {/* Trend / description */}
      {!loading && (hasTrend || description) && (
        <div className="flex items-center gap-1">
          {hasTrend ? (
            <>
              {isUp ? (
                <TrendingUp className="h-3.5 w-3.5 text-[var(--dcm-zone-green)]" />
              ) : isDown ? (
                <TrendingDown className="h-3.5 w-3.5 text-[var(--dcm-zone-red)]" />
              ) : (
                <Minus className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span
                className="text-xs font-medium"
                style={{
                  color: isUp
                    ? "var(--dcm-zone-green)"
                    : isDown
                      ? "var(--dcm-zone-red)"
                      : "var(--md-sys-color-on-surface-variant)",
                }}
              >
                {isUp ? "+" : ""}
                {trend}% {trendLabel}
              </span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">{description}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// Activity Heatmap
// ============================================

const LEVEL_OPACITIES = [0, 0.2, 0.4, 0.7, 1.0];
const DAY_LABELS = ["D", "L", "M", "M", "J", "V", "S"];

function ActivityHeatmap({ data }: { data: StatsActivity }) {
  // Build a 52-week grid (364 days), padded if needed
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 363);

  // Align to start of week (Sunday)
  const startDow = startDate.getDay();
  startDate.setDate(startDate.getDate() - startDow);

  const dateMap = useMemo(() => {
    const src = data.heatmap ?? [];
    const m: Record<string, { count: number; level: number }> = {};
    for (const d of src) {
      m[d.date] = { count: d.count, level: d.level };
    }
    return m;
  }, [data.heatmap]);

  // Build weeks array: 53 weeks × 7 days
  const weeks = useMemo(() => {
    const result: Array<Array<{ dateStr: string; count: number; level: number }>> = [];
    const cursor = new Date(startDate);
    for (let w = 0; w < 53; w++) {
      const week: Array<{ dateStr: string; count: number; level: number }> = [];
      for (let d = 0; d < 7; d++) {
        const iso = cursor.toISOString().slice(0, 10);
        const entry = dateMap[iso];
        week.push({ dateStr: iso, count: entry?.count ?? 0, level: entry?.level ?? 0 });
        cursor.setDate(cursor.getDate() + 1);
      }
      result.push(week);
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateMap]);

  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {/* Streak badges */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Flame className="h-4 w-4 text-[var(--dcm-zone-orange)]" />
          <span className="text-sm font-semibold text-foreground">
            {data.streak?.current ?? 0}j
          </span>
          <span className="text-xs text-muted-foreground">streak actuel</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">
            {data.activeDays ?? 0}
          </span>
          <span className="text-xs text-muted-foreground">jours actifs</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">
            {data.streak?.longest ?? 0}j
          </span>
          <span className="text-xs text-muted-foreground">meilleur streak</span>
        </div>
      </div>

      {/* Grid */}
      <div className="relative overflow-x-auto overflow-y-visible">
        {/* Day labels */}
        <div className="flex gap-px mb-1 ml-0">
          <div className="w-[10px]" />
          {DAY_LABELS.map((d, i) => (
            <div
              key={i}
              className="text-[9px] text-muted-foreground w-[10px] text-center leading-none"
              style={{ writingMode: "horizontal-tb" }}
            >
              {i % 2 === 0 ? d : ""}
            </div>
          ))}
        </div>

        <div
          className="flex gap-[3px]"
          onMouseLeave={() => setTooltip(null)}
        >
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[3px]">
              {week.map((day, di) => {
                const opacity = LEVEL_OPACITIES[day.level] ?? 0;
                const isFuture = day.dateStr > today.toISOString().slice(0, 10);
                return (
                  <div
                    key={di}
                    className="h-[10px] w-[10px] rounded-[2px] cursor-pointer transition-opacity duration-100"
                    style={{
                      backgroundColor:
                        isFuture
                          ? "transparent"
                          : day.level === 0
                            ? "var(--md-sys-color-surface-container)"
                            : `color-mix(in srgb, var(--md-sys-color-primary) ${Math.round(opacity * 100)}%, transparent)`,
                      border: isFuture
                        ? "1px solid var(--md-sys-color-outline-variant)"
                        : "none",
                    }}
                    onMouseEnter={(e) => {
                      if (!isFuture) {
                        const rect = (e.target as HTMLElement).getBoundingClientRect();
                        const parentRect = (e.currentTarget.closest(".relative") as HTMLElement)?.getBoundingClientRect();
                        setTooltip({
                          x: rect.left - (parentRect?.left ?? 0) + 5,
                          y: rect.bottom - (parentRect?.top ?? 0) + 6,
                          text: `${day.dateStr} — ${day.count} action${day.count !== 1 ? "s" : ""}`,
                        });
                      }
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="absolute pointer-events-none rounded-md px-2 py-1 text-xs font-medium shadow-lg z-50 whitespace-nowrap"
            style={{
              left: tooltip.x,
              top: tooltip.y,
              backgroundColor: "var(--md-sys-color-surface-container-high)",
              color: "var(--md-sys-color-on-surface)",
              border: "1px solid var(--md-sys-color-outline-variant)",
            }}
          >
            {tooltip.text}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1.5 self-end">
        <span className="text-[10px] text-muted-foreground">Moins</span>
        {[0, 1, 2, 3, 4].map((lvl) => (
          <div
            key={lvl}
            className="h-[10px] w-[10px] rounded-[2px]"
            style={{
              backgroundColor:
                lvl === 0
                  ? "var(--md-sys-color-surface-container)"
                  : `color-mix(in srgb, var(--md-sys-color-primary) ${Math.round(LEVEL_OPACITIES[lvl] * 100)}%, transparent)`,
            }}
          />
        ))}
        <span className="text-[10px] text-muted-foreground">Plus</span>
      </div>
    </div>
  );
}

// ============================================
// Section Card wrapper
// ============================================

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl p-6 flex flex-col gap-4"
      style={{
        backgroundColor: "var(--md-sys-color-surface-container-low)",
        border: "1px solid color-mix(in srgb, var(--md-sys-color-outline-variant) 30%, transparent)",
      }}
    >
      {title && (
        <div className="flex items-center gap-2.5">
          {icon && (
            <div className="text-[var(--md-sys-color-primary)]">{icon}</div>
          )}
          <h3
            className="font-normal"
            style={{
              fontSize: "22px",
              lineHeight: "28px",
              color: "var(--md-sys-color-on-surface)",
            }}
          >
            {title}
          </h3>
        </div>
      )}
      {children}
    </div>
  );
}

// ============================================
// Main Stats Page
// ============================================

export default function StatsPage() {
  const [period, setPeriod] = useState<StatsPeriod>("month");

  // Queries
  const { data: overview, isLoading: loadingOverview } = useQuery({
    queryKey: ["stats-overview", period],
    queryFn: () => apiClient.getStatsOverview(period),
    staleTime: 60_000,
    retry: false,
  });

  const { data: tokens, isLoading: loadingTokens } = useQuery({
    queryKey: ["stats-tokens", period],
    queryFn: () => apiClient.getStatsTokens(period),
    staleTime: 60_000,
    retry: false,
  });

  const { data: activity, isLoading: loadingActivity } = useQuery({
    queryKey: ["stats-activity"],
    queryFn: () => apiClient.getStatsActivity("year"),
    staleTime: 300_000,
    retry: false,
  });

  const { data: agents, isLoading: loadingAgents } = useQuery({
    queryKey: ["stats-agents", period],
    queryFn: () => apiClient.getStatsAgents(period),
    staleTime: 60_000,
    retry: false,
  });

  // ---- Derived data ----

  const tokenChartData = useMemo(() => {
    if (!tokens?.data) return [];
    return tokens.data.map((d) => ({
      name: fmtDate(d.date),
      input_tokens: d.input_tokens,
      output_tokens: d.output_tokens,
    }));
  }, [tokens]);

  const agentLeaderboardData = useMemo(() => {
    if (!agents?.leaderboard) return [];
    return agents.leaderboard.slice(0, 10).map((a) => ({
      name:
        a.display_name.length > 20
          ? a.display_name.slice(0, 19) + "…"
          : a.display_name,
      value: a.tasks_completed,
    }));
  }, [agents]);

  const tokensByAgentData = useMemo(() => {
    if (!tokens?.byAgent) return [];
    const sorted = [...tokens.byAgent].sort(
      (a, b) => b.total_tokens - a.total_tokens
    );
    const top = sorted.slice(0, 8);
    const rest = sorted.slice(8);
    const othersTotal = rest.reduce((s, a) => s + a.total_tokens, 0);
    const result = top.map((a) => ({
      name:
        a.agent_type.length > 16
          ? a.agent_type.slice(0, 15) + "…"
          : a.agent_type,
      value: a.total_tokens,
    }));
    if (othersTotal > 0) {
      result.push({ name: "Autres", value: othersTotal });
    }
    return result;
  }, [tokens]);

  const hourlyData = useMemo(() => {
    if (!activity?.byHour) return [];
    return activity.byHour.map((h) => ({
      name: `${String(h.hour).padStart(2, "0")}h`,
      value: h.count,
    }));
  }, [activity]);

  // Fallback empty activity for skeleton
  const emptyActivity: StatsActivity = {
    heatmap: [],
    byHour: [],
    byDayOfWeek: [],
    streak: { current: 0, longest: 0 },
    totalDays: 0,
    activeDays: 0,
  };

  return (
    <PageContainer
      title="Statistiques"
      description="Vue d'ensemble de l'activité Claude DCM"
      actions={
        <PeriodTabs value={period} onChange={setPeriod} />
      }
    >

      {/* =========================================== */}
      {/* Hero Section: 3D Sphere + KPIs             */}
      {/* =========================================== */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        {/* 3D Sphere */}
        <div
          className="hidden sm:flex items-center justify-center rounded-2xl overflow-hidden"
          style={{
            backgroundColor: "var(--md-sys-color-surface-container-low)",
            border: "1px solid color-mix(in srgb, var(--md-sys-color-outline-variant) 30%, transparent)",
            minHeight: 380,
          }}
        >
          <TokenSphere
            totalTokens={overview?.tokens.total ?? 0}
            inputTokens={overview?.tokens.input ?? 0}
            outputTokens={overview?.tokens.output ?? 0}
          />
        </div>

        {/* KPI Grid 2×2 */}
        <div className="grid grid-cols-2 gap-4 content-start">
          <StatsKPICard
            title="Tokens totaux"
            value={fmtCompact(overview?.tokens.total ?? 0)}
            icon={<Coins className="h-4 w-4 text-white" />}
            iconColor="var(--md-sys-color-primary)"
            trend={overview?.comparison.tokensDelta}
            trendLabel="vs période préc."
            loading={loadingOverview}
          />
          <StatsKPICard
            title="Sessions"
            value={fmtCompact(overview?.sessions.total ?? 0)}
            icon={<Activity className="h-4 w-4 text-white" />}
            iconColor="var(--md-sys-color-secondary)"
            trend={overview?.comparison.sessionsDelta}
            trendLabel="vs période préc."
            loading={loadingOverview}
          />
          <StatsKPICard
            title="Agents actifs"
            value={fmtCompact(overview?.agents.totalUsed ?? 0)}
            icon={<Bot className="h-4 w-4 text-white" />}
            iconColor="var(--md-sys-color-tertiary)"
            description={
              overview?.agents.topAgent
                ? `Top: ${overview.agents.topAgent}`
                : undefined
            }
            loading={loadingOverview}
          />
          <StatsKPICard
            title="Actions"
            value={fmtCompact(overview?.actions.total ?? 0)}
            icon={<Zap className="h-4 w-4 text-white" />}
            iconColor="var(--dcm-zone-green)"
            trend={overview?.comparison.actionsDelta}
            trendLabel="vs période préc."
            description={
              overview?.actions.successRate !== undefined
                ? `${overview.actions.successRate.toFixed(1)}% succès`
                : undefined
            }
            loading={loadingOverview}
          />
        </div>
      </div>

      {/* =========================================== */}
      {/* Token Consumption Chart                     */}
      {/* =========================================== */}
      <SectionCard
        title="Consommation de tokens"
        icon={<Coins className="h-5 w-5" />}
      >
        {loadingTokens ? (
          <Skeleton className="w-full h-[320px]" />
        ) : (
          <AreaChart
            data={tokenChartData}
            series={[
              {
                dataKey: "input_tokens",
                name: "Input",
                color: "var(--md-sys-color-primary)",
                fillOpacity: 0.25,
              },
              {
                dataKey: "output_tokens",
                name: "Output",
                color: "var(--md-sys-color-secondary)",
                fillOpacity: 0.2,
              },
            ]}
            height={320}
            stacked
            showLegend
            showGrid
          />
        )}
      </SectionCard>

      {/* =========================================== */}
      {/* Activity Heatmap                            */}
      {/* =========================================== */}
      <SectionCard
        title="Activité"
        icon={<Activity className="h-5 w-5" />}
      >
        {loadingActivity ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-[130px] w-full" />
          </div>
        ) : (
          <ActivityHeatmap data={activity ?? emptyActivity} />
        )}
      </SectionCard>

      {/* =========================================== */}
      {/* Agent Leaderboard + Token Distribution      */}
      {/* =========================================== */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        <SectionCard
          title="Classement des agents"
          icon={<Bot className="h-5 w-5" />}
        >
          {loadingAgents ? (
            <Skeleton className="w-full h-[320px]" />
          ) : (
            <BarChart
              data={agentLeaderboardData}
              height={320}
              horizontal
              showGrid={false}
              barLabel="Tâches"
              color="var(--md-sys-color-primary)"
            />
          )}
        </SectionCard>

        <SectionCard
          title="Tokens par outil"
          icon={<Coins className="h-5 w-5" />}
        >
          {loadingTokens ? (
            <Skeleton className="w-full h-[320px]" />
          ) : (
            <PieChart
              data={tokensByAgentData}
              height={320}
              showLegend
              innerRadius={50}
              outerRadius={100}
            />
          )}
        </SectionCard>
      </div>

      {/* =========================================== */}
      {/* Hourly Distribution                         */}
      {/* =========================================== */}
      <SectionCard
        title="Heures d'activité"
        icon={<Clock className="h-5 w-5" />}
      >
        {loadingActivity ? (
          <Skeleton className="w-full h-[240px]" />
        ) : (
          <BarChart
            data={hourlyData}
            height={240}
            showGrid
            barLabel="Actions"
            color="var(--md-sys-color-tertiary)"
          />
        )}
      </SectionCard>

      {/* =========================================== */}
      {/* Animated Recap                              */}
      {/* =========================================== */}
      <SectionCard
        title="Récap animé"
        icon={<Flame className="h-5 w-5" />}
      >
        <StatsRecap
          tokens={overview?.tokens.total ?? 0}
          sessions={overview?.sessions.total ?? 0}
          actions={overview?.actions.total ?? 0}
          agents={overview?.agents.totalUsed ?? 0}
          topAgent={overview?.agents.topAgent ?? "—"}
          successRate={overview?.actions.successRate ?? 0}
        />
      </SectionCard>
    </PageContainer>
  );
}
