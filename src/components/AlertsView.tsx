import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { motion } from 'motion/react';
import { apiRequest } from '../lib/api';
import { TactileCard } from './Tactile3D';
import { LabLoader } from './TelemetryCharts';
import type { AlertsResponse } from '../types';

interface AlertsViewProps {
  token: string;
  onInspectGene: (symbol: string) => void;
}

export function AlertsView({ token, onInspectGene }: AlertsViewProps) {
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<AlertsResponse>('/api/alerts', { token });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load alerts and audit checks.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  if (loading) {
    return <LabLoader label="Auditing alert logs and relational integrity..." />;
  }

  if (error || !data) {
    return (
      <div className="p-4 border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 rounded-lg text-sm text-rose-700 dark:text-rose-300">
        {error || 'Unable to load alert log.'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Integrity Audit Banner */}
      <TactileCard
        intensity="subtle"
        className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg p-5 flex flex-wrap items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3">
          {data.integrityOrphanEvents === 0 ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          ) : (
            <ShieldAlert className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
          )}
          <div>
            <div className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
              Experiment-Guide Cross-Check Integrity
            </div>
            <p className="text-[13px] text-slate-500 dark:text-slate-400">
              Verifies every recorded mutation event maps to an off-target site whose guide RNA was used in that sample’s experiment.
            </p>
          </div>
        </div>
        <div
          className={`font-mono tabular-nums text-[13px] font-semibold ${
            data.integrityOrphanEvents === 0
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-rose-600 dark:text-rose-400'
          }`}
        >
          {data.integrityOrphanEvents === 0
            ? '● 0 Orphan Events Verified'
            : `▲ ${data.integrityOrphanEvents} Integrity Anomalies`}
        </div>
      </TactileCard>

      {/* Automated Trigger Alert Log + High-Risk View */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TactileCard
          intensity="panel"
          className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
                Automated Trigger Alert Log
              </h2>
              <p className="text-[13px] text-slate-500 dark:text-slate-400">
                Populated automatically when allele frequency ≥ 5.0%
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-rose-600 dark:text-rose-400 font-semibold">
              {data.alertLogs.length} alerts
            </span>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {data.alertLogs.length === 0 ? (
              <div className="p-6 text-xs text-slate-500">No high-frequency alerts recorded yet.</div>
            ) : (
              data.alertLogs.map((al) => (
                <div key={al.alert_id} className="p-4 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono font-semibold text-rose-600 dark:text-rose-400">
                      ▲ {al.sample_code} · {Number(al.allele_freq).toFixed(2)}%
                    </span>
                    <span className="text-[11px] font-mono tabular-nums text-slate-400">
                      Alert #{al.alert_id}
                    </span>
                  </div>
                  <p className="text-[13px] text-slate-800 dark:text-slate-200">{al.message}</p>
                  <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                    {al.experiment} · {al.guide_name}
                    {al.hit_gene ? ` · ${al.hit_gene}` : ''}
                  </div>
                </div>
              ))
            )}
          </div>
        </TactileCard>

        <TactileCard
          intensity="panel"
          className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
                High-Risk Mutation Events
              </h2>
              <p className="text-[13px] text-slate-500 dark:text-slate-400">
                Frequency ≥ 5% or exonic hits in tumor suppressors / oncogenes
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {data.highRiskEvents.length} events
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#06080D] text-slate-500 dark:text-slate-400">
                  <th className="py-2 px-4">Sample</th>
                  <th className="py-2 px-3">Gene</th>
                  <th className="py-2 px-3">Region</th>
                  <th className="py-2 px-3">Type</th>
                  <th className="py-2 px-4 text-right">Freq</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {data.highRiskEvents.map((ev) => {
                  const pct = Math.min(100, (Number(ev.allele_freq) / 10) * 100);
                  return (
                    <tr key={ev.event_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 font-mono font-medium text-slate-900 dark:text-slate-100">
                        {ev.sample_code}
                      </td>
                      <td className="py-2.5 px-3 font-mono">
                        {ev.hit_gene ? (
                          <button
                            type="button"
                            onClick={() => onInspectGene(ev.hit_gene!)}
                            className="text-cyan-700 dark:text-cyan-400 hover:underline"
                          >
                            {ev.hit_gene}
                          </button>
                        ) : (
                          'Intergenic'
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{ev.region_type}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300">
                        {ev.mutation_type}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-right">
                        <div className="inline-flex flex-col items-end gap-1">
                          <span className="font-semibold text-rose-600 dark:text-rose-400">
                            {Number(ev.allele_freq).toFixed(2)}%
                          </span>
                          <div className="w-14 h-1 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                            <motion.div
                              initial={{ scaleX: 0 }}
                              animate={{ scaleX: 1 }}
                              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                              style={{ width: `${Math.max(10, pct)}%`, transformOrigin: 'left' }}
                              className="h-full bg-rose-500"
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TactileCard>
      </div>

      {/* Tumor-Suppressor Hits + Mutation-Free Clean Clones */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TactileCard
          intensity="panel"
          className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
              Samples With Tumor-Suppressor or Oncogene Off-Targets
            </h3>
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {data.tumorSuppressorSamples.map((s) => (
              <div key={s.sample_code} className="px-4 py-2.5 flex items-center justify-between gap-4 text-[13px]">
                <div>
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {s.sample_code}
                  </span>
                  <span className="ml-2 text-slate-500 dark:text-slate-400">
                    {s.cell_line} · Gen {s.generation}
                  </span>
                </div>
                <span className="text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
                  {s.notes ?? s.status}
                </span>
              </div>
            ))}
          </div>
        </TactileCard>

        <TactileCard
          intensity="panel"
          className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
              Clean Samples (Zero Off-Target Mutations Recorded)
            </h3>
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {data.cleanSamples.map((s) => (
              <div key={s.sample_code} className="px-4 py-2.5 flex items-center justify-between gap-4 text-[13px]">
                <div>
                  <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                    {s.sample_code}
                  </span>
                  <span className="ml-2 text-slate-500 dark:text-slate-400">
                    {s.cell_line} · Gen {s.generation}
                  </span>
                </div>
                <span className="text-slate-500 dark:text-slate-400">{s.experiment_title}</span>
              </div>
            ))}
          </div>
        </TactileCard>
      </div>
    </div>
  );
}
