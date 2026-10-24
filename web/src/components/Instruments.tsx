import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Gauge: a 270° dial arc, open at the bottom like a speedometer      */
/* ------------------------------------------------------------------ */

interface GaugeProps {
  /** How full the arc is, 0–1 */
  fraction: number;
  /** Text in the centre of the dial */
  value: string;
  /** Small caption under the value (e.g. "mpg") */
  unit?: string;
  /** Arc colour; any CSS colour, defaults to the brand peach */
  color?: string;
  /** Draw tick marks around the dial (for larger gauges) */
  ticks?: boolean;
  label: string;
  /** Sets the dial's size (default 84px); text scales with it */
  className?: string;
}

const SWEEP = 0.75;

export function Gauge({
  fraction, value, unit, color = 'var(--chart-1)', ticks = false, label, className,
}: GaugeProps) {
  const stroke = 7;
  const r = 50 - stroke / 2 - (ticks ? 6 : 0);
  const circumference = 2 * Math.PI * r;
  const arc = circumference * SWEEP;
  const filled = arc * Math.min(1, Math.max(0, fraction));

  return (
    <div
      className={cn('relative size-[84px] shrink-0 [container-type:size]', className)}
      role="img"
      aria-label={`${label}: ${value}${unit ? ` ${unit}` : ''}`}
    >
      <svg viewBox="0 0 100 100" className="size-full" aria-hidden="true">
        {ticks && (
          <g stroke="var(--muted-foreground)" strokeWidth="1" opacity="0.5">
            {Array.from({ length: 28 }, (_, i) => {
              const angle = (135 + (270 / 27) * i) * (Math.PI / 180);
              const inner = i % 3 === 0 ? 42 : 44.5;
              return (
                <line
                  key={i}
                  x1={50 + inner * Math.cos(angle)}
                  y1={50 + inner * Math.sin(angle)}
                  x2={50 + 47.5 * Math.cos(angle)}
                  y2={50 + 47.5 * Math.sin(angle)}
                />
              );
            })}
          </g>
        )}
        <g transform="rotate(135 50 50)" fill="none" strokeWidth={stroke} strokeLinecap="round">
          <circle cx="50" cy="50" r={r} stroke="var(--gauge-track)" strokeDasharray={`${arc} ${circumference}`} />
          {filled > 0 && (
            <circle cx="50" cy="50" r={r} stroke={color} strokeDasharray={`${filled} ${circumference}`} />
          )}
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span
          className="font-mono font-semibold leading-none tabular-nums"
          style={{ fontSize: value.length > 4 ? '20cqw' : '24cqw' }}
        >
          {value}
        </span>
        {unit && (
          <span className="mt-[3cqw] text-muted-foreground" style={{ fontSize: 'max(10px, 8cqw)' }}>
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Odometer: mechanical digit wheels                                  */
/* ------------------------------------------------------------------ */

export function Odometer({ miles, className }: { miles: number; className?: string }) {
  const digits = Math.round(miles).toString().padStart(6, '0').split('');
  return (
    <div className={cn('flex gap-[3px]', className)} role="img" aria-label={`Odometer: ${Math.round(miles).toLocaleString()} miles`}>
      {digits.map((d, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={cn(
            'grid h-11 w-8 place-items-center rounded-md bg-inset font-mono text-[26px] font-medium sm:h-[52px] sm:w-[38px] sm:text-[32px]',
            i === digits.length - 1 ? 'text-brand' : 'text-foreground',
          )}
        >
          {d}
        </span>
      ))}
    </div>
  );
}
