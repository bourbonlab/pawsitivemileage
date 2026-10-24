import { useState, useCallback } from 'react';
import {
  Download, Share2, Loader2, Calendar, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useGenerateSummaryCard, type SummaryCardData } from '@/api/analytics';
import { useVehicle } from '@/api/vehicles';
import { cn } from '@/lib/utils';

interface SummaryCardProps {
  vehicleId: string;
  className?: string;
}

const currentYear = new Date().getFullYear();
const availableYears = Array.from({ length: 6 }, (_, i) => currentYear - i);

export function SummaryCard({ vehicleId, className }: SummaryCardProps) {
  const [selectedYear, setSelectedYear] = useState(String(currentYear));
  const vehicleQuery = useVehicle(vehicleId);
  const mutation = useGenerateSummaryCard(vehicleId);

  const nickname = vehicleQuery.data?.nickname ?? 'Vehicle';

  const handleGenerate = () => {
    mutation.mutate(Number(selectedYear));
  };

  return (
    <div className={cn('space-y-4', className)}>
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label htmlFor="year-select" className="text-sm font-medium">
            Year
          </label>
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger id="year-select" className="w-[120px]">
              <Calendar className="size-4" aria-hidden="true" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableYears.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button onClick={handleGenerate} disabled={mutation.isPending}>
          {mutation.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          Generate Summary
        </Button>
      </div>

      {/* Error state */}
      {mutation.isError && (
        <p className="text-sm text-destructive" role="alert">
          Failed to generate summary card. Please try again.
        </p>
      )}

      {/* Card display */}
      {mutation.data && (
        <SummaryCardDisplay
          data={mutation.data}
          nickname={nickname}
        />
      )}
    </div>
  );
}


/* ------------------------------------------------------------------ */
/*  Visual card display                                                */
/* ------------------------------------------------------------------ */

function SummaryCardDisplay({
  data,
  nickname,
}: {
  data: SummaryCardData;
  nickname: string;
}) {
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = useCallback(async () => {
    setIsDownloading(true);
    try {
      const canvas = renderCardToCanvas(data, nickname);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png'),
      );
      if (!blob) return;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${nickname}-${data.year}-summary.png`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsDownloading(false);
    }
  }, [data, nickname]);

  const handleShare = useCallback(async () => {
    const shareData = {
      title: `${nickname} — ${data.year} Summary`,
      text: `${nickname} drove ${data.totalMiles.toLocaleString()} miles in ${data.year} with an average of ${data.averageMpg?.toFixed(1) ?? '—'} MPG across ${data.fillupCount} fillups.`,
      url: window.location.href,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        // User cancelled or share failed — fall through to clipboard
      }
      return;
    }

    // Fallback: copy link to clipboard
    await navigator.clipboard.writeText(window.location.href);
    // A toast would be nice here, but keeping it simple
    alert('Link copied to clipboard!');
  }, [data, nickname]);

  const stats = [
    { label: 'Total Miles', value: data.totalMiles.toLocaleString() },
    { label: 'Fuel Cost', value: `$${data.totalFuelCost.toFixed(2)}` },
    { label: 'Avg MPG', value: data.averageMpg?.toFixed(1) ?? '—' },
    { label: 'Fillups', value: String(data.fillupCount) },
    { label: 'Maintenance', value: `$${data.totalMaintenanceCost.toFixed(2)}` },
  ];

  return (
    <div className="space-y-3">
      {/* The visual card */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-[#2a241f] to-[#171411] p-6 text-[#eeeae4]">
          <div className="mb-4">
            <h3 className="text-xl font-bold text-[#f0c49a]">{nickname}</h3>
            <p className="text-sm opacity-80">{data.year} Year in Review</p>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            {stats.map((s) => (
              <div key={s.label}>
                <p className="text-xs uppercase tracking-wide opacity-70">
                  {s.label}
                </p>
                <p className="font-mono text-lg font-semibold">{s.value}</p>
              </div>
            ))}
          </div>

          <p className="mt-6 text-xs opacity-50">PawsitiveMileage</p>
        </div>
      </Card>

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownload}
          disabled={isDownloading}
        >
          {isDownloading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          Download PNG
        </Button>
        <Button variant="outline" size="sm" onClick={handleShare}>
          <Share2 className="size-4" />
          {'share' in navigator ? 'Share' : 'Copy Link'}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Canvas-based image generation for PNG download                     */
/* ------------------------------------------------------------------ */

function renderCardToCanvas(
  data: SummaryCardData,
  nickname: string,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  const W = 600;
  const H = 400;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;

  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, W, H);
  // Night Drive espresso, matching the on-screen card
  grad.addColorStop(0, '#2a241f');
  grad.addColorStop(1, '#171411');
  ctx.fillStyle = grad;
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.fill();

  // Title
  ctx.fillStyle = '#f0c49a';
  ctx.font = 'bold 28px system-ui, -apple-system, sans-serif';
  ctx.fillText(nickname, 32, 52);
  ctx.fillStyle = '#eeeae4';

  ctx.font = '16px system-ui, -apple-system, sans-serif';
  ctx.globalAlpha = 0.8;
  ctx.fillText(`${data.year} Year in Review`, 32, 80);
  ctx.globalAlpha = 1;

  // Stats grid
  const stats = [
    { label: 'Total Miles', value: data.totalMiles.toLocaleString() },
    { label: 'Fuel Cost', value: `$${data.totalFuelCost.toFixed(2)}` },
    { label: 'Avg MPG', value: data.averageMpg?.toFixed(1) ?? '—' },
    { label: 'Fillups', value: String(data.fillupCount) },
    { label: 'Maintenance', value: `$${data.totalMaintenanceCost.toFixed(2)}` },
  ];

  const cols = 3;
  const colW = (W - 64) / cols;
  const startY = 130;
  const rowH = 80;

  stats.forEach((s, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 32 + col * colW;
    const y = startY + row * rowH;

    ctx.font = '12px system-ui, -apple-system, sans-serif';
    ctx.globalAlpha = 0.7;
    ctx.fillText(s.label.toUpperCase(), x, y);

    ctx.font = 'bold 24px system-ui, -apple-system, sans-serif';
    ctx.globalAlpha = 1;
    ctx.fillText(s.value, x, y + 28);
  });

  // Branding
  ctx.font = '12px system-ui, -apple-system, sans-serif';
  ctx.globalAlpha = 0.5;
  ctx.fillText('PawsitiveMileage', 32, H - 24);
  ctx.globalAlpha = 1;

  return canvas;
}

/** Draw a rounded rectangle path */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
