import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent } from '@/components/ui/card';

interface MpgChartProps {
  data: { date: string; mpg: number }[];
}

export function MpgChart({ data }: MpgChartProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-6 text-sm text-muted-foreground min-h-[300px]">
          No MPG data yet. Log some fillups to see trends.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="mb-4 text-sm font-medium">MPG Over Time</h3>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="date"
              minTickGap={28}
              tick={{ fontSize: 12 }}
              tickFormatter={(v: string) =>
                new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              }
            />
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(v: number) => v.toFixed(1)}
              domain={['auto', 'auto']}
            />
            <Tooltip
              formatter={(value) => [`${Number(value ?? 0).toFixed(1)} mpg`, 'MPG']}
              labelFormatter={(label) =>
                new Date(String(label)).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric',
                })
              }
            />
            <Line
              type="monotone"
              dataKey="mpg"
              stroke="var(--chart-1)"
              strokeWidth={2.5}
              dot={{ r: 2.5, strokeWidth: 0, fill: 'var(--chart-1)' }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
