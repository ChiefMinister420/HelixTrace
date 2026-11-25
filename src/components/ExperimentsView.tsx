import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { motion } from 'motion/react';
import { apiRequest } from '../lib/api';
import { TactileButton, TactileCard } from './Tactile3D';
import { AnimatedMismatchChart, LabLoader } from './TelemetryCharts';
import type { DashboardData, ExperimentSummary, GuideRnaRecord, ReferenceCatalog } from '../types';

interface ExperimentsViewProps {
  token: string;
  reference: ReferenceCatalog | null;
  dashboard: DashboardData | null;
  onDataChanged: () => void;
}

interface GuideLink {
  experiment_id: number;
  guide_id: number;
  guide_name: string;
  gene_symbol: string;
}

export function ExperimentsView({ token, reference, dashboard, onDataChanged }: ExperimentsViewProps) {
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [guideLinks, setGuideLinks] = useState<GuideLink[]>([]);
  const [guides, setGuides] = useState<GuideRnaRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create Experiment Modal
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [researcherId, setResearcherId] = useState('1');
  const [casId, setCasId] = useState('1');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedGuideIds, setSelectedGuideIds] = useState<number[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const loadExperiments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [expRes, guideRes] = await Promise.all([
        apiRequest<{ experiments: ExperimentSummary[]; guideLinks: GuideLink[] }>('/api/experiments', {
          token,
        }),
        apiRequest<{ guides: GuideRnaRecord[] }>('/api/guides', { token }),
      ]);
      setExperiments(expRes.experiments);
      setGuideLinks(expRes.guideLinks);
      setGuides(guideRes.guides);
      if (guideRes.guides.length > 0 && selectedGuideIds.length === 0) {
        setSelectedGuideIds([guideRes.guides[0].guide_id]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load experiments.');
    } finally {
      setLoading(false);
    }
  }, [token, selectedGuideIds.length]);

  useEffect(() => {
    loadExperiments();
  }, [loadExperiments]);

  const toggleGuide = (id: number) => {
    setSelectedGuideIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      await apiRequest('/api/experiments', {
        method: 'POST',
        token,
        body: {
          title,
          researcherId: Number(researcherId),
          casId: Number(casId),
          startDate,
          guideIds: selectedGuideIds,
        },
      });
      setShowCreate(false);
      setTitle('');
      await loadExperiments();
      onDataChanged();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create experiment.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header action bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-[15px] text-slate-600 dark:text-slate-400">
          Compare editing runs across Cas9 variants, researchers, and guide RNA mismatch profiles.
        </p>
        <TactileButton
          onClick={() => {
            setCreateError(null);
            setShowCreate(true);
          }}
          className="btn-3d-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-500 rounded-md whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>New Experiment</span>
        </TactileButton>
      </div>

      {error && (
        <div className="p-4 border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 rounded-lg text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Scientific Analytics Grid: Cas9 Fidelity Comparison + Animated Mismatch Decay Curve */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TactileCard
          intensity="panel"
          className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg p-5 space-y-4"
        >
          <div>
            <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
              Cas9 Variant Fidelity Benchmark
            </h2>
            <p className="text-[13px] text-slate-500 dark:text-slate-400">
              Off-target mutation count and mean allele frequency by Cas9 fidelity class
            </p>
          </div>

          <div className="space-y-4 pt-1">
            {(dashboard?.fidelityStats ?? []).map((item, idx) => {
              const barPct = Math.min(100, (Number(item.avg_freq) / 5) * 100);
              return (
                <div key={item.fidelity} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {item.fidelity} Fidelity Cas9
                    </span>
                    <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {item.mutations} events · {Number(item.avg_freq).toFixed(2)}% avg ·{' '}
                      {Number(item.max_freq).toFixed(2)}% max
                    </span>
                  </div>
                  <div className="h-2.5 w-full bg-slate-100 dark:bg-[#06080D] border border-slate-200 dark:border-slate-800 rounded-sm overflow-hidden">
                    <motion.div
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{
                        duration: 0.65,
                        delay: idx * 0.1,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                      className={`h-full ${
                        item.fidelity === 'High'
                          ? 'bg-emerald-600 dark:bg-emerald-500'
                          : 'bg-cyan-700 dark:bg-cyan-500'
                      }`}
                      style={{ width: `${Math.max(4, barPct)}%`, transformOrigin: 'left' }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
            <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
              Mutation Type Breakdown
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(dashboard?.mutationDistribution ?? []).map((dist) => (
                <motion.div
                  key={dist.mutation_type}
                  whileHover={{ y: -2, scale: 1.03, rotateX: 3 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  style={{ transformPerspective: 700 }}
                  className="p-2.5 border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#06080D] rounded-md"
                >
                  <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                    {dist.mutation_type}
                  </div>
                  <div className="mt-1 text-xl font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                    {dist.cnt}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {Number(dist.avg_freq).toFixed(2)}% avg
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </TactileCard>

        <TactileCard
          intensity="panel"
          className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg p-5"
        >
          <AnimatedMismatchChart points={dashboard?.mismatchStats ?? []} />
        </TactileCard>
      </div>

      {/* Experiments Summary Table */}
      <TactileCard
        intensity="panel"
        interactiveScale={false}
        className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
            Experiment Summary Ledger
          </h2>
          <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {experiments.length} protocols
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#06080D] text-xs font-medium text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-4">Experiment</th>
                <th className="py-2.5 px-3">Researcher &amp; Lab</th>
                <th className="py-2.5 px-3">Cas Variant</th>
                <th className="py-2.5 px-3">Linked Guide RNAs</th>
                <th className="py-2.5 px-3 text-right">Samples</th>
                <th className="py-2.5 px-3 text-right">Mutations</th>
                <th className="py-2.5 px-3 text-right">Avg Freq</th>
                <th className="py-2.5 px-4 text-right">Max Freq</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-6 px-4">
                    <LabLoader label="Loading experiment ledger..." />
                  </td>
                </tr>
              ) : (
                experiments.map((exp) => {
                  const linked = guideLinks.filter((gl) => gl.experiment_id === exp.experiment_id);
                  return (
                    <tr
                      key={exp.experiment_id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {exp.title}
                        </div>
                        <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                          Started {exp.start_date}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-700 dark:text-slate-300">
                        <div>{exp.researcher}</div>
                        <div className="text-slate-500 dark:text-slate-400">{exp.lab_name}</div>
                      </td>
                      <td className="py-3 px-3 text-xs">
                        <span className="font-mono font-medium text-slate-900 dark:text-slate-100">
                          {exp.cas_variant}
                        </span>
                        <span className="ml-1.5 text-slate-500 dark:text-slate-400">
                          · {exp.fidelity}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-xs font-mono text-slate-600 dark:text-slate-300">
                        {linked.map((g) => `${g.guide_name} (${g.gene_symbol})`).join(', ') || 'None'}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300">
                        {exp.total_samples}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300">
                        {exp.total_mutations}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300">
                        {Number(exp.avg_freq).toFixed(2)}%
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-mono tabular-nums text-xs font-semibold ${
                          Number(exp.max_freq) >= 5
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {Number(exp.max_freq).toFixed(2)}%
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </TactileCard>

      {/* Create Experiment Modal */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-exp-title"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-lg bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-lg p-6"
          >
            <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
              <h3
                id="new-exp-title"
                className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100"
              >
                Create CRISPR Experiment
              </h3>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="p-2 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="mt-4 space-y-4">
              {createError && (
                <div className="p-3 border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 rounded-md text-xs text-rose-700 dark:text-rose-300">
                  {createError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Experiment Title
                </label>
                <input
                  type="text"
                  required
                  minLength={3}
                  maxLength={80}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="BRCA1 high-fidelity screen in iPSCs"
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Lead Researcher
                  </label>
                  <select
                    value={researcherId}
                    onChange={(e) => setResearcherId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                  >
                    {reference?.researchers.map((r) => (
                      <option key={r.researcher_id} value={r.researcher_id}>
                        {r.full_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Cas Variant
                  </label>
                  <select
                    value={casId}
                    onChange={(e) => setCasId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                  >
                    {reference?.casVariants.map((c) => (
                      <option key={c.cas_id} value={c.cas_id}>
                        {c.variant_name} ({c.fidelity})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
              </div>

              <div>
                <div className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Assigned Guide RNAs (M:N experiment_guide mapping)
                </div>
                <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto p-2 border border-slate-200 dark:border-slate-800 rounded-md">
                  {guides.map((g) => (
                    <label
                      key={g.guide_id}
                      className="flex items-center gap-2 text-xs font-mono text-slate-700 dark:text-slate-300 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedGuideIds.includes(g.guide_id)}
                        onChange={() => toggleGuide(g.guide_id)}
                        className="rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                      />
                      <span>
                        {g.guide_name} ({g.target_gene})
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                <TactileButton
                  onClick={() => setShowCreate(false)}
                  className="btn-3d-secondary px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-[#101622] border border-slate-300 dark:border-slate-700 rounded-md"
                >
                  Cancel
                </TactileButton>
                <TactileButton
                  type="submit"
                  disabled={creating}
                  className="btn-3d-primary px-4 py-2 text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-500 rounded-md"
                >
                  {creating ? 'Creating...' : 'Create Experiment'}
                </TactileButton>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
