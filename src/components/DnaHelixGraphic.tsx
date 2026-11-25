import { useEffect, useState } from 'react';

interface DnaHelixGraphicProps {
  className?: string;
  compact?: boolean;
}

const BASE_PAIRS = ['G–C', 'A–T', 'C–G', 'T–A', 'G–C', 'A–T', 'G–C', 'C–G', 'T–A', 'A–T'];

export function DnaHelixGraphic({ className = '', compact = false }: DnaHelixGraphicProps) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches) return;

    let rafId = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setPhase((p) => (p + dt * 0.9) % (Math.PI * 2));
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const rungs = compact ? 8 : 11;
  const width = compact ? 180 : 280;
  const height = compact ? 150 : 210;
  const cx = width / 2;
  const amp = compact ? 42 : 66;
  const topPad = 16;
  const stepY = (height - topPad * 2) / (rungs - 1);

  const strandA: string[] = [];
  const strandB: string[] = [];

  const nodes = Array.from({ length: rungs }).map((_, i) => {
    const y = topPad + i * stepY;
    const angle = phase + i * 0.58;
    const sinA = Math.sin(angle);
    const cosA = Math.cos(angle);
    const x1 = cx + sinA * amp;
    const x2 = cx - sinA * amp;
    const depth = (cosA + 1) / 2; // 0..1 depth
    strandA.push(`${i === 0 ? 'M' : 'L'} ${x1.toFixed(1)} ${y.toFixed(1)}`);
    strandB.push(`${i === 0 ? 'M' : 'L'} ${x2.toFixed(1)} ${y.toFixed(1)}`);
    return { i, y, x1, x2, depth, pair: BASE_PAIRS[i % BASE_PAIRS.length] };
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label="Animated DNA double helix molecular structure"
    >
      <defs>
        <linearGradient id="helixStrandCyan" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#00D9FF" stopOpacity="0.95" />
          <stop offset="50%" stopColor="#00E6B8" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#9675FF" stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id="helixStrandTeal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#9675FF" stopOpacity="0.85" />
          <stop offset="50%" stopColor="#00D9FF" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#00E6B8" stopOpacity="0.95" />
        </linearGradient>
      </defs>

      {/* Base-pair hydrogen bond rungs */}
      {nodes.map((n) => (
        <g key={`rung-${n.i}`} opacity={0.28 + n.depth * 0.65}>
          <line
            x1={n.x1}
            y1={n.y}
            x2={n.x2}
            y2={n.y}
            stroke={n.i % 3 === 0 ? '#9675FF' : n.i % 2 === 0 ? '#00D9FF' : '#00E6B8'}
            strokeWidth={1.25}
            strokeDasharray="3 2.5"
          />
          {!compact && Math.abs(n.x1 - n.x2) > 54 && (
            <text
              x={cx}
              y={n.y - 3}
              textAnchor="middle"
              className="fill-[#91A4B8] text-[8px] font-mono"
            >
              {n.pair}
            </text>
          )}
        </g>
      ))}

      {/* Backbones */}
      <path d={strandA.join(' ')} fill="none" stroke="url(#helixStrandCyan)" strokeWidth={2.1} />
      <path d={strandB.join(' ')} fill="none" stroke="url(#helixStrandTeal)" strokeWidth={2.1} />

      {/* Nucleotide phosphate nodes */}
      {nodes.map((n) => (
        <g key={`nodes-${n.i}`}>
          <circle
            cx={n.x1}
            cy={n.y}
            r={2.5 + n.depth * 2.1}
            fill="#00D9FF"
            opacity={0.45 + n.depth * 0.55}
          />
          <circle
            cx={n.x2}
            cy={n.y}
            r={2.5 + (1 - n.depth) * 2.1}
            fill="#00E6B8"
            opacity={0.45 + (1 - n.depth) * 0.55}
          />
        </g>
      ))}
    </svg>
  );
}

export function MolecularLoader({ label = 'Loading genomic dataset...' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full bg-[#00D9FF] animate-node-pulse" />
        <span className="w-5 h-px bg-[#243A50]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#00E6B8] animate-node-pulse [animation-delay:0.4s]" />
        <span className="w-5 h-px bg-[#243A50]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#9675FF] animate-node-pulse [animation-delay:0.8s]" />
      </div>
      <span className="text-xs font-mono text-[#91A4B8]">{label}</span>
    </div>
  );
}
