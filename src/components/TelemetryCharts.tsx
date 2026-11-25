import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { TactileSegmentButton } from './Tactile3D';
import type { DashboardData, OffTargetEvent } from '../types';

export function AnimatedNumber({
  value,
  decimals = 0,
  suffix = '',
}: {
  value: number;
  decimals?: number;
  suffix?: string;
}) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches) {
      setDisplay(value);
      return;
    }

    const duration = 520;
    const start = performance.now();
    const initial = 0;
    let rafId = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(initial + (value - initial) * eased);
      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [value]);

  return (
    <span className="tabular-nums">
      {display.toFixed(decimals)}
      {suffix}
    </span>
  );
}

export function LabLoader({ label = 'Synchronizing telemetry...' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-cyan-600 dark:bg-cyan-400 animate-scan-dot" />
        <span className="w-6 h-px bg-slate-300 dark:bg-slate-700" />
        <span className="w-2 h-2 rounded-full bg-emerald-600 dark:bg-emerald-400 animate-scan-dot [animation-delay:0.3s]" />
        <span className="w-6 h-px bg-slate-300 dark:bg-slate-700" />
        <span className="w-2 h-2 rounded-full bg-cyan-600 dark:bg-cyan-400 animate-scan-dot [animation-delay:0.6s]" />
      </div>
      <span className="text-xs font-mono text-slate-500 dark:text-slate-400">{label}</span>
    </div>
  );
}

export function MiniHelixMark({ className = '' }: { className?: string }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches) return;

    let rafId = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setPhase((p) => (p + dt * 0.85) % (Math.PI * 2));
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const rungs = 9;
  const width = 200;
  const height = 160;
  const cx = width / 2;
  const amp = 46;
  const topPad = 14;
  const stepY = (height - topPad * 2) / (rungs - 1);

  const strandA: string[] = [];
  const strandB: string[] = [];

  const nodes = Array.from({ length: rungs }).map((_, i) => {
    const y = topPad + i * stepY;
    const angle = phase + i * 0.62;
    const sinA = Math.sin(angle);
    const cosA = Math.cos(angle);
    const x1 = cx + sinA * amp;
    const x2 = cx - sinA * amp;
    const depth = (cosA + 1) / 2;
    strandA.push(`${i === 0 ? 'M' : 'L'} ${x1.toFixed(1)} ${y.toFixed(1)}`);
    strandB.push(`${i === 0 ? 'M' : 'L'} ${x2.toFixed(1)} ${y.toFixed(1)}`);
    return { i, y, x1, x2, depth };
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label="DNA double helix schematic"
    >
      {nodes.map((n) => (
        <line
          key={`r-${n.i}`}
          x1={n.x1}
          y1={n.y}
          x2={n.x2}
          y2={n.y}
          stroke={n.i % 2 === 0 ? '#06B6D4' : '#10B981'}
          strokeWidth={1.1}
          strokeDasharray="2.5 2"
          opacity={0.25 + n.depth * 0.55}
        />
      ))}
      <path d={strandA.join(' ')} fill="none" stroke="#22D3EE" strokeWidth={1.75} opacity={0.85} />
      <path d={strandB.join(' ')} fill="none" stroke="#10B981" strokeWidth={1.75} opacity={0.85} />
      {nodes.map((n) => (
        <g key={`n-${n.i}`}>
          <circle cx={n.x1} cy={n.y} r={2 + n.depth * 1.6} fill="#22D3EE" opacity={0.4 + n.depth * 0.6} />
          <circle cx={n.x2} cy={n.y} r={2 + (1 - n.depth) * 1.6} fill="#10B981" opacity={0.4 + (1 - n.depth) * 0.6} />
        </g>
      ))}
    </svg>
  );
}

interface MismatchPoint {
  mismatch_count: number;
  events: number;
  avg_freq: number;
  max_freq: number;
}

export function AnimatedMismatchChart({ points }: { points: MismatchPoint[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  const chartW = 500;
  const chartH = 200;
  const padL = 46;
  const padR = 22;
  const padT = 20;
  const padB = 34;
  const maxFreqVal = Math.max(5, ...points.map((m) => Number(m.avg_freq)));

  const svgPoints = points.map((pt, i) => {
    const x =
      points.length <= 1
        ? padL + (chartW - padL - padR) / 2
        : padL + (i / (points.length - 1)) * (chartW - padL - padR);
    const y = chartH - padB - (Number(pt.avg_freq) / maxFreqVal) * (chartH - padT - padB);
    return { ...pt, x, y };
  });

  const linePath = svgPoints.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath =
    svgPoints.length > 1
      ? `${linePath} L ${svgPoints[svgPoints.length - 1].x} ${chartH - padB} L ${svgPoints[0].x} ${chartH - padB} Z`
      : '';

  const activePoint =
    hovered !== null ? svgPoints.find((p) => p.mismatch_count === hovered) ?? null : null;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
            Mismatch Cleavage Decay Curve
          </h3>
          <p className="text-[13px] text-slate-500 dark:text-slate-400">
            Mean allele frequency across 1–4 spacer-target mismatches
          </p>
        </div>
        <div className="text-xs font-mono tabular-nums text-right min-h-[18px]">
          {activePoint ? (
            <span className="text-cyan-700 dark:text-cyan-400 font-medium">
              {activePoint.mismatch_count} MM · {Number(activePoint.avg_freq).toFixed(2)}% avg ({activePoint.events} events)
            </span>
          ) : (
            <span className="text-slate-400 dark:text-slate-500">Hover point for readout</span>
          )}
        </div>
      </div>

      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${chartW} ${chartH}`}
          className="w-full h-48 cursor-crosshair select-none"
          role="img"
          aria-label="Animated line chart of mismatch count versus mean allele frequency"
        >
          <defs>
            <linearGradient id="cleavageAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06B6D4" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#06B6D4" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {[0, 0.5, 1].map((frac) => {
            const y = chartH - padB - frac * (chartH - padT - padB);
            const val = (frac * maxFreqVal).toFixed(1);
            return (
              <g key={frac}>
                <line
                  x1={padL}
                  y1={y}
                  x2={chartW - padR}
                  y2={y}
                  stroke="currentColor"
                  strokeDasharray="3 3"
                  className="text-slate-200 dark:text-slate-800"
                />
                <text
                  x={padL - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-slate-400 text-[10px] font-mono tabular-nums"
                >
                  {val}%
                </text>
              </g>
            );
          })}

          {areaPath && (
            <motion.path
              d={areaPath}
              fill="url(#cleavageAreaGrad)"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6 }}
            />
          )}

          {linePath && svgPoints.length > 1 && (
            <motion.path
              d={linePath}
              fill="none"
              stroke="#06B6D4"
              strokeWidth={2}
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1] }}
            />
          )}

          {activePoint && (
            <line
              x1={activePoint.x}
              y1={padT}
              x2={activePoint.x}
              y2={chartH - padB}
              stroke="#22D3EE"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
          )}

          {svgPoints.map((pt, idx) => {
            const isHover = hovered === pt.mismatch_count;
            return (
              <g
                key={pt.mismatch_count}
                onMouseEnter={() => setHovered(pt.mismatch_count)}
                onMouseLeave={() => setHovered(null)}
              >
                <motion.circle
                  cx={pt.x}
                  cy={pt.y}
                  r={isHover ? 6 : 4}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.18 + idx * 0.08, duration: 0.25 }}
                  className="fill-cyan-600 dark:fill-cyan-400 stroke-white dark:stroke-[#0B0F17]"
                  strokeWidth={2}
                />
                <text
                  x={pt.x}
                  y={chartH - 12}
                  textAnchor="middle"
                  className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono tabular-nums"
                >
                  {pt.mismatch_count} MM
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export function RadarFidelityChart({
  dashboard,
  events,
}: {
  dashboard: DashboardData | null;
  events: OffTargetEvent[];
}) {
  const [seriesMode, setSeriesMode] = useState<'both' | 'High' | 'Standard'>('both');

  const highStat = dashboard?.fidelityStats.find((f) => f.fidelity === 'High');
  const stdStat = dashboard?.fidelityStats.find((f) => f.fidelity === 'Standard');

  const highAvg = Number(highStat?.avg_freq ?? 0.6);
  const stdAvg = Number(stdStat?.avg_freq ?? 3.2);
  const highMax = Number(highStat?.max_freq ?? 1.4);
  const stdMax = Number(stdStat?.max_freq ?? 7.8);
  const highCnt = Number(highStat?.mutations ?? 2);
  const stdCnt = Number(stdStat?.mutations ?? 8);
  const totalMut = Math.max(1, events.length);

  // Normalized 0..100 performance axes (higher = cleaner/safer)
  const axes = [
    {
      label: 'SPECIFICITY',
      high: Math.max(15, Math.min(98, 100 - highAvg * 10)),
      std: Math.max(15, Math.min(98, 100 - stdAvg * 10)),
    },
    {
      label: 'PEAK SAFETY',
      high: Math.max(15, Math.min(98, 100 - highMax * 8)),
      std: Math.max(15, Math.min(98, 100 - stdMax * 8)),
    },
    {
      label: 'LOW BURDEN',
      high: Math.max(20, Math.min(98, 100 - (highCnt / totalMut) * 90)),
      std: Math.max(20, Math.min(98, 100 - (stdCnt / totalMut) * 90)),
    },
    {
      label: 'EXON AVOID',
      high: 92,
      std: Math.max(25, 100 - events.filter((e) => e.region_type === 'exon').length * 14),
    },
    {
      label: 'STABILITY',
      high: 94,
      std: Math.max(30, 100 - (dashboard?.totals.high_risk ?? 2) * 14),
    },
  ];

  const size = 240;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 78;

  const pointAt = (idx: number, pct: number) => {
    const angle = -Math.PI / 2 + (idx * 2 * Math.PI) / axes.length;
    const r = (pct / 100) * radius;
    return {
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    };
  };

  const toPolygon = (key: 'high' | 'std') =>
    axes
      .map((ax, i) => {
        const pt = pointAt(i, ax[key]);
        return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
      })
      .join(' ');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
            Cas9 Fidelity Calibration
          </h3>
          <p className="text-[13px] text-slate-500 dark:text-slate-400">
            Empirical specificity envelope
          </p>
        </div>

        <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-[#06080D] border border-slate-200 dark:border-slate-800 rounded-md text-xs">
          {(['both', 'High', 'Standard'] as const).map((m) => (
            <TactileSegmentButton
              key={m}
              onClick={() => setSeriesMode(m)}
              className={`px-2.5 py-1 rounded font-medium transition-colors whitespace-nowrap shrink-0 ${
                seriesMode === m
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {m === 'both' ? 'Compare' : m}
            </TactileSegmentButton>
          ))}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-4">
        <svg viewBox={`0 0 ${size} ${size}`} className="w-52 h-52 shrink-0 select-none">
          {[0.25, 0.5, 0.75, 1].map((ring) => {
            const poly = axes
              .map((_, i) => {
                const pt = pointAt(i, ring * 100);
                return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
              })
              .join(' ');
            return (
              <polygon
                key={ring}
                points={poly}
                fill="none"
                stroke="currentColor"
                strokeWidth={0.8}
                className="text-slate-200 dark:text-slate-800"
              />
            );
          })}

          {axes.map((ax, i) => {
            const outer = pointAt(i, 100);
            const labelPt = pointAt(i, 122);
            return (
              <g key={ax.label}>
                <line
                  x1={cx}
                  y1={cy}
                  x2={outer.x}
                  y2={outer.y}
                  stroke="currentColor"
                  strokeWidth={0.8}
                  className="text-slate-200 dark:text-slate-800"
                />
                <text
                  x={labelPt.x}
                  y={labelPt.y + 3}
                  textAnchor="middle"
                  className="fill-slate-500 dark:fill-slate-400 text-[8.5px] font-mono"
                >
                  {ax.label}
                </text>
              </g>
            );
          })}

          {(seriesMode === 'both' || seriesMode === 'Standard') && (
            <motion.polygon
              points={toPolygon('std')}
              fill="rgba(245, 158, 11, 0.14)"
              stroke="#F59E0B"
              strokeWidth={1.6}
              initial={{ scale: 0.75, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
              style={{ transformOrigin: `${cx}px ${cy}px` }}
            />
          )}

          {(seriesMode === 'both' || seriesMode === 'High') && (
            <motion.polygon
              points={toPolygon('high')}
              fill="rgba(6, 182, 212, 0.20)"
              stroke="#06B6D4"
              strokeWidth={1.8}
              initial={{ scale: 0.75, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
              style={{ transformOrigin: `${cx}px ${cy}px` }}
            />
          )}
        </svg>

        <div className="flex-1 w-full space-y-2.5 text-xs">
          <div className="p-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#06080D]">
            <div className="flex items-center justify-between">
              <span className="font-medium text-cyan-700 dark:text-cyan-400">● High Fidelity</span>
              <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {highAvg.toFixed(2)}% avg
              </span>
            </div>
            <div className="mt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
              {highCnt} events · {highMax.toFixed(2)}% peak
            </div>
          </div>

          <div className="p-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#06080D]">
            <div className="flex items-center justify-between">
              <span className="font-medium text-amber-600 dark:text-amber-400">◆ Standard Cas9</span>
              <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {stdAvg.toFixed(2)}% avg
              </span>
            </div>
            <div className="mt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
              {stdCnt} events · {stdMax.toFixed(2)}% peak
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
