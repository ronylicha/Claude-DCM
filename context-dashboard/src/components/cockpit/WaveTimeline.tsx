'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import apiClient, { type WaveState } from '@/lib/api-client';
import {
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronRight,
  Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================
// Config & Helpers
// ============================================

const STATUS_CONFIG: Record<string, { color: string; bg: string; border: string; label: string }> = {
  completed: { color: 'text-[var(--dcm-zone-green)]', bg: 'bg-[color-mix(in_srgb,var(--dcm-zone-green)_12%,transparent)]', border: 'border-[color-mix(in_srgb,var(--dcm-zone-green)_30%,transparent)]', label: 'Completed' },
  running:   { color: 'text-[var(--md-sys-color-primary)]', bg: 'bg-[var(--md-sys-color-primary-container)]', border: 'border-[var(--md-sys-color-outline-variant)]', label: 'Running' },
  failed:    { color: 'text-[var(--dcm-zone-red)]', bg: 'bg-[color-mix(in_srgb,var(--dcm-zone-red)_12%,transparent)]', border: 'border-[color-mix(in_srgb,var(--dcm-zone-red)_30%,transparent)]', label: 'Failed' },
  blocked:   { color: 'text-[var(--dcm-zone-orange)]', bg: 'bg-[color-mix(in_srgb,var(--dcm-zone-orange)_12%,transparent)]', border: 'border-[color-mix(in_srgb,var(--dcm-zone-orange)_30%,transparent)]', label: 'Blocked' },
  pending:   { color: 'text-[var(--md-sys-color-on-surface-variant)]', bg: 'bg-[var(--md-sys-color-surface-container)]', border: 'border-[var(--md-sys-color-outline-variant)]', label: 'Pending' },
};

function cfg(status: string) {
  return STATUS_CONFIG[status] || STATUS_CONFIG.pending;
}

function statusIcon(status: string, size = 'h-4 w-4') {
  switch (status) {
    case 'completed': return <CheckCircle2 className={size} />;
    case 'running':   return <Activity className={cn(size, 'animate-pulse')} />;
    case 'failed':    return <XCircle className={size} />;
    case 'blocked':   return <AlertTriangle className={size} />;
    default:          return <Clock className={size} />;
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

// ============================================
// WaveTimelineItem
// ============================================

function WaveTimelineItem({ wave, isSelected, isLast, onClick }: {
  wave: WaveState; isSelected: boolean; isLast: boolean; onClick: () => void;
}) {
  const progress = wave.total_tasks > 0 ? (wave.completed_tasks / wave.total_tasks) * 100 : 0;
  const c = cfg(wave.status);

  return (
    <div className="relative flex gap-3 cursor-pointer" onClick={onClick}>
      <div className="flex flex-col items-center shrink-0">
        <div className={cn(
          'flex items-center justify-center w-9 h-9 rounded-full border-2 transition-all duration-200',
          c.border, c.bg,
          isSelected ? 'ring-2 ring-[var(--md-sys-color-primary)] ring-opacity-50 scale-110' : 'hover:scale-105',
        )}>
          <span className={cn('text-[13px] font-bold', c.color)}>{wave.wave_number}</span>
        </div>
        {!isLast && (
          <div className={cn(
            'w-0.5 flex-1 min-h-[16px]',
            wave.status === 'completed' ? 'bg-[color-mix(in_srgb,var(--dcm-zone-green)_40%,transparent)]' : 'bg-[var(--md-sys-color-outline-variant)]',
          )} />
        )}
      </div>

      <div className={cn(
        'flex-1 rounded-md-md p-3 mb-2 transition-all duration-200 border',
        isSelected
          ? 'bg-[var(--md-sys-color-surface-container-high)] border-[var(--md-sys-color-primary)]'
          : 'bg-[var(--md-sys-color-surface-container)] border-[var(--md-sys-color-outline-variant)] hover:bg-[var(--md-sys-color-surface-container-high)]',
      )}>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-[var(--md-sys-color-on-surface)]">Wave {wave.wave_number}</span>
            <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0', c.color, c.border)}>
              {c.label}
            </Badge>
          </div>
          <span className="text-[11px] text-[var(--md-sys-color-outline)] font-mono tabular-nums">
            {wave.completed_tasks}/{wave.total_tasks}
          </span>
        </div>

        <div className="relative h-1.5 bg-[var(--md-sys-color-surface-container-high)] rounded-full overflow-hidden">
          <div
            className={cn(
              'absolute top-0 left-0 h-full rounded-full transition-all duration-700',
              wave.status === 'completed' ? 'bg-[var(--dcm-zone-green)]' :
              wave.status === 'running' ? 'bg-[var(--md-sys-color-primary)]' :
              wave.status === 'failed' ? 'bg-[var(--dcm-zone-red)]' : 'bg-[var(--md-sys-color-outline)]',
            )}
            style={{ width: `${Math.max(progress, 2)}%` }}
          />
        </div>

        <div className="flex items-center gap-3 mt-1 text-[11px] text-[var(--md-sys-color-outline)]">
          {wave.started_at && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {new Date(wave.started_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {wave.failed_tasks > 0 && (
            <span className="flex items-center gap-1 text-[var(--dcm-zone-red)]">
              <XCircle className="h-3 w-3" /> {wave.failed_tasks}
            </span>
          )}
          {wave.status === 'completed' && wave.started_at && wave.completed_at && (
            <span className="text-[var(--dcm-zone-green)]">
              {formatDuration(new Date(wave.completed_at).getTime() - new Date(wave.started_at).getTime())}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// WaveDetailPanel
// ============================================

function WaveDetailPanel({ wave, sessionId }: { wave: WaveState; sessionId: string }) {
  const { data: tasksData, isLoading: tasksLoading } = useQuery({
    queryKey: ['wave-tasks-zoom', sessionId, wave.wave_number],
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
    <div className="rounded-md-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--md-sys-color-outline-variant)] flex items-center gap-3">
        <div className={cn('flex items-center justify-center h-9 w-9 rounded-md-md', c.bg, c.border, 'border')}>
          <span className={c.color}>{statusIcon(wave.status)}</span>
        </div>
        <div>
          <h4 className="text-[14px] font-medium text-[var(--md-sys-color-on-surface)]">Wave {wave.wave_number}</h4>
          <p className={cn('text-[11px] font-medium', c.color)}>{c.label}</p>
        </div>
        {wave.status === 'running' && (
          <div className="ml-auto flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-[var(--md-sys-color-primary)] animate-pulse" />
            <span className="text-[11px] text-[var(--md-sys-color-primary)]">In Progress</span>
          </div>
        )}
      </div>

      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2.5 rounded-md-md bg-[var(--md-sys-color-surface-container)]">
            <div className="text-[10px] uppercase tracking-wider text-[var(--md-sys-color-outline)] mb-0.5">Started</div>
            <div className="text-[13px] font-medium text-[var(--md-sys-color-on-surface)]">
              {wave.started_at
                ? new Date(wave.started_at).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : 'Not started'}
            </div>
          </div>
          <div className="p-2.5 rounded-md-md bg-[var(--md-sys-color-surface-container)]">
            <div className="text-[10px] uppercase tracking-wider text-[var(--md-sys-color-outline)] mb-0.5">Duration</div>
            <div className="text-[13px] font-medium text-[var(--md-sys-color-on-surface)]">
              {duration > 0 ? formatDuration(duration) : '\u2014'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="text-center p-2.5 rounded-md-md bg-[var(--md-sys-color-surface-container)]">
            <div className="text-[20px] font-bold text-[var(--md-sys-color-on-surface)]">{wave.total_tasks}</div>
            <div className="text-[10px] uppercase text-[var(--md-sys-color-outline)]">Total</div>
          </div>
          <div className="text-center p-2.5 rounded-md-md bg-[color-mix(in_srgb,var(--dcm-zone-green)_10%,transparent)]">
            <div className="text-[20px] font-bold text-[var(--dcm-zone-green)]">{wave.completed_tasks}</div>
            <div className="text-[10px] uppercase text-[var(--dcm-zone-green)] opacity-70">Done</div>
          </div>
          <div className="text-center p-2.5 rounded-md-md bg-[color-mix(in_srgb,var(--dcm-zone-red)_10%,transparent)]">
            <div className="text-[20px] font-bold text-[var(--dcm-zone-red)]">{wave.failed_tasks}</div>
            <div className="text-[10px] uppercase text-[var(--dcm-zone-red)] opacity-70">Failed</div>
          </div>
        </div>

        <div>
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-[var(--md-sys-color-outline)] mb-2 flex items-center gap-1">
            <ChevronRight className="h-3 w-3" /> Tasks ({tasksData?.length ?? 0})
          </h4>
          {tasksLoading ? (
            <div className="space-y-2"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div>
          ) : tasksData && tasksData.length > 0 ? (
            <div className="space-y-1 max-h-[180px] overflow-y-auto">
              {tasksData.map((task) => {
                const tc = cfg(task.status);
                return (
                  <div key={task.id} className="flex items-center gap-2 p-2 rounded-md-md bg-[var(--md-sys-color-surface-container)]">
                    <span className={tc.color}>{statusIcon(task.status, 'h-3.5 w-3.5')}</span>
                    <span className="text-[13px] flex-1 truncate text-[var(--md-sys-color-on-surface)]">
                      {task.name || `Task ${task.id.slice(0, 8)}`}
                    </span>
                    <Badge variant="outline" className={cn('text-[10px]', tc.color, tc.border)}>{task.status}</Badge>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-[13px] text-[var(--md-sys-color-outline)] text-center py-4 bg-[var(--md-sys-color-surface-container)] rounded-md-md">
              No tasks in this wave
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// WaveDistributionChart
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
    <ResponsiveContainer width="100%" height={160}>
      <RechartsBarChart data={chartData} barSize={20}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--md-sys-color-outline-variant)" opacity={0.3} />
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--md-sys-color-outline)' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11, fill: 'var(--md-sys-color-outline)' }} tickLine={false} axisLine={false} width={28} />
        <RechartsTooltip contentStyle={{ background: 'var(--md-sys-color-surface-container-high)', border: '1px solid var(--md-sys-color-outline-variant)', borderRadius: '8px', fontSize: '12px', color: 'var(--md-sys-color-on-surface)' }} />
        <Bar dataKey="completed" stackId="a" fill="var(--dcm-zone-green)" name="Done" />
        <Bar dataKey="failed" stackId="a" fill="var(--dcm-zone-red)" name="Failed" />
        <Bar dataKey="pending" stackId="a" fill="var(--md-sys-color-outline)" radius={[3, 3, 0, 0]} name="Pending" />
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}

// ============================================
// WaveTimeline — main exported component
// ============================================

export function WaveTimeline({ sessionId }: { sessionId: string }) {
  const [selectedWaveId, setSelectedWaveId] = useState<string | null>(null);

  const { data: waveHistoryData, isLoading } = useQuery({
    queryKey: ['wave-history-zoom', sessionId],
    queryFn: () => apiClient.getWaveHistory(sessionId),
    refetchInterval: 5000,
  });

  const { data: currentWaveData } = useQuery({
    queryKey: ['wave-current-zoom', sessionId],
    queryFn: () => apiClient.getWaveCurrent(sessionId),
    refetchInterval: 5000,
  });

  const waves = waveHistoryData?.waves ?? [];
  const selectedWave = waves.find(w => w.id === selectedWaveId) || currentWaveData?.wave || waves[0];

  if (isLoading) {
    return <div className="space-y-3"><Skeleton className="h-16 w-full rounded-md-md" /><Skeleton className="h-16 w-full rounded-md-md" /></div>;
  }

  if (waves.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-[var(--md-sys-color-outline)]">
        <Layers className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-[13px]">Aucune wave pour cette session</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-[14px] font-medium text-[var(--md-sys-color-on-surface-variant)]">Pipeline Waves</h3>
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-5 max-h-[400px] overflow-y-auto pr-1">
          {waves.map((wave, i) => (
            <WaveTimelineItem
              key={wave.id}
              wave={wave}
              isSelected={selectedWaveId === wave.id || (!selectedWaveId && wave === selectedWave)}
              isLast={i === waves.length - 1}
              onClick={() => setSelectedWaveId(wave.id)}
            />
          ))}
        </div>
        <div className="col-span-12 lg:col-span-7 space-y-4">
          {selectedWave && <WaveDetailPanel wave={selectedWave} sessionId={sessionId} />}
          {waves.length > 1 && (
            <div className="rounded-md-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface)] p-4">
              <h4 className="text-[11px] font-medium uppercase tracking-wider text-[var(--md-sys-color-outline)] mb-2">Task Distribution</h4>
              <WaveDistributionChart waves={waves} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
