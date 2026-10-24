import { useParams, Link } from 'react-router';
import {
  ArrowLeft, Loader2, TrendingUp, TrendingDown, Minus,
  BarChart3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAnalyticsDashboard, useYearOverYear } from '@/api/analytics';
import { useVehicle } from '@/api/vehicles';
import { MpgChart } from '@/components/charts/MpgChart';
import { SpendingChart } from '@/components/charts/SpendingChart';
import { CostPerMileChart } from '@/components/charts/CostPerMileChart';
import { CostPerGallonChart } from '@/components/charts/CostPerGallonChart';
import { SummaryCard } from '@/components/SummaryCard';
import type { YearOverYear } from '@/api/analytics';

export default function AnalyticsPage() {
  const { vehicleId } = useParams<{ vehicleId: string }>();

  const vehicleQuery = useVehicle(vehicleId);
  const dashboardQuery = useAnalyticsDashboard(vehicleId);
  const yoyQuery = useYearOverYear(vehicleId);

  /* ---- Loading state ---- */
  if (vehicleQuery.isLoading || dashboardQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <BackButton vehicleId={vehicleId} />
        <div className="flex items-center justify-center py-24" role="status">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <span className="sr-only">Loading analytics…</span>
        </div>
      </div>
    );
  }

  /* ---- Error state ---- */
  if (vehicleQuery.isError || dashboardQuery.isError) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <BackButton vehicleId={vehicleId} />
        <p className="py-16 text-center text-sm text-destructive" role="alert">
          Failed to load analytics data. Please try again.
        </p>
      </div>
    );
  }

  const vehicle = vehicleQuery.data;
  const dashboard = dashboardQuery.data;

  /* ---- Empty state ---- */
  const hasData =
    dashboard &&
    (dashboard.mpgOverTime.length > 0 ||
      dashboard.monthlySpending.length > 0 ||
      dashboard.costPerMileTrend.length > 0 ||
      dashboard.pricePerGallonTrend.length > 0);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <BackButton vehicleId={vehicleId} />

      {/* Page header */}
      <div className="flex items-center gap-2">
        <BarChart3 className="size-6 text-primary" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold">Analytics</h1>
          {vehicle && (
            <p className="text-sm text-muted-foreground">
              {vehicle.nickname} — {vehicle.year} {vehicle.make} {vehicle.model}
            </p>
          )}
        </div>
      </div>

      {!hasData ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 p-12 text-center">
            <BarChart3 className="size-10 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              No analytics data yet. Start logging fillups to see charts and trends.
            </p>
            <Button size="sm" asChild className="mt-2">
              <Link to={`/vehicles/${vehicleId}/fillups/new`}>Add First Fillup</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Dashboard charts — responsive grid */}
          <section aria-label="Dashboard charts">
            <div className="grid gap-4 md:grid-cols-2">
              <MpgChart data={dashboard!.mpgOverTime} />
              <SpendingChart data={dashboard!.monthlySpending} />
              <CostPerMileChart data={dashboard!.costPerMileTrend} />
              <CostPerGallonChart data={dashboard!.pricePerGallonTrend} />
            </div>
          </section>

          {/* Summary Card */}
          <section aria-label="Summary card" className="space-y-3">
            <h2 className="text-lg font-semibold">Annual Summary Card</h2>
            <SummaryCard vehicleId={vehicleId!} />
          </section>

          {/* Year-over-year comparison */}
          <YearOverYearSection
            data={yoyQuery.data}
            isLoading={yoyQuery.isLoading}
            isError={yoyQuery.isError}
          />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Back button                                                        */
/* ------------------------------------------------------------------ */

function BackButton({ vehicleId }: { vehicleId: string | undefined }) {
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link to={vehicleId ? `/vehicles/${vehicleId}` : '/garage'}>
        <ArrowLeft className="size-4" /> Back to Vehicle
      </Link>
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/*  Year-over-year section                                             */
/* ------------------------------------------------------------------ */

function YearOverYearSection({
  data,
  isLoading,
  isError,
}: {
  data: YearOverYear | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-8" role="status">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
        <span className="sr-only">Loading year-over-year data…</span>
      </div>
    );
  }

  if (isError) {
    return (
      <p className="py-8 text-center text-sm text-destructive" role="alert">
        Failed to load year-over-year data.
      </p>
    );
  }

  const summaries = data?.summaries ?? [];
  if (summaries.length === 0) return null;
  // The top-level indicators compare the latest year with the one before it
  const trends = summaries[summaries.length - 1].trends;

  return (
    <section aria-label="Year-over-year comparison" className="space-y-4">
      <h2 className="text-lg font-semibold">Year-over-Year Comparison</h2>

      {/* Trend indicators */}
      <div className="flex flex-wrap gap-3">
        <TrendBadge label="Spending" direction={trends.totalSpent} invertColor />
        <TrendBadge label="MPG" direction={trends.averageMpg} />
        <TrendBadge label="Miles" direction={trends.totalMiles} />
      </div>

      {/* Yearly stats cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {summaries.map((yr) => (
          <Card key={yr.year}>
            <CardContent className="p-4 space-y-2">
              <h3 className="text-lg font-bold">{yr.year}</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Total Spent</dt>
                <dd className="text-right font-medium">${yr.totalSpent.toFixed(2)}</dd>
                <dt className="text-muted-foreground">Gallons</dt>
                <dd className="text-right font-medium">{yr.totalGallons.toFixed(1)}</dd>
                <dt className="text-muted-foreground">Avg MPG</dt>
                <dd className="text-right font-medium">{yr.averageMpg === null ? '—' : yr.averageMpg.toFixed(1)}</dd>
                <dt className="text-muted-foreground">Total Miles</dt>
                <dd className="text-right font-medium">{yr.totalMiles.toLocaleString()}</dd>
                <dt className="text-muted-foreground">Maintenance</dt>
                <dd className="text-right font-medium">${yr.maintenanceCost.toFixed(2)}</dd>
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Trend badge                                                        */
/* ------------------------------------------------------------------ */

function TrendBadge({
  label,
  direction,
  invertColor = false,
}: {
  label: string;
  direction: 'up' | 'down' | 'flat';
  /** When true, "up" is bad (red) and "down" is good (green) — e.g. spending */
  invertColor?: boolean;
}) {
  const iconMap = {
    up: TrendingUp,
    down: TrendingDown,
    flat: Minus,
  } as const;

  const Icon = iconMap[direction];

  let colorClass = 'text-muted-foreground';
  if (direction === 'up') {
    colorClass = invertColor ? 'text-destructive' : 'text-success';
  } else if (direction === 'down') {
    colorClass = invertColor ? 'text-success' : 'text-destructive';
  }

  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium ${colorClass}`}>
      <Icon className="size-3.5" aria-hidden="true" />
      {label} {direction}
    </span>
  );
}
