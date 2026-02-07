"use client";

import {
  AreaChart as RechartsAreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export interface AreaChartDataPoint {
  name: string;
  [key: string]: string | number;
}

export interface AreaChartSeries {
  dataKey: string;
  name: string;
  color: string;
  fillOpacity?: number;
}

export interface AreaChartProps {
  title?: string;
  data: AreaChartDataPoint[];
  series: AreaChartSeries[];
  loading?: boolean;
  height?: number;
  showGrid?: boolean;
  showLegend?: boolean;
  stacked?: boolean;
}

export function AreaChart({
  title,
  data,
  series,
  loading,
  height = 300,
  showGrid = true,
  showLegend = true,
  stacked = false,
}: AreaChartProps) {
  const content = loading ? (
    <Skeleton className="w-full" style={{ height }} />
  ) : data.length === 0 ? (
    <div
      className="flex items-center justify-center text-muted-foreground"
      style={{ height }}
    >
      No data available
    </div>
  ) : (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsAreaChart
        data={data}
        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
      >
        {showGrid && <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />}
        <XAxis
          dataKey="name"
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
          }}
        />
        {showLegend && <Legend />}
        {series.map((s) => (
          <Area
            key={s.dataKey}
            type="monotone"
            dataKey={s.dataKey}
            name={s.name}
            stroke={s.color}
            fill={s.color}
            fillOpacity={s.fillOpacity ?? 0.3}
            stackId={stacked ? "1" : undefined}
          />
        ))}
      </RechartsAreaChart>
    </ResponsiveContainer>
  );

  if (!title) {
    return content;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}
