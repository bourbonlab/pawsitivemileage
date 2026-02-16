import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent } from '@/components/ui/card';

interface SpendingChartProps {
  data: { month: string; totalSpent: number }[];
}

export function SpendingChart({ data }: SpendingChartProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-6 text-sm text-muted-foreground min-h-[300px]">
          No spending data yet. Log some fillups to see trends.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="mb-4 text-sm font-medium">Monthly Fuel Spending</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 12 }}
              tickFormatter={(v: string) => {
                const d = new Date(v + '-01');
                return d.toLocaleDateString('en-US', { month: 'short' });
              }}
            />
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(v: number) => `$${v}`}
            />
            <Tooltip
              formatter={(value: number | undefined) => [`$${(value ?? 0).toFixed(2)}`, 'Spent']}
              labelFormatter={(label) => {
                const d = new Date(String(label) + '-01');
                return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
              }}
            />
            <Bar
              dataKey="totalSpent"
              fill="hsl(221, 83%, 53%)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
