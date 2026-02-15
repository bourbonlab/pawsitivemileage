import { Link } from 'react-router';
import {
  ArrowLeft, Loader2, BarChart3, Users, Car, Fuel, UserCheck,
  ExternalLink, Wrench, ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAdminStats } from '@/api/admin';

/* ------------------------------------------------------------------ */
/*  Stat card config                                                   */
/* ------------------------------------------------------------------ */

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
}

function StatCard({ label, value, icon }: StatCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold">{value.toLocaleString()}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Admin Stats Page                                                   */
/* ------------------------------------------------------------------ */

export default function AdminStatsPage() {
  const { data: stats, isLoading, isError } = useAdminStats();

  /* ---- Loading state ---- */
  if (isLoading) {
    return (
      <div className="container mx-auto p-4">
        <BackButton />
        <div className="flex items-center justify-center py-24" role="status">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <span className="sr-only">Loading platform stats…</span>
        </div>
      </div>
    );
  }

  /* ---- Error state ---- */
  if (isError) {
    return (
      <div className="container mx-auto p-4">
        <BackButton />
        <p className="py-16 text-center text-sm text-destructive" role="alert">
          Failed to load platform statistics. Please try again.
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-6 p-4">
      <BackButton />

      {/* Page header */}
      <div className="flex items-center gap-2">
        <BarChart3 className="size-6 text-primary" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold">Platform Statistics</h1>
          <p className="text-sm text-muted-foreground">
            Overview of platform usage and health
          </p>
        </div>
      </div>

      {/* Stat cards grid — 2 cols mobile, 4 cols desktop */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Total Users"
          value={stats?.totalUsers ?? 0}
          icon={<Users className="size-5" aria-hidden="true" />}
        />
        <StatCard
          label="Active Users"
          value={stats?.activeUsers ?? 0}
          icon={<UserCheck className="size-5" aria-hidden="true" />}
        />
        <StatCard
          label="Total Vehicles"
          value={stats?.totalVehicles ?? 0}
          icon={<Car className="size-5" aria-hidden="true" />}
        />
        <StatCard
          label="Total Fillups"
          value={stats?.totalFillups ?? 0}
          icon={<Fuel className="size-5" aria-hidden="true" />}
        />
      </div>

      {/* Admin quick nav */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="transition-colors hover:bg-muted/50" role="link" tabIndex={-1}>
          <Link to="/admin/users" className="block">
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Users className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="font-medium">Manage Users</p>
                  <p className="text-sm text-muted-foreground">View users, assign admin roles</p>
                </div>
              </div>
              <ChevronRight className="size-5 text-muted-foreground" aria-hidden="true" />
            </CardContent>
          </Link>
        </Card>
        <Card className="transition-colors hover:bg-muted/50" role="link" tabIndex={-1}>
          <Link to="/admin/schemas" className="block">
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Wrench className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="font-medium">Maintenance Schemas</p>
                  <p className="text-sm text-muted-foreground">Create, edit, activate schemas</p>
                </div>
              </div>
              <ChevronRight className="size-5 text-muted-foreground" aria-hidden="true" />
            </CardContent>
          </Link>
        </Card>
      </div>

      {/* Platform Health section */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="text-lg font-semibold">Platform Health</h2>
          <p className="text-sm text-muted-foreground">
            Detailed monitoring metrics — API request count, error rate, p50/p95/p99
            latency, Lambda cold starts, and DynamoDB consumed capacity — are available
            in the CloudWatch dashboard.
          </p>
          <Button variant="outline" size="sm" asChild>
            <a
              href="https://console.aws.amazon.com/cloudwatch/home#dashboards"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="size-4" />
              Open CloudWatch Dashboard
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Back button                                                        */
/* ------------------------------------------------------------------ */

function BackButton() {
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link to="/garage">
        <ArrowLeft className="size-4" /> Back to Garage
      </Link>
    </Button>
  );
}
