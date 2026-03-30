'use client';

import {
  Check,
  X,
  Clock,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================
// Types
// ============================================

export interface WaveStepData {
  waveNumber: number;
  status: 'completed' | 'running' | 'failed' | 'pending';
  stepCount?: number;
}

interface WaveStepperProps {
  waves: WaveStepData[];
  selectedWave: number;
  onSelectWave: (waveNumber: number) => void;
}

// ============================================
// Status rendering
// ============================================

function WaveIcon({ status }: { status: WaveStepData['status'] }) {
  switch (status) {
    case 'completed':
      return <Check className="h-4 w-4" aria-hidden="true" />;
    case 'running':
      return <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />;
    case 'failed':
      return <X className="h-4 w-4" aria-hidden="true" />;
    default:
      return <Clock className="h-3.5 w-3.5" aria-hidden="true" />;
  }
}

function statusStyles(status: WaveStepData['status'], isSelected: boolean) {
  const base = 'transition-all duration-200';

  if (isSelected) {
    return {
      circle: cn(
        base,
        'ring-2 ring-offset-2 ring-[var(--md-sys-color-primary)]',
        'ring-offset-[var(--md-sys-color-surface)]',
        status === 'completed'
          ? 'bg-[var(--dcm-zone-green)] text-white'
          : status === 'running'
            ? 'bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)]'
            : status === 'failed'
              ? 'bg-[var(--dcm-zone-red)] text-white'
              : 'bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface-variant)] border-2 border-[var(--md-sys-color-primary)]',
      ),
      label: 'text-[var(--md-sys-color-on-surface)] font-medium',
    };
  }

  switch (status) {
    case 'completed':
      return {
        circle: cn(base, 'bg-[var(--dcm-zone-green)] text-white'),
        label: 'text-[var(--md-sys-color-on-surface-variant)]',
      };
    case 'running':
      return {
        circle: cn(base, 'bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)]'),
        label: 'text-[var(--md-sys-color-primary)] font-medium',
      };
    case 'failed':
      return {
        circle: cn(base, 'bg-[var(--dcm-zone-red)] text-white'),
        label: 'text-[var(--dcm-zone-red)]',
      };
    default:
      return {
        circle: cn(
          base,
          'bg-[var(--md-sys-color-surface-container)]',
          'text-[var(--md-sys-color-on-surface-variant)]',
          'border-2 border-[var(--md-sys-color-outline-variant)]',
        ),
        label: 'text-[var(--md-sys-color-outline)]',
      };
  }
}

function connectorColor(fromStatus: WaveStepData['status']): string {
  if (fromStatus === 'completed') return 'bg-[var(--dcm-zone-green)]';
  if (fromStatus === 'running') return 'bg-[var(--md-sys-color-primary)]';
  return 'bg-[var(--md-sys-color-outline-variant)]';
}

// ============================================
// WaveStepper
// ============================================

export function WaveStepper({ waves, selectedWave, onSelectWave }: WaveStepperProps) {
  if (waves.length === 0) return null;

  return (
    <div
      className="flex items-start overflow-x-auto pb-2 scrollbar-thin"
      role="tablist"
      aria-label="Pipeline waves"
    >
      {waves.map((wave, index) => {
        const isSelected = wave.waveNumber === selectedWave;
        const isLast = index === waves.length - 1;
        const styles = statusStyles(wave.status, isSelected);

        return (
          <div key={wave.waveNumber} className="flex items-start shrink-0">
            {/* Wave step */}
            <button
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-label={`Wave ${wave.waveNumber}, ${wave.status}${wave.stepCount ? `, ${wave.stepCount} steps` : ''}`}
              onClick={() => onSelectWave(wave.waveNumber)}
              className={cn(
                'flex flex-col items-center gap-1.5 cursor-pointer min-w-[56px] group',
                'focus-visible:outline-2 focus-visible:outline-[var(--md-sys-color-primary)]',
                'focus-visible:outline-offset-2 rounded-[8px] p-1',
              )}
            >
              {/* Circle */}
              <div
                className={cn(
                  'flex items-center justify-center w-9 h-9 rounded-full',
                  'group-hover:scale-110',
                  styles.circle,
                )}
              >
                <WaveIcon status={wave.status} />
              </div>

              {/* Label */}
              <span className={cn('text-[11px] tabular-nums', styles.label)}>
                W{wave.waveNumber}
              </span>
            </button>

            {/* Connector line */}
            {!isLast && (
              <div className="flex items-center pt-[18px] px-0.5">
                <div
                  className={cn(
                    'h-[2px] w-8 rounded-full',
                    connectorColor(wave.status),
                  )}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
