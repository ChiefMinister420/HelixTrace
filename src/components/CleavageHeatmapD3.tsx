import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { TactileCard, TactileSegmentButton } from './Tactile3D';
import type { OffTargetEvent, OffTargetSiteRecord } from '../types';

export interface HeatmapCellFilter {
  chromosome: string;
  region: 'exon' | 'intron' | 'intergenic';
}

interface CleavageHeatmapD3Props {
  sites: OffTargetSiteRecord[];
  events: OffTargetEvent[];
  selectedCell: HeatmapCellFilter | null;
  onSelectCell: (cell: HeatmapCellFilter | null) => void;
}

type MetricMode = 'maxFreq' | 'avgFreq' | 'density';

interface CellDatum {
  chromosome: string;
  region: 'exon' | 'intron' | 'intergenic';
  siteCount: number;
  eventCount: number;
  maxFreq: number;
  avgFreq: number;
  minMismatch: number | null;
  genes: string[];
  guides: string[];
  value: number;
}

const REGIONS: Array<'exon' | 'intron' | 'intergenic'> = ['exon', 'intron', 'intergenic'];

export function CleavageHeatmapD3({
  sites,
  events,
  selectedCell,
  onSelectCell,
}: CleavageHeatmapD3Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [metric, setMetric] = useState<MetricMode>('maxFreq');
  const [hoveredCell, setHoveredCell] = useState<CellDatum | null>(null);

  const chromosomes = useMemo(() => {
    const unique = Array.from(
      new Set([
        ...sites.map((s) => s.chromosome),
        ...events.map((e) => e.chromosome),
      ]),
    );
    return unique.sort((a, b) => {
      const na = Number(a);
      const nb = Number(b);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });
  }, [sites, events]);

  const cells = useMemo<CellDatum[]>(() => {
    const result: CellDatum[] = [];
    for (const chr of chromosomes) {
      for (const region of REGIONS) {
        const cellSites = sites.filter(
          (s) => s.chromosome === chr && s.region_type === region,
        );
        const cellEvents = events.filter(
          (e) => e.chromosome === chr && e.region_type === region,
        );

        const siteCount = cellSites.length;
        const eventCount = cellEvents.length;
        const maxFreq = cellEvents.reduce(
          (acc, ev) => Math.max(acc, Number(ev.allele_freq)),
          0,
        );
        const avgFreq =
          eventCount > 0
            ? cellEvents.reduce((acc, ev) => acc + Number(ev.allele_freq), 0) / eventCount
            : 0;
        const minMismatch =
          cellSites.length > 0
            ? Math.min(...cellSites.map((s) => Number(s.mismatch_count)))
            : null;
        const genes = Array.from(
          new Set(
            [
              ...cellSites.map((s) => s.gene_symbol),
              ...cellEvents.map((e) => e.hit_gene),
            ].filter((g): g is string => Boolean(g)),
          ),
        );
        const guides = Array.from(
          new Set([
            ...cellSites.map((s) => s.guide_name),
            ...cellEvents.map((e) => e.guide_name),
          ]),
        );

        const value =
          metric === 'maxFreq'
            ? maxFreq
            : metric === 'avgFreq'
              ? avgFreq
              : siteCount + eventCount;

        result.push({
          chromosome: chr,
          region,
          siteCount,
          eventCount,
          maxFreq,
          avgFreq,
          minMismatch,
          genes,
          guides,
          value,
        });
      }
    }
    return result;
  }, [chromosomes, sites, events, metric]);

  const maxScaleVal = useMemo(() => {
    if (metric === 'density') {
      return Math.max(3, ...cells.map((c) => c.value));
    }
    return Math.max(6, ...cells.map((c) => c.value));
  }, [cells, metric]);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || chromosomes.length === 0) return;

    const margin = { top: 28, right: 20, bottom: 28, left: 56 };
    const width = 580;
    const rowH = 32;
    const height = margin.top + margin.bottom + chromosomes.length * rowH;

    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = d3.select(svgEl);
    svg.attr('viewBox', `0 0 ${width} ${height}`);
    svg.selectAll('*').remove();

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3
      .scaleBand<string>()
      .domain(REGIONS)
      .range([0, innerW])
      .padding(0.06);

    const yScale = d3
      .scaleBand<string>()
      .domain(chromosomes)
      .range([0, innerH])
      .padding(0.12);

    const colorInterpolator = d3.interpolateRgbBasis([
      '#0891B2',
      '#06B6D4',
      '#F59E0B',
      '#F43F5E',
    ]);
    const colorScale = d3
      .scaleSequential(colorInterpolator)
      .domain([0.1, maxScaleVal]);

    // Top X-axis labels
    const xAxisGroup = g
      .append('g')
      .call(
        d3
          .axisTop(xScale)
          .tickSize(0)
          .tickFormat((d) => d.toUpperCase()),
      );
    xAxisGroup.select('.domain').remove();
    xAxisGroup
      .selectAll('text')
      .attr('class', 'fill-slate-500 dark:fill-slate-400 font-mono text-[10px]')
      .attr('dy', '-0.6em');

    // Left Y-axis labels
    const yAxisGroup = g
      .append('g')
      .call(
        d3
          .axisLeft(yScale)
          .tickSize(0)
          .tickFormat((d) => `chr${d}`),
      );
    yAxisGroup.select('.domain').remove();
    yAxisGroup
      .selectAll('text')
      .attr('class', 'fill-slate-600 dark:fill-slate-300 font-mono text-[11px] font-medium')
      .attr('dx', '-0.5em');

    // Draw matrix cells
    const cellGroups = g
      .selectAll<SVGGElement, CellDatum>('g.heat-cell')
      .data(cells, (d) => `${d.chromosome}-${d.region}`)
      .enter()
      .append('g')
      .attr('class', 'heat-cell')
      .attr(
        'transform',
        (d) =>
          `translate(${xScale(d.region) ?? 0},${yScale(d.chromosome) ?? 0})`,
      );

    const cellW = xScale.bandwidth();
    const cellH = yScale.bandwidth();

    cellGroups
      .append('rect')
      .attr('width', cellW)
      .attr('height', cellH)
      .attr('rx', 3)
      .attr('stroke-width', (d) => {
        const isSelected =
          selectedCell?.chromosome === d.chromosome &&
          selectedCell?.region === d.region;
        return isSelected ? 2 : 1;
      })
      .attr('stroke', (d) => {
        const isSelected =
          selectedCell?.chromosome === d.chromosome &&
          selectedCell?.region === d.region;
        if (isSelected) return '#22D3EE';
        if (d.siteCount === 0 && d.eventCount === 0) return 'rgba(148,163,184,0.16)';
        if (d.eventCount === 0) return 'rgba(6,182,212,0.35)';
        return 'rgba(255,255,255,0.12)';
      })
      .attr('fill', (d) => {
        if (d.siteCount === 0 && d.eventCount === 0) return 'rgba(148,163,184,0.06)';
        if (metric !== 'density' && d.eventCount === 0) return 'rgba(6,182,212,0.12)';
        return colorScale(Math.max(0.1, d.value));
      })
      .attr('fill-opacity', 0)
      .style('cursor', (d) =>
        d.siteCount > 0 || d.eventCount > 0 ? 'pointer' : 'default',
      )
      .on('mouseenter', (_event, d) => {
        if (d.siteCount > 0 || d.eventCount > 0) {
          setHoveredCell(d);
        }
      })
      .on('mouseleave', () => {
        setHoveredCell(null);
      })
      .on('click', (_event, d) => {
        if (d.siteCount === 0 && d.eventCount === 0) return;
        const already =
          selectedCell?.chromosome === d.chromosome &&
          selectedCell?.region === d.region;
        onSelectCell(
          already ? null : { chromosome: d.chromosome, region: d.region },
        );
      })
      .transition()
      .duration(480)
      .delay((_d, i) => i * 14)
      .attr('fill-opacity', (d) => {
        if (d.siteCount === 0 && d.eventCount === 0) return 1;
        if (metric !== 'density' && d.eventCount === 0) return 1;
        return 0.88;
      });

    // Cell value labels
    cellGroups
      .append('text')
      .attr('x', cellW / 2)
      .attr('y', cellH / 2 + 3.5)
      .attr('text-anchor', 'middle')
      .style('pointer-events', 'none')
      .attr('class', (d) => {
        if (d.siteCount === 0 && d.eventCount === 0) {
          return 'fill-slate-400 dark:fill-slate-600 font-mono text-[10px] tabular-nums';
        }
        if (metric !== 'density' && d.eventCount === 0) {
          return 'fill-cyan-700 dark:fill-cyan-300 font-mono text-[10px] tabular-nums';
        }
        return 'fill-white font-mono text-[10px] font-semibold tabular-nums';
      })
      .text((d) => {
        if (d.siteCount === 0 && d.eventCount === 0) return '—';
        if (metric === 'density') {
          return `${d.siteCount}L · ${d.eventCount}E`;
        }
        if (d.eventCount === 0) return `0.0% (${d.siteCount}L)`;
        return `${d.value.toFixed(1)}%`;
      });
  }, [chromosomes, cells, metric, maxScaleVal, selectedCell, onSelectCell]);

  return (
    <TactileCard
      intensity="panel"
      interactiveScale={false}
      className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg p-5 space-y-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
            Chromosomal Cleavage Density Heatmap
          </h2>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">
            D3.js spatial matrix across chromosomes and genomic regions ({sites.length} predicted loci, {events.length} observed events). Click any cell to filter the log.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-[#06080D] border border-slate-200 dark:border-slate-800 rounded-md text-xs">
          {(
            [
              { id: 'maxFreq', label: 'Peak Freq' },
              { id: 'avgFreq', label: 'Mean Freq' },
              { id: 'density', label: 'Loci / Events' },
            ] as const
          ).map((opt) => (
            <TactileSegmentButton
              key={opt.id}
              onClick={() => setMetric(opt.id)}
              className={`px-2.5 py-1 rounded font-medium transition-colors whitespace-nowrap shrink-0 ${
                metric === opt.id
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {opt.label}
            </TactileSegmentButton>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        <div className="xl:col-span-8 overflow-x-auto border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#06080D] rounded-md p-3">
          {chromosomes.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
              No off-target site coordinates available.
            </div>
          ) : (
            <svg
              ref={svgRef}
              className="w-full min-w-[460px] h-auto select-none"
              role="img"
              aria-label="D3.js heatmap of genomic cleavage density across chromosomal regions"
            />
          )}
        </div>

        {/* Interactive Cell Telemetry HUD + Color Scale Legend */}
        <div className="xl:col-span-4 space-y-4">
          <div className="border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#06080D] rounded-md p-4 space-y-3 min-h-[168px]">
            <div className="flex items-center justify-between text-xs">
              <span className="font-display font-semibold text-slate-900 dark:text-slate-100">
                Region Telemetry HUD
              </span>
              {selectedCell && (
                <button
                  type="button"
                  onClick={() => onSelectCell(null)}
                  className="text-cyan-700 dark:text-cyan-400 hover:underline font-medium"
                >
                  Clear filter
                </button>
              )}
            </div>

            {(() => {
              const targetCell =
                hoveredCell ??
                (selectedCell
                  ? cells.find(
                      (c) =>
                        c.chromosome === selectedCell.chromosome &&
                        c.region === selectedCell.region,
                    ) ?? null
                  : null);

              if (!targetCell) {
                return (
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed pt-2">
                    Hover or click a chromosome × region cell to inspect predicted off-target loci, minimum mismatches, and cleavage frequency.
                  </p>
                );
              }

              return (
                <div className="space-y-2.5 text-xs">
                  <div className="font-mono font-semibold text-cyan-700 dark:text-cyan-400">
                    chr{targetCell.chromosome} · {targetCell.region}
                  </div>
                  <dl className="grid grid-cols-2 gap-2 font-mono tabular-nums">
                    <div>
                      <dt className="text-[11px] text-slate-500 dark:text-slate-400">Predicted Loci</dt>
                      <dd className="text-slate-900 dark:text-slate-100 font-semibold">
                        {targetCell.siteCount}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-slate-500 dark:text-slate-400">Events Hit</dt>
                      <dd className="text-slate-900 dark:text-slate-100 font-semibold">
                        {targetCell.eventCount}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-slate-500 dark:text-slate-400">Peak Freq</dt>
                      <dd
                        className={`font-semibold ${
                          targetCell.maxFreq >= 5
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {targetCell.maxFreq.toFixed(2)}%
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-slate-500 dark:text-slate-400">Min Mismatches</dt>
                      <dd className="text-slate-900 dark:text-slate-100 font-semibold">
                        {targetCell.minMismatch ?? '—'}
                      </dd>
                    </div>
                  </dl>
                  <div className="pt-1 border-t border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-600 dark:text-slate-300">
                    Genes: {targetCell.genes.length > 0 ? targetCell.genes.join(', ') : 'Intergenic'}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Calibrated Color Legend */}
          <div className="border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#06080D] rounded-md p-3.5 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400">
              <span>{metric === 'density' ? 'Loci + Events Scale' : 'Cleavage Intensity'}</span>
              <span>
                {metric === 'density' ? `0 – ${maxScaleVal}` : `0% – ${maxScaleVal.toFixed(1)}%`}
              </span>
            </div>
            <div
              className="h-2.5 w-full rounded-sm"
              style={{
                background:
                  'linear-gradient(to right, #0891B2, #06B6D4, #F59E0B, #F43F5E)',
              }}
            />
            <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              <span>0.0 (Unhit)</span>
              <span>{metric === 'density' ? (maxScaleVal / 2).toFixed(0) : `${(maxScaleVal / 2).toFixed(1)}%`}</span>
              <span>{metric === 'density' ? maxScaleVal : `${maxScaleVal.toFixed(1)}%`}</span>
            </div>
          </div>
        </div>
      </div>
    </TactileCard>
  );
}
