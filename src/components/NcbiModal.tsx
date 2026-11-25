import { useEffect, useState } from 'react';
import { Dna, ExternalLink, X } from 'lucide-react';
import { motion } from 'motion/react';
import { apiRequest } from '../lib/api';
import { LabLoader } from './TelemetryCharts';
import type { NcbiAnnotation } from '../types';

interface NcbiModalProps {
  symbol: string | null;
  organism?: string;
  token: string;
  onClose: () => void;
}

export function NcbiModal({ symbol, organism = 'Homo sapiens', token, onClose }: NcbiModalProps) {
  const [data, setData] = useState<NcbiAnnotation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    apiRequest<{ annotation: NcbiAnnotation }>(
      `/api/genes/${encodeURIComponent(symbol)}/ncbi?organism=${encodeURIComponent(organism)}`,
      { token },
    )
      .then((res) => {
        if (!cancelled) setData(res.annotation);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to fetch NCBI gene record.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [symbol, organism, token]);

  if (!symbol) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ncbi-modal-title"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-xl bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-lg p-6"
      >
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <p className="text-[13px] font-medium text-cyan-700 dark:text-cyan-400">
              Genomic Reference Lookup
            </p>
            <h2
              id="ncbi-modal-title"
              className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100 font-mono text-3d-relief"
            >
              {symbol}
            </h2>
          </div>
          <motion.button
            type="button"
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            onClick={onClose}
            className="p-2 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Close gene annotation modal"
          >
            <X className="w-4 h-4" />
          </motion.button>
        </div>

        <div className="py-5 space-y-4">
          {loading && <LabLoader label={`Querying NCBI Entrez for ${symbol}...`} />}

          {error && (
            <div className="p-3 border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 rounded-md text-sm text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}

          {data && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">NCBI Gene ID</div>
                  <div className="mt-1 text-sm font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                    {data.ncbiGeneId ?? 'Unassigned'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Chromosome</div>
                  <div className="mt-1 text-sm font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                    chr{data.chromosome}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Cytogenetic Band</div>
                  <div className="mt-1 text-sm font-mono font-medium text-slate-900 dark:text-slate-100">
                    {data.mapLocation ?? 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Organism</div>
                  <div className="mt-1 text-sm italic text-slate-900 dark:text-slate-100">
                    {data.organism}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Official Gene Name</div>
                <div className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                  {data.officialName}
                </div>
              </div>

              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Functional Summary</div>
                <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                  {data.summary}
                </p>
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                <div className="flex items-center gap-2">
                  <Dna className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                  <span>
                    Source: {data.source === 'ncbi_live' ? 'NCBI Entrez E-utilities' : 'Curated Local Reference'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    NCBI API Key: {data.apiKeyConfigured ? 'Configured on server' : 'Not configured (standard rate limit)'}
                  </span>
                </div>
                {data.ncbiGeneId && (
                  <a
                    href={`https://www.ncbi.nlm.nih.gov/gene/${data.ncbiGeneId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-cyan-700 dark:text-cyan-400 hover:underline font-medium"
                  >
                    NCBI Record
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
