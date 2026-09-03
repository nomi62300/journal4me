const RADIUS = 80;
const CENTER_X = 100;
const CENTER_Y = 100;

/** 0 -> 180deg (leftmost, worst), 1 -> 90deg (top, breakeven), 2+ -> 0deg
 *  (rightmost, best) — clamped so an unusually high profit factor still
 *  reads as "off the good end" rather than overshooting the arc. */
function angleForValue(value: number): number {
  const clamped = Math.max(0, Math.min(2, value));
  return 180 * (1 - clamped / 2);
}

function pointOnArc(angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: CENTER_X + RADIUS * Math.cos(rad),
    y: CENTER_Y - RADIUS * Math.sin(rad),
  };
}

export function ProfitFactorGauge({ profitFactor }: { profitFactor: number | null }) {
  if (profitFactor === null) {
    return (
      <div className="text-muted-foreground flex h-[100px] items-center justify-center text-center text-sm">
        No losing trades yet — profit factor needs at least one.
      </div>
    );
  }

  const dot = pointOnArc(angleForValue(profitFactor));

  return (
    <div className="flex flex-col items-center gap-1">
      <svg viewBox="0 0 200 110" className="w-full max-w-[220px]">
        {/* left half: 0 (worst) to 1 (breakeven) */}
        <path
          d={`M 20 100 A ${RADIUS} ${RADIUS} 0 0 1 100 20`}
          fill="none"
          stroke="var(--destructive)"
          strokeWidth={12}
          strokeLinecap="round"
        />
        {/* right half: 1 (breakeven) to 2+ (best) */}
        <path
          d={`M 100 20 A ${RADIUS} ${RADIUS} 0 0 1 180 100`}
          fill="none"
          stroke="var(--chart-2)"
          strokeWidth={12}
          strokeLinecap="round"
        />
        <circle
          cx={dot.x}
          cy={dot.y}
          r={7}
          className="fill-foreground stroke-background"
          strokeWidth={2}
        />
      </svg>
      <span className="-mt-5 text-2xl font-semibold tabular-nums">
        {profitFactor.toFixed(2)}
      </span>
    </div>
  );
}
