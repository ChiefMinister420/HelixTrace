import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { motion } from 'motion/react';
import { apiRequest } from '../lib/api';
import { TactileButton, TactileCard } from './Tactile3D';
import {
  AnimatedMismatchChart,
  AnimatedNumber,
  LabLoader,
  MiniHelixMark,
  RadarFidelityChart,
} from './TelemetryCharts';
import type {
  DashboardData,
  OffTargetEvent,
  OffTargetSiteRecord,
  ReferenceCatalog,
} from '../types';

interface OverviewViewProps {
  token: string;
  dashboard: DashboardData | null;
  reference: ReferenceCatalog | null;
  onNavigate: (tab: 'lineage' | 'mutations' | 'experiments' | 'guides' | 'alerts') => void;
  onInspectGene: (symbol: string) => void;
}

const CHROMOSOME_ORDER = ['2', '3', '5', '6', '7', '8', '11', '17'];

export function OverviewView({
  token,
  dashboard,
  reference,
  onNavigate,
  onInspectGene,
}: OverviewViewProps) {
  const [events, setEvents] = useState<OffTargetEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiRequest<{ events: OffTargetEvent[] }>('/api/mutations', { token })
      .then((res) => {
        if (!cancelled) {
          setEvents(res.events);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const sites = reference?.offTargetSites ?? [];

  const siteTelemetry = useMemo(() => {
    const map = new Map<
      number,
      {
        site: OffTargetSiteRecord;
        maxFreq: number;
        risk: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNHIT';
        eventCount: number;
        latestSample: string | null;
      }
    >();

    for (const site of sites) {
      const matching = events.filter(
        (ev) =>
          ev.guide_name === site.guide_name &&
          ev.chromosome === site.chromosome &&
          Number(ev.position) === Number(site.position),
      );
      let risk: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNHIT' = 'UNHIT';
      let maxFreq = 0;
      let latestSample: string | null = null;
      for (const ev of matching) {
        if (Number(ev.allele_freq) >= maxFreq) {
          maxFreq = Number(ev.allele_freq);
          latestSample = ev.sample_code;
        }
        if (ev.risk_level === 'HIGH') risk = 'HIGH';
        else if (ev.risk_level === 'MEDIUM' && risk !== 'HIGH') risk = 'MEDIUM';
        else if (ev.risk_level === 'LOW' && risk === 'UNHIT') risk = 'LOW';
      }
      map.set(site.site_id, {
        site,
        maxFreq,
        risk,
        eventCount: matching.length,
        latestSample,
      });
    }
    return map;
  }, [sites, events]);

  useEffect(() => {
    if (selectedSiteId === null && sites.length > 0) {
      const priority = sites.find((s) => s.gene_symbol === 'TP53') ?? sites[0];
      setSelectedSiteId(priority.site_id);
    }
  }, [sites, selectedSiteId]);

  const selectedLocus = selectedSiteId ? siteTelemetry.get(selectedSiteId) ?? null : null;

  const riskCounts = useMemo(() => {
    const high = events.filter((e) => e.risk_level === 'HIGH').length;
    const med = events.filter((e) => e.risk_level === 'MEDIUM').length;
    const low = events.filter((e) => e.risk_level === 'LOW').length;
    const total = Math.max(1, events.length);
    return { high, med, low, total };
  }, [events]);

  if (loading && !dashboard) {
    return <LabLoader label="Loading genomic telemetry..." />;
  }

  return (
    <div className="space-y-6">
      {/* 4-column Tactile 3D Telemetry Strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <TactileCard
          intensity="compact"
          className="p-5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg"
        >
          <div className="text-[13px] font-medium text-slate-500 dark:text-slate-400">
            Predicted Off-Target Loci
          </div>
          <div className="mt-1.5 text-3xl sm:text-[34px] leading-none font-mono font-semibold text-slate-900 dark:text-slate-100 text-3d-relief">
            <AnimatedNumber value={sites.length} />
          </div>
          <div className="mt-2 text-xs font-mono text-slate-500 dark:text-slate-400">
            {dashboard?.totals.guides ?? 0} active guide RNAs
          </div>
        </TactileCard>

        <TactileCard
          intensity="compact"
          className="p-5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg"
        >
          <div className="text-[13px] font-medium text-slate-500 dark:text-slate-400">
            Identified Mutations
          </div>
          <div className="mt-1.5 text-3xl sm:text-[34px] leading-none font-mono font-semibold text-cyan-700 dark:text-cyan-400 text-3d-relief">
            <AnimatedNumber value={dashboard?.totals.mutations ?? events.length} />
          </div>
          <div className="mt-2 text-xs font-mono text-slate-500 dark:text-slate-400">
            {dashboard?.totals.samples ?? 0} tracked cell samples
          </div>
        </TactileCard>

        <TactileCard
          intensity="compact"
          className="p-5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg"
        >
          <div className="text-[13px] font-medium text-slate-500 dark:text-slate-400">
            High-Risk Cleavage
          </div>
          <div className="mt-1.5 text-3xl sm:text-[34px] leading-none font-mono font-semibold text-rose-600 dark:text-rose-400 text-3d-relief">
            <AnimatedNumber value={dashboard?.totals.high_risk ?? riskCounts.high} />
          </div>
          <div className="mt-2 text-xs font-mono text-amber-600 dark:text-amber-400">
            {dashboard?.totals.alerts ?? 0} trigger logs ≥ 5.0%
          </div>
        </TactileCard>

        <TactileCard
          intensity="compact"
          className="p-5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg flex items-center justify-between gap-3"
        >
          <div>
            <div className="text-[13px] font-medium text-slate-500 dark:text-slate-400">
              Active Protocols
            </div>
            <div className="mt-1.5 text-3xl sm:text-[34px] leading-none font-mono font-semibold text-emerald-600 dark:text-emerald-400 text-3d-relief">
              <AnimatedNumber value={dashboard?.totals.experiments ?? 0} />
            </div>
            <div className="mt-2 text-xs font-mono text-slate-500 dark:text-slate-400">
              3NF relational lineage
            </div>
          </div>
          <MiniHelixMark className="w-16 h-14 shrink-0 opacity-85 hidden sm:block" />
        </TactileCard>
      </section>

      {/* Primary Scientific Charts: Chromosome Ideogram + Cas9 Radar Calibration */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Chromosome Mapping Ideogram */}
        <TactileCard
          intensity="panel"
          className="xl:col-span-7 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg p-5 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
                Chromosome Off-Target Locus Map
              </h2>
              <p className="text-[13px] text-slate-500 dark:text-slate-400">
                Select any genomic marker to inspect cleavage frequency and target annotation
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono text-slate-500 dark:text-slate-400">
              <span className="text-rose-600 dark:text-rose-400">▲ High</span>
              <span className="text-amber-600 dark:text-amber-400">◆ Med</span>
              <span className="text-emerald-600 dark:text-emerald-400">● Low</span>
              <span className="text-cyan-700 dark:text-cyan-400">○ Unhit</span>
            </div>
          </div>

          <div className="space-y-2">
            {CHROMOSOME_ORDER.map((chr) => {
              const chrSites = sites.filter((s) => s.chromosome === chr);
              return (
                <div
                  key={chr}
                  className="grid grid-cols-12 items-center gap-3 py-1.5 border-b border-slate-100 dark:border-slate-800/70 last:border-b-0"
                >
                  <div className="col-span-2 sm:col-span-1 font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
                    chr{chr}
                  </div>
                  <div className="col-span-10 sm:col-span-11 relative h-6 flex items-center">
                    <div className="w-full h-1.5 rounded-sm bg-slate-100 dark:bg-[#06080D] border border-slate-200 dark:border-slate-800 relative overflow-hidden">
                      <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-2 bg-slate-300 dark:bg-slate-700" />
                    </div>

                    {chrSites.map((site, idx) => {
                      const tel = siteTelemetry.get(site.site_id);
                      const pct = Math.min(
                        92,
                        Math.max(8, ((Number(site.position) % 100000000) / 100000000) * 84 + 8),
                      );
                      const offsetPct =
                        chrSites.length > 1 ? Math.min(93, Math.max(7, pct + idx * 4)) : pct;
                      const isSelected = selectedSiteId === site.site_id;

                      let dotColor = 'bg-emerald-500 border-emerald-300 dark:border-emerald-700';
                      if (tel?.risk === 'HIGH') {
                        dotColor = 'bg-rose-500 border-rose-300 dark:border-rose-700';
                      } else if (tel?.risk === 'MEDIUM') {
                        dotColor = 'bg-amber-500 border-amber-300 dark:border-amber-700';
                      } else if (tel?.risk === 'UNHIT') {
                        dotColor = 'bg-cyan-500 border-cyan-300 dark:border-cyan-700';
                      }

                      return (
                        <motion.button
                          key={site.site_id}
                          type="button"
                          whileHover={{ scale: 1.35 }}
                          whileTap={{ scale: 0.92 }}
                          onClick={() => setSelectedSiteId(site.site_id)}
                          style={{ left: `${offsetPct}%` }}
                          title={`${site.gene_symbol ?? 'Intergenic'} (chr${site.chromosome}:${site.position})`}
                          className={`absolute -translate-x-1/2 w-3.5 h-3.5 rounded-full border ${dotColor} ${
                            isSelected
                              ? 'scale-125 ring-2 ring-cyan-500 dark:ring-cyan-300'
                              : ''
                          }`}
                          aria-label={`Inspect ${site.gene_symbol ?? 'Intergenic'} on chr${site.chromosome}`}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {selectedLocus && (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 text-[13px] font-mono">
                  <span className="font-semibold text-cyan-700 dark:text-cyan-400">
                    chr{selectedLocus.site.chromosome}:
                    {Number(selectedLocus.site.position).toLocaleString()}
                  </span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-700 dark:text-slate-200">
                    {selectedLocus.site.region_type}
                  </span>
                  <span className="text-slate-400">·</span>
                  {selectedLocus.site.gene_symbol ? (
                    <button
                      type="button"
                      onClick={() => onInspectGene(selectedLocus.site.gene_symbol!)}
                      className="text-emerald-700 dark:text-emerald-400 hover:underline font-semibold"
                    >
                      {selectedLocus.site.gene_symbol}
                    </button>
                  ) : (
                    <span className="text-slate-500 dark:text-slate-400">Intergenic</span>
                  )}
                </div>
                <div className="text-[13px] text-slate-500 dark:text-slate-400">
                  Guide <span className="font-mono text-slate-700 dark:text-slate-300">{selectedLocus.site.guide_name}</span> ·{' '}
                  {selectedLocus.site.mismatch_count} mismatches · {selectedLocus.eventCount} event
                  {selectedLocus.eventCount === 1 ? '' : 's'}
                </div>
              </div>

              <div className="text-right font-mono tabular-nums">
                <div
                  className={`text-xl font-semibold ${
                    selectedLocus.risk === 'HIGH'
                      ? 'text-rose-600 dark:text-rose-400'
                      : selectedLocus.risk === 'MEDIUM'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {selectedLocus.maxFreq.toFixed(2)}%
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedLocus.latestSample
                    ? `Peak in ${selectedLocus.latestSample}`
                    : 'Unhit predicted locus'}
                </div>
              </div>
            </div>
          )}
        </TactileCard>

        {/* Animated Radar Calibration Chart */}
        <TactileCard
          intensity="panel"
          className="xl:col-span-5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg p-5"
        >
          <RadarFidelityChart dashboard={dashboard} events={events} />
        </TactileCard>
      </div>

      {/* Secondary Graphs & Recent Discoveries */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <TactileCard
          intensity="panel"
          className="lg:col-span-6 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg p-5 space-y-5"
        >
          <AnimatedMismatchChart points={dashboard?.mismatchStats ?? []} />

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between text-[13px]">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                Pathogenicity Stratification
              </span>
              <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                {events.length} total events
              </span>
            </div>

            <div className="h-2.5 w-full rounded-sm bg-slate-100 dark:bg-[#06080D] border border-slate-200 dark:border-slate-800 overflow-hidden flex">
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  width: `${(riskCounts.high / riskCounts.total) * 100}%`,
                  transformOrigin: 'left',
                }}
                className="bg-rose-500"
              />
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.65, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  width: `${(riskCounts.med / riskCounts.total) * 100}%`,
                  transformOrigin: 'left',
                }}
                className="bg-amber-500"
              />
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.65, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  width: `${(riskCounts.low / riskCounts.total) * 100}%`,
                  transformOrigin: 'left',
                }}
                className="bg-emerald-500"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] font-mono tabular-nums">
              <span className="text-rose-600 dark:text-rose-400">▲ High: {riskCounts.high}</span>
              <span className="text-amber-600 dark:text-amber-400">◆ Medium: {riskCounts.med}</span>
              <span className="text-emerald-600 dark:text-emerald-400">● Low: {riskCounts.low}</span>
            </div>
          </div>
        </TactileCard>

        <TactileCard
          intensity="panel"
          className="lg:col-span-6 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg p-5 flex flex-col justify-between gap-4"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
                  Recent Off-Target Events
                </h3>
                <p className="text-[13px] text-slate-500 dark:text-slate-400">
                  Latest sequenced cleavage records
                </p>
              </div>
              <motion.button
                type="button"
                whileHover={{ scale: 1.04, x: 1 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => onNavigate('mutations')}
                className="text-[13px] font-medium text-cyan-700 dark:text-cyan-400 hover:underline inline-flex items-center gap-1 whitespace-nowrap shrink-0"
              >
                <span>Open Log</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </motion.button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-3">Clone</th>
                    <th className="py-2 pr-3">Locus</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3 text-right">Freq</th>
                    <th className="py-2 text-right">Risk</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {events.slice(0, 6).map((ev) => (
                    <tr
                      key={ev.event_id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-2.5 pr-3 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {ev.sample_code}
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-xs">
                        {ev.hit_gene ? (
                          <button
                            type="button"
                            onClick={() => onInspectGene(ev.hit_gene!)}
                            className="text-cyan-700 dark:text-cyan-400 hover:underline"
                          >
                            {ev.hit_gene}
                          </button>
                        ) : (
                          <span className="text-slate-500 dark:text-slate-400">chr{ev.chromosome}</span>
                        )}
                        <span className="ml-1.5 text-slate-400">· {ev.region_type}</span>
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-xs text-slate-600 dark:text-slate-300">
                        {ev.mutation_type}
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-xs tabular-nums text-right font-semibold text-slate-900 dark:text-slate-100">
                        {Number(ev.allele_freq).toFixed(2)}%
                      </td>
                      <td
                        className={`py-2.5 text-right font-mono text-xs font-semibold ${
                          ev.risk_level === 'HIGH'
                            ? 'text-rose-600 dark:text-rose-400'
                            : ev.risk_level === 'MEDIUM'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {ev.risk_level === 'HIGH'
                          ? '▲ HIGH'
                          : ev.risk_level === 'MEDIUM'
                            ? '◆ MED'
                            : '● LOW'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-3">
            <TactileButton
              onClick={() => onNavigate('lineage')}
              className="btn-3d-secondary px-3.5 py-2 text-[13px] font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-[#101622] border border-slate-300 dark:border-slate-700 rounded-md whitespace-nowrap"
            >
              Inspect Lineage Tree
            </TactileButton>
            <TactileButton
              onClick={() => onNavigate('guides')}
              className="btn-3d-secondary px-3.5 py-2 text-[13px] font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-[#101622] border border-slate-300 dark:border-slate-700 rounded-md whitespace-nowrap"
            >
              Spacer Sequence Viewer
            </TactileButton>
            <TactileButton
              onClick={() => onNavigate('alerts')}
              className="btn-3d-secondary px-3.5 py-2 text-[13px] font-medium text-rose-600 dark:text-rose-400 bg-white dark:bg-[#101622] border border-slate-300 dark:border-slate-700 rounded-md whitespace-nowrap"
            >
              Audit Alerts
            </TactileButton>
          </div>
        </TactileCard>
      </div>
    </div>
  );
}
