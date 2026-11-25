import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { motion } from 'motion/react';
import { apiRequest } from '../lib/api';
import { CleavageHeatmapD3, type HeatmapCellFilter } from './CleavageHeatmapD3';
import { TactileButton, TactileCard, TactileSegmentButton } from './Tactile3D';
import { LabLoader } from './TelemetryCharts';
import type { OffTargetEvent, RankedMutation, ReferenceCatalog, SampleNode, UnhitSite } from '../types';

interface MutationsViewProps {
  token: string;
  reference: ReferenceCatalog | null;
  onInspectGene: (symbol: string) => void;
  onDataChanged: () => void;
}

function riskDisplay(risk: 'HIGH' | 'MEDIUM' | 'LOW') {
  if (risk === 'HIGH') {
    return { text: '▲ HIGH', cls: 'text-rose-600 dark:text-rose-400 font-semibold' };
  }
  if (risk === 'MEDIUM') {
    return { text: '◆ MEDIUM', cls: 'text-amber-600 dark:text-amber-400 font-medium' };
  }
  return { text: '● LOW', cls: 'text-emerald-600 dark:text-emerald-400 font-medium' };
}

export function MutationsView({ token, reference, onInspectGene, onDataChanged }: MutationsViewProps) {
  const [events, setEvents] = useState<OffTargetEvent[]>([]);
  const [unhitSites, setUnhitSites] = useState<UnhitSite[]>([]);
  const [rankedInGuide, setRankedInGuide] = useState<RankedMutation[]>([]);
  const [samples, setSamples] = useState<SampleNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [riskFilter, setRiskFilter] = useState<'ALL' | 'HIGH' | 'MEDIUM' | 'LOW'>('ALL');
  const [experimentFilter, setExperimentFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selectedHeatmapCell, setSelectedHeatmapCell] = useState<HeatmapCellFilter | null>(null);

  const [showLogModal, setShowLogModal] = useState(false);
  const [sampleId, setSampleId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [mutationType, setMutationType] = useState<'SNV' | 'insertion' | 'deletion' | 'indel'>('indel');
  const [alleleFreq, setAlleleFreq] = useState('1.50');
  const [methodId, setMethodId] = useState('1');
  const [detectedOn, setDetectedOn] = useState(new Date().toISOString().slice(0, 10));
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [triggerBanner, setTriggerBanner] = useState<string | null>(null);

  const loadMutations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (riskFilter !== 'ALL') params.set('riskLevel', riskFilter);
      if (experimentFilter !== 'all') params.set('experimentId', experimentFilter);
      if (search.trim()) params.set('search', search.trim());

      const [mutRes, sampRes] = await Promise.all([
        apiRequest<{
          events: OffTargetEvent[];
          unhitSites: UnhitSite[];
          rankedInGuide: RankedMutation[];
        }>(`/api/mutations?${params.toString()}`, { token }),
        apiRequest<{ samples: SampleNode[] }>('/api/samples', { token }),
      ]);

      setEvents(mutRes.events);
      setUnhitSites(mutRes.unhitSites);
      setRankedInGuide(mutRes.rankedInGuide);
      setSamples(sampRes.samples);

      if (!sampleId && sampRes.samples.length > 0) {
        setSampleId(String(sampRes.samples[0].sample_id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load off-target mutations.');
    } finally {
      setLoading(false);
    }
  }, [token, riskFilter, experimentFilter, search, sampleId]);

  useEffect(() => {
    loadMutations();
  }, [loadMutations]);

  const compatibleSites = useMemo(() => {
    if (!reference) return [];
    const selectedSample = samples.find((s) => String(s.sample_id) === sampleId);
    if (!selectedSample) return reference.offTargetSites;
    const allowedGuideIds = new Set(
      reference.guideLinks
        .filter((gl) => gl.experiment_id === selectedSample.experiment_id)
        .map((gl) => gl.guide_id),
    );
    return reference.offTargetSites.filter((site) => allowedGuideIds.has(site.guide_id));
  }, [reference, samples, sampleId]);

  useEffect(() => {
    if (compatibleSites.length > 0 && !compatibleSites.some((s) => String(s.site_id) === siteId)) {
      setSiteId(String(compatibleSites[0].site_id));
    }
  }, [compatibleSites, siteId]);

  const displayedEvents = useMemo(() => {
    if (!selectedHeatmapCell) return events;
    return events.filter(
      (ev) =>
        ev.chromosome === selectedHeatmapCell.chromosome &&
        ev.region_type === selectedHeatmapCell.region,
    );
  }, [events, selectedHeatmapCell]);

  const handleLogMutation = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{
        alertTriggered: boolean;
        alert: { message: string } | null;
      }>('/api/mutations', {
        method: 'POST',
        token,
        body: {
          sampleId: Number(sampleId),
          siteId: Number(siteId),
          mutationType,
          alleleFreq: Number(alleleFreq),
          detectedOn,
          methodId: Number(methodId),
        },
      });
      setShowLogModal(false);
      if (res.alertTriggered && res.alert) {
        setTriggerBanner(`Alert Triggered: ${res.alert.message}`);
      } else {
        setTriggerBanner(null);
      }
      await loadMutations();
      onDataChanged();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to record mutation event.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {triggerBanner && (
        <div className="p-3.5 border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 rounded-lg flex items-center justify-between gap-4 text-sm text-amber-900 dark:text-amber-200">
          <span>{triggerBanner}</span>
          <button
            type="button"
            onClick={() => setTriggerBanner(null)}
            className="text-xs font-medium hover:underline whitespace-nowrap shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sample, guide, or gene..."
              className="pl-9 pr-3 py-2 text-sm bg-white dark:bg-[#0B0F17] border border-slate-300 dark:border-slate-700 rounded-md w-64 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md">
            {(['ALL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((level) => (
              <TactileSegmentButton
                key={level}
                onClick={() => setRiskFilter(level)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  riskFilter === level
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {level === 'ALL' ? 'All Risk' : level}
              </TactileSegmentButton>
            ))}
          </div>

          <select
            value={experimentFilter}
            onChange={(e) => setExperimentFilter(e.target.value)}
            aria-label="Filter by experiment"
            className="px-3 py-2 text-sm bg-white dark:bg-[#0B0F17] border border-slate-300 dark:border-slate-700 rounded-md"
          >
            <option value="all">All Experiments</option>
            {reference?.experiments.map((exp) => (
              <option key={exp.experiment_id} value={exp.experiment_id}>
                {exp.title}
              </option>
            ))}
          </select>
        </div>

        <TactileButton
          onClick={() => {
            setSubmitError(null);
            setShowLogModal(true);
          }}
          className="btn-3d-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-500 rounded-md whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Log Mutation</span>
        </TactileButton>
      </div>

      {error && (
        <div className="p-4 border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 rounded-lg text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* D3.js Chromosomal Cleavage Density Heatmap */}
      <CleavageHeatmapD3
        sites={reference?.offTargetSites ?? []}
        events={events}
        selectedCell={selectedHeatmapCell}
        onSelectCell={setSelectedHeatmapCell}
      />

      {/* Primary Off-Target Report Table */}
      <TactileCard
        intensity="panel"
        interactiveScale={false}
        className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
              Off-Target Mutation Report
            </h2>
            {selectedHeatmapCell && (
              <button
                type="button"
                onClick={() => setSelectedHeatmapCell(null)}
                className="text-xs font-mono text-cyan-700 dark:text-cyan-400 hover:underline"
              >
                chr{selectedHeatmapCell.chromosome} · {selectedHeatmapCell.region} ×
              </button>
            )}
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {displayedEvents.length} events
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#06080D] text-xs font-medium text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-4">Sample</th>
                <th className="py-2.5 px-3">Guide RNA</th>
                <th className="py-2.5 px-3">Genomic Locus</th>
                <th className="py-2.5 px-3">Hit Gene</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3 text-right">Mismatches</th>
                <th className="py-2.5 px-3 text-right">Allele Freq</th>
                <th className="py-2.5 px-3">Method</th>
                <th className="py-2.5 px-4">Risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-6 px-4">
                    <LabLoader label="Querying v_offtarget_report..." />
                  </td>
                </tr>
              ) : displayedEvents.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 px-4 text-center text-slate-500">
                    No off-target mutations match your current filters.
                  </td>
                </tr>
              ) : (
                displayedEvents.map((ev) => {
                  const risk = riskDisplay(ev.risk_level);
                  const freqPct = Math.min(100, (Number(ev.allele_freq) / 10) * 100);
                  return (
                    <tr
                      key={ev.event_id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-2.5 px-4 font-mono text-xs font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {ev.sample_code}
                        <span className="ml-1.5 text-slate-400">G{ev.generation}</span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {ev.guide_name}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        chr{ev.chromosome}:{Number(ev.position).toLocaleString()} · {ev.region_type}
                      </td>
                      <td className="py-2.5 px-3 text-xs whitespace-nowrap">
                        {ev.hit_gene ? (
                          <button
                            type="button"
                            onClick={() => onInspectGene(ev.hit_gene!)}
                            className="font-mono font-medium text-cyan-700 dark:text-cyan-400 hover:underline"
                          >
                            {ev.hit_gene}
                          </button>
                        ) : (
                          <span className="text-slate-400">Intergenic</span>
                        )}
                        {ev.gene_type && ev.gene_type !== 'other' && (
                          <span className="ml-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                            ({ev.gene_type.replace('_', ' ')})
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-xs text-slate-700 dark:text-slate-300">
                        {ev.mutation_type}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-xs text-right text-slate-700 dark:text-slate-300">
                        {ev.mismatch_count}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-xs text-right">
                        <div className="inline-flex flex-col items-end gap-1 min-w-[68px]">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {Number(ev.allele_freq).toFixed(2)}%
                          </span>
                          <div className="w-16 h-1 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                            <motion.div
                              initial={{ scaleX: 0 }}
                              animate={{ scaleX: 1 }}
                              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                              style={{ width: `${Math.max(8, freqPct)}%`, transformOrigin: 'left' }}
                              className={`h-full ${
                                ev.risk_level === 'HIGH'
                                  ? 'bg-rose-500'
                                  : ev.risk_level === 'MEDIUM'
                                    ? 'bg-amber-500'
                                    : 'bg-emerald-500'
                              }`}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {ev.method_name}
                      </td>
                      <td className={`py-2.5 px-4 text-xs whitespace-nowrap ${risk.cls}`}>
                        {risk.text}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </TactileCard>

      {/* Secondary Analytics Grid: Window Rank + Unhit Predicted Sites */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TactileCard
          intensity="panel"
          className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
              Severity Rank Within Each Guide RNA
            </h3>
            <p className="text-[13px] text-slate-500 dark:text-slate-400">
              Ranked by allele frequency using SQL window partitioning
            </p>
          </div>
          <div className="overflow-x-auto max-h-72">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#06080D] text-slate-500 dark:text-slate-400">
                  <th className="py-2 px-4">Guide</th>
                  <th className="py-2 px-3">Rank</th>
                  <th className="py-2 px-3">Sample</th>
                  <th className="py-2 px-3">Target</th>
                  <th className="py-2 px-4 text-right">Freq</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {rankedInGuide.slice(0, 12).map((row) => (
                  <tr key={row.event_id}>
                    <td className="py-2 px-4 font-mono text-slate-700 dark:text-slate-300">
                      {row.guide_name}
                    </td>
                    <td className="py-2 px-3 font-mono tabular-nums font-semibold text-cyan-700 dark:text-cyan-400">
                      #{row.rank_in_guide}
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-900 dark:text-slate-100">
                      {row.sample_code}
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-500 dark:text-slate-400">
                      {row.hit_gene ?? 'Intergenic'}
                    </td>
                    <td className="py-2 px-4 font-mono tabular-nums text-right font-medium text-slate-900 dark:text-slate-100">
                      {Number(row.allele_freq).toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TactileCard>

        <TactileCard
          intensity="panel"
          className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
              Predicted Sites With Zero Detected Cleavage
            </h3>
            <p className="text-[13px] text-slate-500 dark:text-slate-400">
              In-silico nominated sites showing no observed mutation events
            </p>
          </div>
          {unhitSites.length === 0 ? (
            <div className="p-6 text-xs text-slate-500 dark:text-slate-400">
              All predicted off-target sites currently have recorded mutation events.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#06080D] text-slate-500 dark:text-slate-400">
                    <th className="py-2 px-4">Site ID</th>
                    <th className="py-2 px-3">Guide</th>
                    <th className="py-2 px-3">Locus</th>
                    <th className="py-2 px-3">Region</th>
                    <th className="py-2 px-4 text-right">Mismatches</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {unhitSites.map((site) => (
                    <tr key={site.site_id}>
                      <td className="py-2 px-4 font-mono tabular-nums text-slate-600 dark:text-slate-400">
                        OT-{site.site_id}
                      </td>
                      <td className="py-2 px-3 font-mono font-medium text-slate-900 dark:text-slate-100">
                        {site.guide_name}
                      </td>
                      <td className="py-2 px-3 font-mono tabular-nums text-slate-600 dark:text-slate-400">
                        chr{site.chromosome}:{Number(site.position).toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                        {site.region_type}
                      </td>
                      <td className="py-2 px-4 font-mono tabular-nums text-right text-slate-700 dark:text-slate-300">
                        {site.mismatch_count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TactileCard>
      </div>

      {/* Log Mutation Modal */}
      {showLogModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="log-mutation-title"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-lg bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-lg p-6"
          >
            <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h3
                  id="log-mutation-title"
                  className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100"
                >
                  Log Off-Target Mutation Event
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Events with allele frequency ≥ 5.0% automatically trigger an alert_log entry.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowLogModal(false)}
                className="p-2 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleLogMutation} className="mt-4 space-y-4">
              {submitError && (
                <div className="p-3 border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 rounded-md text-xs text-rose-700 dark:text-rose-300">
                  {submitError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Target Cell Sample
                </label>
                <select
                  value={sampleId}
                  onChange={(e) => setSampleId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                >
                  {samples.map((s) => (
                    <option key={s.sample_id} value={s.sample_id}>
                      {s.sample_code} ({s.cell_line} · {s.experiment_title})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Compatible Off-Target Site (from sample’s experiment guides)
                </label>
                <select
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                >
                  {compatibleSites.map((site) => (
                    <option key={site.site_id} value={site.site_id}>
                      {site.guide_name} · chr{site.chromosome}:{site.position.toLocaleString()} ({site.region_type}
                      {site.gene_symbol ? ` · ${site.gene_symbol}` : ''}, {site.mismatch_count} MM)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Mutation Type
                  </label>
                  <select
                    value={mutationType}
                    onChange={(e) =>
                      setMutationType(e.target.value as 'SNV' | 'insertion' | 'deletion' | 'indel')
                    }
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                  >
                    <option value="indel">indel</option>
                    <option value="deletion">deletion</option>
                    <option value="insertion">insertion</option>
                    <option value="SNV">SNV</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Allele Frequency (%)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    required
                    value={alleleFreq}
                    onChange={(e) => setAlleleFreq(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Detection Method
                  </label>
                  <select
                    value={methodId}
                    onChange={(e) => setMethodId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                  >
                    {reference?.detectionMethods.map((m) => (
                      <option key={m.method_id} value={m.method_id}>
                        {m.method_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Detected On
                  </label>
                  <input
                    type="date"
                    required
                    value={detectedOn}
                    onChange={(e) => setDetectedOn(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                <TactileButton
                  onClick={() => setShowLogModal(false)}
                  className="btn-3d-secondary px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-[#101622] border border-slate-300 dark:border-slate-700 rounded-md"
                >
                  Cancel
                </TactileButton>
                <TactileButton
                  type="submit"
                  disabled={submitting || compatibleSites.length === 0}
                  className="btn-3d-primary px-4 py-2 text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-md"
                >
                  {submitting ? 'Recording...' : 'Record Mutation'}
                </TactileButton>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
