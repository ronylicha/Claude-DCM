"use client";

export interface GlassChartTooltipProps {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}

export function GlassChartTooltip({
  active,
  payload,
  label,
}: GlassChartTooltipProps) {
  if (!active || !payload?.length) return null;

  return (
    <div className="glass-card rounded-lg px-3 py-2 shadow-lg">
      <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p
          key={i}
          className="text-sm font-semibold"
          style={{ color: entry.color }}
        >
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
}
