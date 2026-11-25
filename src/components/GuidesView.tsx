import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Dna, ExternalLink, Plus, X } from 'lucide-react';
import { motion } from 'motion/react';
import { apiRequest } from '../lib/api';
import { TactileButton, TactileCard } from './Tactile3D';
import { LabLoader } from './TelemetryCharts';
import type { GuideRnaRecord, OffTargetSiteRecord, ReferenceCatalog } from '../types';

interface GuidesViewProps {
  token: string;
  reference: ReferenceCatalog | null;
  onInspectGene: (symbol: string, organism?: string) => void;
  onDataChanged: () => void;
}

function baseStyle(base: string) {
  if (base === 'G') return 'text-cyan-700 dark:text-cyan-400 border-cyan-500/35 bg-cyan-500/10';
  if (base === 'C') return 'text-blue-700 dark:text-blue-400 border-blue-500/35 bg-blue-500/10';
  if (base === 'A') return 'text-emerald-700 dark:text-emerald-400 border-emerald-500/35 bg-emerald-500/10';
  if (base === 'T') return 'text-amber-700 dark:text-amber-400 border-amber-500/35 bg-amber-500/10';
  return 'text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900';
}

function renderSpacerBases(seq: string) {
  return seq.split('').map((base, idx) => {
    let cls = 'text-slate-700 dark:text-slate-300';
    if (base === 'G') cls = 'text-cyan-700 dark:text-cyan-400';
    else if (base === 'C') cls = 'text-blue-700 dark:text-blue-400';
    else if (base === 'A') cls = 'text-emerald-700 dark:text-emerald-400';
    else if (base === 'T') cls = 'text-amber-700 dark:text-amber-400';
    return (
      <span key={idx} className={cls}>
        {base}
      </span>
    );
  });
}

export function GuidesView({ token, reference, onInspectGene, onDataChanged }: GuidesViewProps) {
  const [guides, setGuides] = useState<GuideRnaRecord[]>([]);
  const [sites, setSites] = useState<OffTargetSiteRecord[]>([]);
  const [selectedGuideId, setSelectedGuideId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showGuideModal, setShowGuideModal] = useState(false);
  const [guideName, setGuideName] = useState('');
  const [spacerSeq, setSpacerSeq] = useState('');
  const [pamSeq, setPamSeq] = useState('NGG');
  const [targetGeneId, setTargetGeneId] = useState('1');
  const [onTargetScore, setOnTargetScore] = useState('85.0');
  const [guideError, setGuideError] = useState<string | null>(null);
  const [savingGuide, setSavingGuide] = useState(false);

  const [showSiteModal, setShowSiteModal] = useState(false);
  const [siteGuideId, setSiteGuideId] = useState('1');
  const [chromosome, setChromosome] = useState('17');
  const [position, setPosition] = useState('7675000');
  const [mismatchCount, setMismatchCount] = useState('2');
  const [regionType, setRegionType] = useState<'exon' | 'intron' | 'intergenic'>('intron');
  const [siteGeneId, setSiteGeneId] = useState('');
  const [siteError, setSiteError] = useState<string | null>(null);
  const [savingSite, setSavingSite] = useState(false);

  const loadGuides = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ guides: GuideRnaRecord[]; sites: OffTargetSiteRecord[] }>(
        '/api/guides',
        { token },
      );
      setGuides(res.guides);
      setSites(res.sites);
      if (res.guides.length > 0) {
        setSelectedGuideId((prev) =>
          prev !== null && res.guides.some((g) => g.guide_id === prev) ? prev : res.guides[0].guide_id,
        );
        setSiteGuideId((prev) => prev || String(res.guides[0].guide_id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load guide RNAs.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadGuides();
  }, [loadGuides]);

  const selectedGuide = useMemo(
    () => guides.find((g) => g.guide_id === selectedGuideId) ?? guides[0] ?? null,
    [guides, selectedGuideId],
  );

  const selectedGuideSites = useMemo(
    () => (selectedGuide ? sites.filter((s) => s.guide_id === selectedGuide.guide_id) : []),
    [sites, selectedGuide],
  );

  const maxGuideLoad = useMemo(
    () => Math.max(8, ...guides.map((g) => Number(g.total_load))),
    [guides],
  );

  const handleCreateGuide = async (e: FormEvent) => {
    e.preventDefault();
    setGuideError(null);
    setSavingGuide(true);
    try {
      await apiRequest('/api/guides', {
        method: 'POST',
        token,
        body: {
          guideName,
          spacerSeq,
          pamSeq,
          targetGeneId: Number(targetGeneId),
          onTargetScore: Number(onTargetScore),
        },
      });
      setShowGuideModal(false);
      setGuideName('');
      setSpacerSeq('');
      await loadGuides();
      onDataChanged();
    } catch (err) {
      setGuideError(err instanceof Error ? err.message : 'Failed to create guide RNA.');
    } finally {
      setSavingGuide(false);
    }
  };

  const handleCreateSite = async (e: FormEvent) => {
    e.preventDefault();
    setSiteError(null);
    setSavingSite(true);
    try {
      await apiRequest('/api/off-target-sites', {
        method: 'POST',
        token,
        body: {
          guideId: Number(siteGuideId),
          chromosome,
          position: Number(position),
          mismatchCount: Number(mismatchCount),
          regionType,
          geneId: regionType === 'intergenic' || !siteGeneId ? null : Number(siteGeneId),
        },
      });
      setShowSiteModal(false);
      await loadGuides();
      onDataChanged();
    } catch (err) {
      setSiteError(err instanceof Error ? err.message : 'Failed to add off-target site.');
    } finally {
      setSavingSite(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-[15px] text-slate-600 dark:text-slate-400">
          Inspect 20-nt spacer sequences, on-target efficiency scores, and cumulative off-target load per guide RNA.
        </p>
        <div className="flex items-center gap-3">
          <TactileButton
            onClick={() => {
              setSiteError(null);
              setShowSiteModal(true);
            }}
            className="btn-3d-secondary inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-[#101622] border border-slate-300 dark:border-slate-700 rounded-md whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add Off-Target Site</span>
          </TactileButton>
          <TactileButton
            onClick={() => {
              setGuideError(null);
              setShowGuideModal(true);
            }}
            className="btn-3d-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-500 rounded-md whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add Guide RNA</span>
          </TactileButton>
        </div>
      </div>

      {error && (
        <div className="p-4 border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 rounded-lg text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Interactive Spacer Sequence Viewer + Animated Guide Load Chart */}
      {selectedGuide && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <TactileCard
            intensity="panel"
            className="xl:col-span-8 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg p-5 space-y-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-[13px] font-medium text-cyan-700 dark:text-cyan-400">
                  <Dna className="w-4 h-4" />
                  <span>20-nt Spacer &amp; Cas9 Seed-Region Alignment</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <h2 className="text-xl font-mono font-semibold text-slate-900 dark:text-slate-100 text-3d-relief">
                    {selectedGuide.guide_name}
                  </h2>
                  <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                    <button
                      type="button"
                      onClick={() => onInspectGene(selectedGuide.target_gene, selectedGuide.organism)}
                      className="text-cyan-700 dark:text-cyan-400 hover:underline inline-flex items-center gap-1"
                    >
                      <span>{selectedGuide.target_gene}</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>{' '}
                    · chr{selectedGuide.target_chromosome} · {selectedGuide.organism}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-6 font-mono tabular-nums text-xs">
                <div>
                  <div className="text-slate-500 dark:text-slate-400">On-Target</div>
                  <div className="mt-0.5 text-base font-semibold text-emerald-600 dark:text-emerald-400">
                    {Number(selectedGuide.on_target_score).toFixed(1)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500 dark:text-slate-400">Off-Target Load</div>
                  <div
                    className={`mt-0.5 text-base font-semibold ${
                      Number(selectedGuide.total_load) > 5
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-cyan-700 dark:text-cyan-400'
                    }`}
                  >
                    {Number(selectedGuide.total_load).toFixed(2)}%
                  </div>
                </div>
              </div>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#06080D] rounded-md p-4 overflow-x-auto space-y-2.5">
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400 min-w-[660px]">
                <span>5&apos; — Distal (nt 1–12)</span>
                <span className="text-cyan-700 dark:text-cyan-400">
                  Seed Region (nt 13–20) + PAM ({selectedGuide.pam_seq}) — 3&apos;
                </span>
              </div>

              <div className="flex items-center gap-1 min-w-[660px]">
                {selectedGuide.spacer_seq.split('').map((base, idx) => {
                  const isSeed = idx >= 12;
                  return (
                    <motion.div
                      key={`${selectedGuide.guide_id}-${idx}`}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      whileHover={{
                        y: -3,
                        scale: 1.09,
                        rotateX: 6,
                        transition: { duration: 0.14, ease: [0.16, 1, 0.3, 1] },
                      }}
                      transition={{ delay: idx * 0.015, duration: 0.2 }}
                      style={{ transformPerspective: 500 }}
                      className="flex flex-col items-center gap-1 cursor-default"
                    >
                      <div
                        className={`w-7 h-8 rounded border flex items-center justify-center font-mono text-xs font-semibold ${baseStyle(
                          base,
                        )} ${isSeed ? 'ring-1 ring-cyan-500/40' : ''}`}
                      >
                        {base}
                      </div>
                      <span className="text-[10px] font-mono tabular-nums text-slate-400">
                        {idx + 1}
                      </span>
                    </motion.div>
                  );
                })}

                <div className="mx-1 text-slate-300 dark:text-slate-700 font-mono">│</div>

                {selectedGuide.pam_seq.split('').map((base, idx) => (
                  <div key={`pam-${idx}`} className="flex flex-col items-center gap-1">
                    <div className="w-7 h-8 rounded border border-slate-300 dark:border-slate-700 bg-slate-200/70 dark:bg-slate-800 text-slate-900 dark:text-slate-100 flex items-center justify-center font-mono text-xs font-semibold">
                      {base}
                    </div>
                    <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                      PAM
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {selectedGuideSites.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 text-xs font-mono text-slate-600 dark:text-slate-300">
                <span className="text-slate-500 dark:text-slate-400">Mapped loci:</span>
                {selectedGuideSites.map((site) => (
                  <span key={site.site_id}>
                    chr{site.chromosome}:{Number(site.position).toLocaleString()} ({site.region_type} ·{' '}
                    <span
                      className={
                        site.mismatch_count <= 2
                          ? 'text-rose-600 dark:text-rose-400 font-semibold'
                          : 'text-amber-600 dark:text-amber-400'
                      }
                    >
                      {site.mismatch_count} MM
                    </span>
                    )
                  </span>
                ))}
              </div>
            )}
          </TactileCard>

          {/* Animated Cumulative Load Comparison Graph */}
          <TactileCard
            intensity="panel"
            className="xl:col-span-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg p-5 space-y-4"
          >
            <div>
              <h3 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
                Cumulative Off-Target Load
              </h3>
              <p className="text-[13px] text-slate-500 dark:text-slate-400">
                Sum of allele frequencies per sgRNA
              </p>
            </div>

            <div className="space-y-3">
              {guides.map((g, idx) => {
                const pct = Math.min(100, (Number(g.total_load) / maxGuideLoad) * 100);
                const highLoad = Number(g.total_load) > 5;
                const isSelected = selectedGuide.guide_id === g.guide_id;
                return (
                  <motion.button
                    key={g.guide_id}
                    type="button"
                    whileHover={{ x: 2 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={() => setSelectedGuideId(g.guide_id)}
                    className="w-full text-left space-y-1 group"
                  >
                    <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                      <span
                        className={
                          isSelected
                            ? 'font-semibold text-cyan-700 dark:text-cyan-400'
                            : 'text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-slate-100'
                        }
                      >
                        {g.guide_name}
                      </span>
                      <span
                        className={
                          highLoad
                            ? 'text-rose-600 dark:text-rose-400 font-semibold'
                            : 'text-slate-600 dark:text-slate-300'
                        }
                      >
                        {Number(g.total_load).toFixed(2)}%
                      </span>
                    </div>
                    <div className="h-2 w-full bg-slate-100 dark:bg-[#06080D] border border-slate-200 dark:border-slate-800 rounded-sm overflow-hidden">
                      <motion.div
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ duration: 0.55, delay: idx * 0.06, ease: [0.16, 1, 0.3, 1] }}
                        style={{ width: `${Math.max(4, pct)}%`, transformOrigin: 'left' }}
                        className={`h-full ${
                          highLoad
                            ? 'bg-rose-500'
                            : isSelected
                              ? 'bg-cyan-500'
                              : 'bg-emerald-500'
                        }`}
                      />
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </TactileCard>
        </div>
      )}

      {/* Guide RNA Table */}
      <TactileCard
        intensity="panel"
        interactiveScale={false}
        className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
            Guide RNA Specificity Matrix
          </h2>
          <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {guides.length} sgRNAs
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#06080D] text-xs font-medium text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-4">Guide Name</th>
                <th className="py-2.5 px-3">20-nt Spacer + PAM</th>
                <th className="py-2.5 px-3">Target Gene</th>
                <th className="py-2.5 px-3 text-right">On-Target</th>
                <th className="py-2.5 px-3 text-right">Sites</th>
                <th className="py-2.5 px-3 text-right">Mutations</th>
                <th className="py-2.5 px-4 text-right">Total Load</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-6 px-4">
                    <LabLoader label="Loading guide RNAs..." />
                  </td>
                </tr>
              ) : (
                guides.map((g) => {
                  const highLoad = Number(g.total_load) > 5;
                  const isSelected = selectedGuide?.guide_id === g.guide_id;
                  return (
                    <tr
                      key={g.guide_id}
                      onClick={() => setSelectedGuideId(g.guide_id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-cyan-50/70 dark:bg-cyan-950/30'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {isSelected && <span className="text-cyan-600 dark:text-cyan-400 mr-1.5">▸</span>}
                        {g.guide_name}
                      </td>
                      <td className="py-3 px-3 font-mono text-xs whitespace-nowrap tracking-wide">
                        <span>{renderSpacerBases(g.spacer_seq)}</span>
                        <span className="ml-1.5 text-slate-400 dark:text-slate-500 font-semibold">
                          {g.pam_seq}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-xs whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onInspectGene(g.target_gene, g.organism);
                          }}
                          className="font-mono font-medium text-cyan-700 dark:text-cyan-400 hover:underline"
                        >
                          {g.target_gene}
                        </button>
                        <span className="ml-1.5 text-slate-500 dark:text-slate-400">
                          · chr{g.target_chromosome}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300">
                        {Number(g.on_target_score).toFixed(1)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300">
                        {g.predicted_sites}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300">
                        {g.detected_mutations}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-mono tabular-nums text-xs font-semibold whitespace-nowrap ${
                          highLoad
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {highLoad ? '▲ ' : ''}
                        {Number(g.total_load).toFixed(2)}%
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </TactileCard>

      {/* Predicted Off-Target Sites Catalog */}
      <TactileCard
        intensity="panel"
        interactiveScale={false}
        className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
            Predicted Off-Target Locus Catalog
          </h3>
          <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {sites.length} loci
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#06080D] text-slate-500 dark:text-slate-400">
                <th className="py-2 px-4">Site</th>
                <th className="py-2 px-3">Guide RNA</th>
                <th className="py-2 px-3">Chromosome</th>
                <th className="py-2 px-3 text-right">Position</th>
                <th className="py-2 px-3">Region</th>
                <th className="py-2 px-3">Gene</th>
                <th className="py-2 px-4 text-right">Mismatches</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {sites.map((site) => (
                <tr key={site.site_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-2 px-4 font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    OT-{site.site_id}
                  </td>
                  <td className="py-2 px-3 font-mono font-medium text-slate-900 dark:text-slate-100">
                    {site.guide_name}
                  </td>
                  <td className="py-2 px-3 font-mono text-slate-700 dark:text-slate-300">
                    chr{site.chromosome}
                  </td>
                  <td className="py-2 px-3 font-mono tabular-nums text-right text-slate-700 dark:text-slate-300">
                    {Number(site.position).toLocaleString()}
                  </td>
                  <td className="py-2 px-3 text-slate-600 dark:text-slate-300">{site.region_type}</td>
                  <td className="py-2 px-3 font-mono">
                    {site.gene_symbol ? (
                      <button
                        type="button"
                        onClick={() => onInspectGene(site.gene_symbol!)}
                        className="text-cyan-700 dark:text-cyan-400 hover:underline"
                      >
                        {site.gene_symbol}
                      </button>
                    ) : (
                      <span className="text-slate-400">Intergenic</span>
                    )}
                  </td>
                  <td className="py-2 px-4 font-mono tabular-nums text-right text-slate-700 dark:text-slate-300">
                    {site.mismatch_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TactileCard>

      {/* Add Guide Modal */}
      {showGuideModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-lg bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-lg p-6"
          >
            <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100">
                Register Guide RNA
              </h3>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="p-2 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateGuide} className="mt-4 space-y-4">
              {guideError && (
                <div className="p-3 border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 rounded-md text-xs text-rose-700 dark:text-rose-300">
                  {guideError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Guide Name
                  </label>
                  <input
                    type="text"
                    required
                    value={guideName}
                    onChange={(e) => setGuideName(e.target.value)}
                    placeholder="sg_BRCA1_2"
                    className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Target Gene
                  </label>
                  <select
                    value={targetGeneId}
                    onChange={(e) => setTargetGeneId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                  >
                    {reference?.genes.map((gn) => (
                      <option key={gn.gene_id} value={gn.gene_id}>
                        {gn.gene_symbol} ({gn.scientific_name})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  20-nt Spacer Sequence (A, C, G, T only)
                </label>
                <input
                  type="text"
                  required
                  minLength={20}
                  maxLength={20}
                  value={spacerSeq}
                  onChange={(e) => setSpacerSeq(e.target.value.toUpperCase())}
                  placeholder="GAGTCCGAGCAGAAGAAGAA"
                  className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    PAM Motif
                  </label>
                  <input
                    type="text"
                    required
                    value={pamSeq}
                    onChange={(e) => setPamSeq(e.target.value.toUpperCase())}
                    placeholder="NGG"
                    className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    On-Target Score (0–100)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    required
                    value={onTargetScore}
                    onChange={(e) => setOnTargetScore(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                <TactileButton
                  onClick={() => setShowGuideModal(false)}
                  className="btn-3d-secondary px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-[#101622] border border-slate-300 dark:border-slate-700 rounded-md"
                >
                  Cancel
                </TactileButton>
                <TactileButton
                  type="submit"
                  disabled={savingGuide}
                  className="btn-3d-primary px-4 py-2 text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-500 rounded-md"
                >
                  {savingGuide ? 'Saving...' : 'Save Guide RNA'}
                </TactileButton>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Add Off-Target Site Modal */}
      {showSiteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-lg bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-lg p-6"
          >
            <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100">
                Add Predicted Off-Target Site
              </h3>
              <button
                type="button"
                onClick={() => setShowSiteModal(false)}
                className="p-2 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSite} className="mt-4 space-y-4">
              {siteError && (
                <div className="p-3 border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 rounded-md text-xs text-rose-700 dark:text-rose-300">
                  {siteError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Guide RNA
                </label>
                <select
                  value={siteGuideId}
                  onChange={(e) => setSiteGuideId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                >
                  {guides.map((g) => (
                    <option key={g.guide_id} value={g.guide_id}>
                      {g.guide_name} ({g.target_gene})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Chromosome
                  </label>
                  <input
                    type="text"
                    required
                    value={chromosome}
                    onChange={(e) => setChromosome(e.target.value)}
                    placeholder="17"
                    className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Genomic Position
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Mismatches (1–5)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="5"
                    required
                    value={mismatchCount}
                    onChange={(e) => setMismatchCount(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Region Type
                  </label>
                  <select
                    value={regionType}
                    onChange={(e) =>
                      setRegionType(e.target.value as 'exon' | 'intron' | 'intergenic')
                    }
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                  >
                    <option value="exon">exon</option>
                    <option value="intron">intron</option>
                    <option value="intergenic">intergenic</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Overlapping Gene
                  </label>
                  <select
                    disabled={regionType === 'intergenic'}
                    value={regionType === 'intergenic' ? '' : siteGeneId}
                    onChange={(e) => setSiteGeneId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md disabled:opacity-50"
                  >
                    <option value="">None</option>
                    {reference?.genes.map((gn) => (
                      <option key={gn.gene_id} value={gn.gene_id}>
                        {gn.gene_symbol}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                <TactileButton
                  onClick={() => setShowSiteModal(false)}
                  className="btn-3d-secondary px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-[#101622] border border-slate-300 dark:border-slate-700 rounded-md"
                >
                  Cancel
                </TactileButton>
                <TactileButton
                  type="submit"
                  disabled={savingSite}
                  className="btn-3d-primary px-4 py-2 text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-500 rounded-md"
                >
                  {savingSite ? 'Adding...' : 'Add Site'}
                </TactileButton>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
