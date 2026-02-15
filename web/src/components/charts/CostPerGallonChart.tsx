import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent } from '@/components/ui/card';

interface CostPerGallonChartProps {
  data: { date: string; pricePerGallon: number }[];
}

export function CostPerGallonChart({ data }: CostPerGallonChartProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-6 text-sm text-muted-foreground min-h-[300px]">
          No price per gallon data yet. Log some fillups to see trends.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="mb-4 text-sm font-medium">Cost Per Gallon Trend</h3>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12 }}
              tickFormatter={(v: string) =>
                new Date(v + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              }
            />
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(v: number) => `$${v.toFixed(2)}`}
              domain={['auto', 'auto']}
            />
            <Tooltip
              formatter={(value: number) => [`$${value.toFixed(3)}/gal`, 'Price/Gal']}
              labelFormatter={(label: string) =>
                new Date(label + 'T00:00:00').toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric',
                })
              }
            />
            <Line
              type="monotone"
              dataKey="pricePerGallon"
              stroke="hsl(280, 68%, 50%)"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
