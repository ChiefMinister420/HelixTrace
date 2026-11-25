import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { ChevronRight, GitBranch, Plus, Trash2, X } from 'lucide-react';
import { motion } from 'motion/react';
import { apiRequest } from '../lib/api';
import { TactileButton, TactileCard } from './Tactile3D';
import { AnimatedNumber, LabLoader } from './TelemetryCharts';
import type { DashboardData, ReferenceCatalog, SampleNode, SampleTrace, User } from '../types';

interface LineageViewProps {
  token: string;
  user: User;
  reference: ReferenceCatalog | null;
  dashboard: DashboardData | null;
  onDataChanged: () => void;
}

interface PositionedNode {
  node: SampleNode;
  x: number;
  y: number;
}

function statusGlyph(status: SampleNode['status']) {
  if (status === 'active') return { glyph: '●', cls: 'text-emerald-600 dark:text-emerald-400', label: 'Active' };
  if (status === 'frozen') return { glyph: '◆', cls: 'text-cyan-700 dark:text-cyan-400', label: 'Frozen' };
  return { glyph: '×', cls: 'text-slate-500 dark:text-slate-400', label: 'Discarded' };
}

export function LineageView({ token, user, reference, dashboard, onDataChanged }: LineageViewProps) {
  const [nodes, setNodes] = useState<SampleNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [experimentFilter, setExperimentFilter] = useState<string>('all');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [trace, setTrace] = useState<SampleTrace | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);

  const [editStatus, setEditStatus] = useState<'active' | 'frozen' | 'discarded'>('active');
  const [editNotes, setEditNotes] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editMessage, setEditMessage] = useState<string | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [sampleCode, setSampleCode] = useState('');
  const [cellLine, setCellLine] = useState('HEK293');
  const [organismId, setOrganismId] = useState('1');
  const [experimentId, setExperimentId] = useState('1');
  const [parentSampleId, setParentSampleId] = useState<string>('');
  const [createdDate, setCreatedDate] = useState(new Date().toISOString().slice(0, 10));
  const [newStatus, setNewStatus] = useState<'active' | 'frozen' | 'discarded'>('active');
  const [newNotes, setNewNotes] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const loadLineage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = experimentFilter !== 'all' ? `?experimentId=${encodeURIComponent(experimentFilter)}` : '';
      const res = await apiRequest<{ nodes: SampleNode[] }>(`/api/lineage${qs}`, { token });
      setNodes(res.nodes);
      if (res.nodes.length > 0 && (!selectedCode || !res.nodes.some((n) => n.sample_code === selectedCode))) {
        const defaultNode = res.nodes.find((n) => n.sample_code === 'HEK-C1-A1') ?? res.nodes[0];
        setSelectedCode(defaultNode.sample_code);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load lineage tree.');
    } finally {
      setLoading(false);
    }
  }, [token, experimentFilter, selectedCode]);

  useEffect(() => {
    loadLineage();
  }, [loadLineage]);

  useEffect(() => {
    if (!selectedCode) {
      setTrace(null);
      return;
    }
    let cancelled = false;
    setTraceLoading(true);
    setEditMessage(null);

    apiRequest<SampleTrace>(`/api/lineage/${encodeURIComponent(selectedCode)}/trace`, { token })
      .then((res) => {
        if (!cancelled) {
          setTrace(res);
          setEditStatus(res.sample.status);
          setEditNotes(res.sample.notes ?? '');
        }
      })
      .catch(() => {
        if (!cancelled) setTrace(null);
      })
      .finally(() => {
        if (!cancelled) setTraceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedCode, token]);

  const ancestorIds = useMemo(() => {
    return new Set((trace?.ancestors ?? []).map((a) => a.sample_id));
  }, [trace]);

  const treeLayout = useMemo(() => {
    const byId = new Map<number, SampleNode>();
    const childrenMap = new Map<number | null, SampleNode[]>();
    for (const node of nodes) {
      byId.set(node.sample_id, node);
      const pid = node.parent_sample_id;
      const list = childrenMap.get(pid ?? null) ?? [];
      list.push(node);
      childrenMap.set(pid ?? null, list);
    }

    const roots = nodes.filter(
      (n) => n.parent_sample_id === null || !byId.has(n.parent_sample_id),
    );

    const colWidth = 236;
    const rowHeight = 104;
    const cardWidth = 196;
    const cardHeight = 82;

    const positioned: PositionedNode[] = [];
    const edges: Array<{ from: PositionedNode; to: PositionedNode }> = [];
    let currentRow = 0;

    const assignPositions = (node: SampleNode, depth: number): PositionedNode => {
      const kids = childrenMap.get(node.sample_id) ?? [];
      if (kids.length === 0) {
        const pNode: PositionedNode = {
          node,
          x: depth * colWidth + 16,
          y: currentRow * rowHeight + 16,
        };
        currentRow += 1;
        positioned.push(pNode);
        return pNode;
      }

      const childPositions = kids.map((kid) => assignPositions(kid, depth + 1));
      const minY = Math.min(...childPositions.map((c) => c.y));
      const maxY = Math.max(...childPositions.map((c) => c.y));
      const pNode: PositionedNode = {
        node,
        x: depth * colWidth + 16,
        y: (minY + maxY) / 2,
      };
      positioned.push(pNode);
      for (const cp of childPositions) {
        edges.push({ from: pNode, to: cp });
      }
      return pNode;
    };

    for (const root of roots) {
      assignPositions(root, 0);
    }

    const maxX = positioned.length > 0 ? Math.max(...positioned.map((p) => p.x)) + cardWidth + 24 : 600;
    const maxY = positioned.length > 0 ? Math.max(...positioned.map((p) => p.y)) + cardHeight + 24 : 240;
    const maxGen = nodes.length > 0 ? Math.max(...nodes.map((n) => n.generation)) : 0;

    return { positioned, edges, width: maxX, height: maxY, cardWidth, cardHeight, maxGen, colWidth };
  }, [nodes]);

  const handleSaveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!trace) return;
    setSavingEdit(true);
    setEditMessage(null);
    try {
      await apiRequest(`/api/samples/${trace.sample.sample_id}`, {
        method: 'PATCH',
        token,
        body: { status: editStatus, notes: editNotes },
      });
      setEditMessage('Sample record updated.');
      await loadLineage();
      onDataChanged();
    } catch (err) {
      setEditMessage(err instanceof Error ? err.message : 'Update failed.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteLeaf = async () => {
    if (!trace) return;
    setEditMessage(null);
    try {
      await apiRequest(`/api/samples/${trace.sample.sample_id}`, {
        method: 'DELETE',
        token,
      });
      setSelectedCode(null);
      await loadLineage();
      onDataChanged();
    } catch (err) {
      setEditMessage(err instanceof Error ? err.message : 'Unable to delete sample.');
    }
  };

  const openSubcloneModal = (parentNode?: SampleNode) => {
    setCreateError(null);
    if (parentNode) {
      setParentSampleId(String(parentNode.sample_id));
      setCellLine(parentNode.cell_line);
      setOrganismId(String(parentNode.organism_id));
      setExperimentId(String(parentNode.experiment_id));
      setSampleCode(`${parentNode.sample_code}-S1`);
    } else {
      setParentSampleId('');
      setSampleCode('');
    }
    setShowCreateModal(true);
  };

  const handleCreateSample = async (e: FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const res = await apiRequest<{ sample: { sample_code: string } }>('/api/samples', {
        method: 'POST',
        token,
        body: {
          sampleCode,
          cellLine,
          organismId: Number(organismId),
          experimentId: Number(experimentId),
          parentSampleId: parentSampleId ? Number(parentSampleId) : null,
          createdDate,
          status: newStatus,
          notes: newNotes,
        },
      });
      setShowCreateModal(false);
      setSelectedCode(res.sample.sample_code);
      await loadLineage();
      onDataChanged();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create sample.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 4-column summary KPI bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <TactileCard
          intensity="compact"
          className="p-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg"
        >
          <div className="text-[13px] font-medium text-slate-500 dark:text-slate-400">Tracked Cell Samples</div>
          <div className="mt-1 text-3xl font-mono font-semibold text-slate-900 dark:text-slate-100 text-3d-relief">
            <AnimatedNumber value={dashboard?.totals.samples ?? nodes.length} />
          </div>
        </TactileCard>
        <TactileCard
          intensity="compact"
          className="p-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg"
        >
          <div className="text-[13px] font-medium text-slate-500 dark:text-slate-400">Off-Target Events</div>
          <div className="mt-1 text-3xl font-mono font-semibold text-cyan-700 dark:text-cyan-400 text-3d-relief">
            <AnimatedNumber value={dashboard?.totals.mutations ?? 0} />
          </div>
        </TactileCard>
        <TactileCard
          intensity="compact"
          className="p-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg"
        >
          <div className="text-[13px] font-medium text-slate-500 dark:text-slate-400">High-Risk Events</div>
          <div className="mt-1 text-3xl font-mono font-semibold text-rose-600 dark:text-rose-400 text-3d-relief">
            <AnimatedNumber value={dashboard?.totals.high_risk ?? 0} />
          </div>
        </TactileCard>
        <TactileCard
          intensity="compact"
          className="p-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg"
        >
          <div className="text-[13px] font-medium text-slate-500 dark:text-slate-400">Trigger Alerts Logged</div>
          <div className="mt-1 text-3xl font-mono font-semibold text-amber-600 dark:text-amber-400 text-3d-relief">
            <AnimatedNumber value={dashboard?.totals.alerts ?? 0} />
          </div>
        </TactileCard>
      </div>

      {/* Controls bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="lineage-exp-filter" className="text-[13px] font-medium text-slate-600 dark:text-slate-400">
            Experiment Filter
          </label>
          <select
            id="lineage-exp-filter"
            value={experimentFilter}
            onChange={(e) => setExperimentFilter(e.target.value)}
            className="px-3 py-2 text-sm bg-white dark:bg-[#0B0F17] border border-slate-300 dark:border-slate-700 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-500"
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
          onClick={() => openSubcloneModal()}
          className="btn-3d-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-500 rounded-md whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>New Sample</span>
        </TactileButton>
      </div>

      {error && (
        <div className="p-4 border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 rounded-lg text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Main split: Lineage Tree Viewport + Ancestry/Descendant Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <TactileCard
          intensity="panel"
          interactiveScale={false}
          className="xl:col-span-8 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-cyan-700 dark:text-cyan-400" />
              <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
                Cell-Line Inheritance Tree
              </h2>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Click any clone node to trace ancestors and inherited mutations
            </span>
          </div>

          {loading ? (
            <LabLoader label="Tracing recursive cell-line branches..." />
          ) : nodes.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                No cell-line samples match the selected experiment filter.
              </p>
              <TactileButton
                onClick={() => openSubcloneModal()}
                className="btn-3d-primary px-4 py-2 text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-500 rounded-md"
              >
                Create First Sample
              </TactileButton>
            </div>
          ) : (
            <div className="overflow-x-auto p-4 bg-slate-50/70 dark:bg-[#06080D] lab-grid-surface">
              <div
                className="relative"
                style={{ width: `${treeLayout.width}px`, height: `${treeLayout.height + 28}px` }}
              >
                {Array.from({ length: treeLayout.maxGen + 1 }).map((_, genIdx) => (
                  <div
                    key={genIdx}
                    className="absolute top-0 text-xs font-mono text-slate-500 dark:text-slate-400"
                    style={{ left: `${genIdx * treeLayout.colWidth + 16}px` }}
                  >
                    Generation {genIdx}
                  </div>
                ))}

                {/* Animated SVG Inheritance Connectors */}
                <svg
                  className="absolute top-6 left-0 pointer-events-none"
                  width={treeLayout.width}
                  height={treeLayout.height}
                >
                  {treeLayout.edges.map(({ from, to }, idx) => {
                    const x1 = from.x + treeLayout.cardWidth;
                    const y1 = from.y + treeLayout.cardHeight / 2;
                    const x2 = to.x;
                    const y2 = to.y + treeLayout.cardHeight / 2;
                    const midX = (x1 + x2) / 2;
                    const isActiveBranch =
                      ancestorIds.has(from.node.sample_id) && ancestorIds.has(to.node.sample_id);
                    return (
                      <motion.path
                        key={`${from.node.sample_id}-${to.node.sample_id}`}
                        d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                        fill="none"
                        stroke={isActiveBranch ? '#06B6D4' : 'currentColor'}
                        strokeWidth={isActiveBranch ? 2.2 : 1.4}
                        initial={{ pathLength: 0, opacity: 0.4 }}
                        animate={{ pathLength: 1, opacity: 1 }}
                        transition={{ duration: 0.45, delay: idx * 0.03, ease: [0.16, 1, 0.3, 1] }}
                        className={isActiveBranch ? '' : 'text-slate-300 dark:text-slate-700'}
                      />
                    );
                  })}
                </svg>

                {/* Sample Nodes */}
                <div className="absolute top-6 left-0 w-full h-full">
                  {treeLayout.positioned.map(({ node, x, y }) => {
                    const isSelected = node.sample_code === selectedCode;
                    const st = statusGlyph(node.status);
                    const hasHighRisk = Number(node.high_risk_count) > 0;
                    return (
                      <motion.button
                        key={node.sample_id}
                        type="button"
                        onClick={() => setSelectedCode(node.sample_code)}
                        whileHover={{
                          scale: 1.035,
                          y: -3,
                          rotateX: 4,
                          transition: { duration: 0.16, ease: [0.16, 1, 0.3, 1] },
                        }}
                        whileTap={{ scale: 0.98, y: 1 }}
                        style={{
                          left: `${x}px`,
                          top: `${y}px`,
                          width: `${treeLayout.cardWidth}px`,
                          height: `${treeLayout.cardHeight}px`,
                          transformPerspective: 800,
                        }}
                        className={`plate-3d absolute text-left p-2.5 rounded-md border flex flex-col justify-between ${
                          isSelected
                            ? 'bg-cyan-50/95 dark:bg-cyan-950/45 border-cyan-600 dark:border-cyan-400 ring-1 ring-cyan-600 dark:ring-cyan-400'
                            : 'bg-white dark:bg-[#0B0F17] border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {node.sample_code}
                          </span>
                          <span className={`text-[11px] font-medium whitespace-nowrap shrink-0 ${st.cls}`}>
                            {st.glyph} {st.label}
                          </span>
                        </div>

                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {node.cell_line} · {node.cas_variant}
                        </div>

                        <div className="flex items-center justify-between text-[11px] font-mono tabular-nums pt-1 border-t border-slate-100 dark:border-slate-800">
                          <span className="text-slate-600 dark:text-slate-300">
                            {node.mutation_count} mut{Number(node.mutation_count) === 1 ? '' : 's'}
                          </span>
                          <span
                            className={
                              hasHighRisk
                                ? 'text-rose-600 dark:text-rose-400 font-semibold'
                                : 'text-slate-500 dark:text-slate-400'
                            }
                          >
                            {hasHighRisk ? '▲ ' : ''}
                            {Number(node.max_allele_freq).toFixed(2)}% max
                          </span>
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </TactileCard>

        {/* Right Ancestry & Descendant Trace Inspector */}
        <TactileCard
          intensity="panel"
          className="xl:col-span-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg p-5 space-y-5"
        >
          {!selectedCode || traceLoading ? (
            <LabLoader label="Walking recursive CTE trace..." />
          ) : trace ? (
            <>
              <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {trace.sample.cell_line} · Generation {trace.sample.generation}
                  </div>
                  <h3 className="mt-0.5 text-xl font-mono font-semibold text-slate-900 dark:text-slate-100 text-3d-relief">
                    {trace.sample.sample_code}
                  </h3>
                </div>
                <TactileButton
                  onClick={() => {
                    const matched = nodes.find((n) => n.sample_id === trace.sample.sample_id);
                    if (matched) openSubcloneModal(matched);
                  }}
                  className="btn-3d-secondary px-3 py-1.5 text-xs font-medium text-cyan-700 dark:text-cyan-300 bg-white dark:bg-[#101622] border border-cyan-600/40 dark:border-cyan-500/40 rounded-md whitespace-nowrap shrink-0"
                >
                  + Sub-clone
                </TactileButton>
              </div>

              {/* Ancestors & Inherited Mutations */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Ancestry Trace &amp; Inherited Mutations
                </h4>
                <div className="space-y-2">
                  {trace.ancestors.map((anc, idx) => (
                    <div
                      key={`${anc.sample_id}-${anc.event_id ?? 'none'}-${idx}`}
                      className="p-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#06080D] text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedCode(anc.sample_code)}
                          className="font-mono font-semibold text-slate-900 dark:text-slate-100 hover:text-cyan-700 dark:hover:text-cyan-400 inline-flex items-center gap-1"
                        >
                          <span>{anc.sample_code}</span>
                          <ChevronRight className="w-3 h-3" />
                        </button>
                        <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {anc.generations_back === 0
                            ? 'Selected'
                            : `-${anc.generations_back} gen`}
                        </span>
                      </div>
                      {anc.event_id ? (
                        <div className="mt-1.5 flex items-center justify-between text-[11px] font-mono tabular-nums">
                          <span className="text-slate-700 dark:text-slate-300">
                            {anc.guide_name} · {anc.hit_gene ?? `chr${anc.chromosome}`} ({anc.mutation_type})
                          </span>
                          <span
                            className={
                              Number(anc.allele_freq) >= 5
                                ? 'text-rose-600 dark:text-rose-400 font-semibold'
                                : 'text-slate-600 dark:text-slate-300'
                            }
                          >
                            {Number(anc.allele_freq).toFixed(2)}%
                          </span>
                        </div>
                      ) : (
                        <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                          No off-target mutations recorded at this node
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Descendants */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Descendant Sub-Clones ({Math.max(0, trace.descendants.length - 1)})
                </h4>
                {trace.descendants.length <= 1 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Leaf clone with no downstream sub-clones.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-md">
                    {trace.descendants
                      .filter((d) => d.depth > 0)
                      .map((desc) => (
                        <button
                          key={desc.sample_id}
                          type="button"
                          onClick={() => setSelectedCode(desc.sample_code)}
                          className="w-full px-3 py-2 flex items-center justify-between text-xs hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                        >
                          <span className="font-mono font-medium text-slate-900 dark:text-slate-100">
                            {desc.sample_code} · Gen {desc.generation}
                          </span>
                          <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                            {desc.mutations} mut · {Number(desc.max_freq).toFixed(2)}%
                          </span>
                        </button>
                      ))}
                  </div>
                )}
              </div>

              {/* Status & Notes Update Form */}
              <form onSubmit={handleSaveEdit} className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
                <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Sample Lifecycle &amp; Notes
                </h4>
                <div>
                  <label htmlFor="edit-sample-status" className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                    Storage Status
                  </label>
                  <select
                    id="edit-sample-status"
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as 'active' | 'frozen' | 'discarded')}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                  >
                    <option value="active">Active</option>
                    <option value="frozen">Frozen</option>
                    <option value="discarded">Discarded</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="edit-sample-notes" className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                    Lab Notes
                  </label>
                  <input
                    id="edit-sample-notes"
                    type="text"
                    maxLength={200}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="e.g., Needs re-sequencing"
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>

                {editMessage && (
                  <p className="text-xs text-cyan-700 dark:text-cyan-400">{editMessage}</p>
                )}

                <div className="flex items-center justify-between gap-2 pt-1">
                  <TactileButton
                    type="submit"
                    disabled={savingEdit}
                    className="btn-3d-primary px-4 py-2 text-[13px] font-medium text-white bg-cyan-600 hover:bg-cyan-500 rounded-md"
                  >
                    {savingEdit ? 'Saving...' : 'Save Changes'}
                  </TactileButton>

                  {user.role === 'admin' && trace.descendants.length <= 1 && (
                    <TactileButton
                      onClick={handleDeleteLeaf}
                      className="btn-3d-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-400 bg-white dark:bg-[#101622] border border-rose-200 dark:border-rose-900/50 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-md"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Leaf</span>
                    </TactileButton>
                  )}
                </div>
              </form>
            </>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Select a cell-line node from the tree to inspect its lineage.
            </p>
          )}
        </TactileCard>
      </div>

      {/* Create Sample Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-sample-title"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-lg bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-lg p-6"
          >
            <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h3 id="new-sample-title" className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100">
                  Register Cell-Line Sample
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Generation number is computed automatically from the parent sample via database trigger.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-2 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSample} className="mt-4 space-y-4">
              {createError && (
                <div className="p-3 border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 rounded-md text-xs text-rose-700 dark:text-rose-300">
                  {createError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Sample Code
                  </label>
                  <input
                    type="text"
                    required
                    value={sampleCode}
                    onChange={(e) => setSampleCode(e.target.value)}
                    placeholder="HEK-C1-A2"
                    className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Cell Line
                  </label>
                  <input
                    type="text"
                    required
                    value={cellLine}
                    onChange={(e) => setCellLine(e.target.value)}
                    placeholder="HEK293"
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Parent Sample (optional)
                  </label>
                  <select
                    value={parentSampleId}
                    onChange={(e) => setParentSampleId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                  >
                    <option value="">None (Founder Gen 0)</option>
                    {nodes.map((n) => (
                      <option key={n.sample_id} value={n.sample_id}>
                        {n.sample_code} (Gen {n.generation})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Experiment
                  </label>
                  <select
                    value={experimentId}
                    onChange={(e) => setExperimentId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                  >
                    {reference?.experiments.map((exp) => (
                      <option key={exp.experiment_id} value={exp.experiment_id}>
                        {exp.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Organism
                  </label>
                  <select
                    value={organismId}
                    onChange={(e) => setOrganismId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                  >
                    {reference?.organisms.map((org) => (
                      <option key={org.organism_id} value={org.organism_id}>
                        {org.common_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Created Date
                  </label>
                  <input
                    type="date"
                    value={createdDate}
                    onChange={(e) => setCreatedDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Status
                  </label>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value as 'active' | 'frozen' | 'discarded')}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                  >
                    <option value="active">Active</option>
                    <option value="frozen">Frozen</option>
                    <option value="discarded">Discarded</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Notes (optional)
                </label>
                <input
                  type="text"
                  maxLength={200}
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="Passage notes or sequencing queue reference"
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-[#06080D] border border-slate-300 dark:border-slate-700 rounded-md"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                <TactileButton
                  onClick={() => setShowCreateModal(false)}
                  className="btn-3d-secondary px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-[#101622] border border-slate-300 dark:border-slate-700 rounded-md"
                >
                  Cancel
                </TactileButton>
                <TactileButton
                  type="submit"
                  disabled={creating}
                  className="btn-3d-primary px-4 py-2 text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-500 rounded-md"
                >
                  {creating ? 'Creating...' : 'Create Sample'}
                </TactileButton>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
