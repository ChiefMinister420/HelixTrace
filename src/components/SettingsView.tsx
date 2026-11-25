import { useEffect, useState } from 'react';
import { Check, Copy, Database, Moon, Sun } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { TactileButton, TactileCard } from './Tactile3D';
import type { User } from '../types';

interface SettingsViewProps {
  user: User;
  isDark: boolean;
  onToggleTheme: () => void;
}

interface EntityNode {
  id: string;
  label: string;
  x: number;
  y: number;
  pk: string;
  fks: string[];
  role: string;
}

const ER_ENTITIES: EntityNode[] = [
  {
    id: 'LAB',
    label: 'lab',
    x: 20,
    y: 24,
    pk: 'lab_id',
    fks: [],
    role: 'Stores laboratory units and departments (3NF extraction from researcher).',
  },
  {
    id: 'RESEARCHER',
    label: 'researcher',
    x: 20,
    y: 122,
    pk: 'researcher_id',
    fks: ['lab_id → lab'],
    role: 'Scientists executing editing experiments within a lab.',
  },
  {
    id: 'CAS_VARIANT',
    label: 'cas_variant',
    x: 20,
    y: 224,
    pk: 'cas_id',
    fks: [],
    role: 'Cas nuclease variants (SpCas9, eSpCas9, SpCas9-HF1, SaCas9), PAM motifs, and fidelity tier.',
  },
  {
    id: 'ORGANISM',
    label: 'organism',
    x: 20,
    y: 326,
    pk: 'organism_id',
    fks: [],
    role: 'Reference species catalog (Human, Mouse, Zebrafish) normalized out of sample & gene.',
  },
  {
    id: 'EXPERIMENT',
    label: 'experiment',
    x: 245,
    y: 140,
    pk: 'experiment_id',
    fks: ['researcher_id → researcher', 'cas_id → cas_variant'],
    role: 'Tracks CRISPR protocol runs linking a researcher, Cas variant, and one or more guide RNAs.',
  },
  {
    id: 'EXPERIMENT_GUIDE',
    label: 'experiment_guide',
    x: 470,
    y: 52,
    pk: '(experiment_id, guide_id)',
    fks: ['experiment_id → experiment', 'guide_id → guide_rna'],
    role: 'M:N bridge table resolving multiple guide RNAs per experiment (1NF).',
  },
  {
    id: 'SAMPLE',
    label: 'sample',
    x: 245,
    y: 280,
    pk: 'sample_id',
    fks: ['organism_id → organism', 'experiment_id → experiment', 'parent_sample_id → sample (self)'],
    role: 'Self-referencing lineage table walked with recursive CTEs; generation auto-computed by trigger.',
  },
  {
    id: 'GENE',
    label: 'gene',
    x: 470,
    y: 344,
    pk: 'gene_id',
    fks: ['organism_id → organism'],
    role: 'Genomic loci classified as tumor_suppressor, oncogene, or other.',
  },
  {
    id: 'GUIDE_RNA',
    label: 'guide_rna',
    x: 695,
    y: 52,
    pk: 'guide_id',
    fks: ['target_gene_id → gene'],
    role: '20-nt spacer sequences, PAM motifs, and on-target efficiency scores (2NF).',
  },
  {
    id: 'OFF_TARGET_SITE',
    label: 'off_target_site',
    x: 695,
    y: 196,
    pk: 'site_id',
    fks: ['guide_id → guide_rna', 'gene_id → gene (nullable)'],
    role: 'Predicted off-target genomic loci (1–5 mismatches); gene_id is NULL for intergenic sites.',
  },
  {
    id: 'MUTATION_EVENT',
    label: 'mutation_event',
    x: 470,
    y: 214,
    pk: 'event_id',
    fks: ['sample_id → sample', 'site_id → off_target_site', 'method_id → detection_method'],
    role: 'Resolves M:N between sample and off_target_site with allele_freq, mutation_type, and date.',
  },
  {
    id: 'DETECTION_METHOD',
    label: 'detection_method',
    x: 695,
    y: 344,
    pk: 'method_id',
    fks: [],
    role: 'Sequencing or cleavage assay methods (GUIDE-seq, Digenome-seq, NGS, T7E1).',
  },
  {
    id: 'ALERT_LOG',
    label: 'alert_log',
    x: 470,
    y: 132,
    pk: 'alert_id',
    fks: ['event_id → mutation_event'],
    role: 'Automatically populated by AFTER INSERT trigger trg_high_freq_alert when allele_freq >= 5%.',
  },
];

const ER_EDGES: Array<{ from: string; to: string; card: string }> = [
  { from: 'LAB', to: 'RESEARCHER', card: '1:N' },
  { from: 'RESEARCHER', to: 'EXPERIMENT', card: '1:N' },
  { from: 'CAS_VARIANT', to: 'EXPERIMENT', card: '1:N' },
  { from: 'ORGANISM', to: 'SAMPLE', card: '1:N' },
  { from: 'ORGANISM', to: 'GENE', card: '1:N' },
  { from: 'EXPERIMENT', to: 'SAMPLE', card: '1:N' },
  { from: 'EXPERIMENT', to: 'EXPERIMENT_GUIDE', card: '1:N' },
  { from: 'GUIDE_RNA', to: 'EXPERIMENT_GUIDE', card: '1:N' },
  { from: 'GENE', to: 'GUIDE_RNA', card: '1:N' },
  { from: 'GUIDE_RNA', to: 'OFF_TARGET_SITE', card: '1:N' },
  { from: 'GENE', to: 'OFF_TARGET_SITE', card: '0..1:N' },
  { from: 'SAMPLE', to: 'MUTATION_EVENT', card: '1:N' },
  { from: 'OFF_TARGET_SITE', to: 'MUTATION_EVENT', card: '1:N' },
  { from: 'DETECTION_METHOD', to: 'MUTATION_EVENT', card: '1:N' },
  { from: 'MUTATION_EVENT', to: 'ALERT_LOG', card: '1:N' },
];

const MERMAID_SOURCE = `erDiagram
    ORGANISM ||--o{ GENE : "has"
    ORGANISM ||--o{ SAMPLE : "source of"
    LAB ||--o{ RESEARCHER : "employs"
    RESEARCHER ||--o{ EXPERIMENT : "runs"
    CAS_VARIANT ||--o{ EXPERIMENT : "used in"
    EXPERIMENT ||--o{ SAMPLE : "produces"
    SAMPLE ||--o{ SAMPLE : "is parent of"
    EXPERIMENT ||--o{ EXPERIMENT_GUIDE : "uses"
    GUIDE_RNA ||--o{ EXPERIMENT_GUIDE : "used by"
    GENE ||--o{ GUIDE_RNA : "targeted by"
    GUIDE_RNA ||--o{ OFF_TARGET_SITE : "predicts"
    GENE |o--o{ OFF_TARGET_SITE : "located in"
    SAMPLE ||--o{ MUTATION_EVENT : "shows"
    OFF_TARGET_SITE ||--o{ MUTATION_EVENT : "mutated at"
    DETECTION_METHOD ||--o{ MUTATION_EVENT : "found by"
    MUTATION_EVENT ||--o{ ALERT_LOG : "raises"`;

export function SettingsView({ user, isDark, onToggleTheme }: SettingsViewProps) {
  const [dbClient, setDbClient] = useState<string>('loading...');
  const [selectedEntityId, setSelectedEntityId] = useState<string>('SAMPLE');
  const [showMermaid, setShowMermaid] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiRequest<{ ok: boolean; dbClient: string }>('/api/health')
      .then((res) => setDbClient(res.dbClient === 'mysql' ? 'MySQL 8.0+' : 'Embedded SQLite (sql.js)'))
      .catch(() => setDbClient('Unavailable'));
  }, []);

  const selectedEntity =
    ER_ENTITIES.find((e) => e.id === selectedEntityId) ?? ER_ENTITIES[6];

  const handleCopyMermaid = async () => {
    try {
      await navigator.clipboard.writeText(MERMAID_SOURCE);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const boxW = 160;
  const boxH = 44;

  return (
    <div className="space-y-8">
      {/* Workspace Preferences & Runtime Configuration */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <TactileCard
          intensity="compact"
          className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg p-5 space-y-4"
        >
          <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
            Display &amp; Theme
          </h2>
          <p className="text-[13px] text-slate-500 dark:text-slate-400">
            Switch between clinical light surface and obsidian dark laboratory mode.
          </p>
          <div className="flex items-center gap-2 pt-1">
            <TactileButton
              onClick={() => {
                if (isDark) onToggleTheme();
              }}
              className={`btn-3d-secondary inline-flex items-center gap-2 px-3.5 py-2 text-[13px] font-medium rounded-md border ${
                !isDark
                  ? 'bg-cyan-50 border-cyan-600 text-cyan-800'
                  : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-[#101622] text-slate-600 dark:text-slate-300'
              }`}
            >
              <Sun className="w-3.5 h-3.5" />
              <span>Light Clinical</span>
            </TactileButton>
            <TactileButton
              onClick={() => {
                if (!isDark) onToggleTheme();
              }}
              className={`btn-3d-secondary inline-flex items-center gap-2 px-3.5 py-2 text-[13px] font-medium rounded-md border ${
                isDark
                  ? 'bg-cyan-950/60 border-cyan-500 text-cyan-300'
                  : 'border-slate-300 text-slate-600 bg-white'
              }`}
            >
              <Moon className="w-3.5 h-3.5" />
              <span>Dark Obsidian</span>
            </TactileButton>
          </div>
        </TactileCard>

        <TactileCard
          intensity="compact"
          className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg p-5 space-y-3"
        >
          <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
            Authenticated Session
          </h2>
          <dl className="space-y-2 text-[13px]">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Researcher</dt>
              <dd className="font-medium text-slate-900 dark:text-slate-100">{user.fullName}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Email</dt>
              <dd className="font-mono text-xs text-slate-700 dark:text-slate-300">{user.email}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Access Role</dt>
              <dd className="font-mono text-xs capitalize text-cyan-700 dark:text-cyan-400">{user.role}</dd>
            </div>
          </dl>
        </TactileCard>

        <TactileCard
          intensity="compact"
          className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg p-5 space-y-3"
        >
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-cyan-700 dark:text-cyan-400" />
            <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
              Database Engine &amp; Schema
            </h2>
          </div>
          <dl className="space-y-2 text-[13px]">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Active Driver</dt>
              <dd className="font-mono text-xs font-medium text-slate-900 dark:text-slate-100">{dbClient}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Normal Form</dt>
              <dd className="font-mono text-xs text-slate-700 dark:text-slate-300">3NF · 13 Core Tables</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">SQL Script</dt>
              <dd className="font-mono text-xs text-slate-700 dark:text-slate-300">database/schema.sql</dd>
            </div>
          </dl>
        </TactileCard>
      </div>

      {/* Interactive ER Diagram Section */}
      <TactileCard
        intensity="panel"
        interactiveScale={false}
        className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100">
              Entity-Relationship Diagram
            </h2>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">
              Click any table node to inspect its primary key, foreign keys, and schema role.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <TactileButton
              onClick={() => setShowMermaid((prev) => !prev)}
              className="btn-3d-secondary px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-[#101622] border border-slate-300 dark:border-slate-700 rounded-md"
            >
              {showMermaid ? 'Hide Mermaid Source' : 'View Mermaid Source'}
            </TactileButton>
            <TactileButton
              onClick={handleCopyMermaid}
              className="btn-3d-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-cyan-700 dark:text-cyan-400 bg-white dark:bg-[#101622] border border-cyan-600/40 rounded-md"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy Mermaid'}</span>
            </TactileButton>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-slate-200 dark:divide-slate-800">
          <div className="xl:col-span-9 overflow-x-auto p-4 bg-slate-50/70 dark:bg-[#06080D] lab-grid-surface">
            <svg
              viewBox="0 0 880 416"
              className="w-full min-w-[760px] h-auto select-none"
              role="img"
              aria-label="Entity-Relationship Diagram for HelixTrace CRISPR Tracker"
            >
              {ER_EDGES.map((edge, idx) => {
                const fromNode = ER_ENTITIES.find((n) => n.id === edge.from);
                const toNode = ER_ENTITIES.find((n) => n.id === edge.to);
                if (!fromNode || !toNode) return null;
                const x1 = fromNode.x + boxW / 2;
                const y1 = fromNode.y + boxH / 2;
                const x2 = toNode.x + boxW / 2;
                const y2 = toNode.y + boxH / 2;
                const isHighlighted =
                  selectedEntityId === edge.from || selectedEntityId === edge.to;

                return (
                  <g key={idx}>
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={isHighlighted ? '#06B6D4' : 'currentColor'}
                      strokeWidth={isHighlighted ? 2 : 1.15}
                      className={isHighlighted ? '' : 'text-slate-300 dark:text-slate-700'}
                    />
                  </g>
                );
              })}

              <path
                d="M 300 324 C 280 370, 370 370, 350 324"
                fill="none"
                stroke={selectedEntityId === 'SAMPLE' ? '#06B6D4' : '#64748B'}
                strokeWidth={selectedEntityId === 'SAMPLE' ? 2 : 1.4}
                strokeDasharray="4 2"
              />
              <text
                x="325"
                y="376"
                textAnchor="middle"
                className="fill-cyan-700 dark:fill-cyan-400 text-[10px] font-mono font-semibold"
              >
                parent_sample_id (1:N recursive)
              </text>

              {ER_ENTITIES.map((ent) => {
                const isSelected = ent.id === selectedEntityId;
                return (
                  <g
                    key={ent.id}
                    onClick={() => setSelectedEntityId(ent.id)}
                    className="cursor-pointer"
                  >
                    <rect
                      x={ent.x}
                      y={ent.y}
                      width={boxW}
                      height={boxH}
                      rx={6}
                      className={
                        isSelected
                          ? 'fill-cyan-50 dark:fill-cyan-950/60 stroke-cyan-700 dark:stroke-cyan-400'
                          : 'fill-white dark:fill-[#0B0F17] stroke-slate-300 dark:stroke-slate-700 hover:stroke-slate-500'
                      }
                      strokeWidth={isSelected ? 2 : 1}
                    />
                    <text
                      x={ent.x + 12}
                      y={ent.y + 19}
                      className="fill-slate-900 dark:fill-slate-100 text-[11px] font-mono font-semibold"
                    >
                      {ent.label}
                    </text>
                    <text
                      x={ent.x + 12}
                      y={ent.y + 34}
                      className="fill-slate-500 dark:fill-slate-400 text-[10px] font-mono"
                    >
                      PK: {ent.pk}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="xl:col-span-3 p-5 space-y-4">
            <div>
              <div className="text-xs text-cyan-700 dark:text-cyan-400 font-medium">
                Selected Table
              </div>
              <h3 className="mt-0.5 text-lg font-mono font-semibold text-slate-900 dark:text-slate-100">
                {selectedEntity.label}
              </h3>
            </div>

            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {selectedEntity.role}
            </p>

            <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
              <div>
                <div className="text-slate-500 dark:text-slate-400">Primary Key</div>
                <div className="mt-0.5 font-mono font-medium text-slate-900 dark:text-slate-100">
                  {selectedEntity.pk}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Foreign Keys</div>
                {selectedEntity.fks.length === 0 ? (
                  <div className="mt-0.5 text-slate-400">None (root lookup entity)</div>
                ) : (
                  <ul className="mt-1 space-y-1 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                    {selectedEntity.fks.map((fk) => (
                      <li key={fk}>{fk}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>

        {showMermaid && (
          <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-[#06080D] text-slate-100 overflow-x-auto">
            <pre className="text-xs font-mono leading-relaxed">{MERMAID_SOURCE}</pre>
          </div>
        )}
      </TactileCard>

      {/* Reference Architecture & Normalization Notes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TactileCard
          intensity="panel"
          className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg p-5 space-y-5"
        >
          <div>
            <h2 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100">
              Data Model &amp; Normalization (3NF)
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
              CRISPR-Cas9 edits DNA using a guide RNA, which can occasionally cleave unintended genomic loci (off-target sites). Edited cells are expanded into multi-generation cell-line families. Because <code className="font-mono text-cyan-700 dark:text-cyan-400">sample.parent_sample_id</code> references <code className="font-mono text-cyan-700 dark:text-cyan-400">sample</code> itself, recursive CTEs walk the tree to trace how mutations propagate across generations.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Key Relationships
            </h3>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-1.5 pr-3">Relationship</th>
                  <th className="py-1.5 pr-3">Cardinality</th>
                  <th className="py-1.5">Implementation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                <tr>
                  <td className="py-2 pr-3 font-medium">Experiment – Guide RNA</td>
                  <td className="py-2 pr-3 font-mono">M:N</td>
                  <td className="py-2">Bridge table <code className="font-mono">experiment_guide</code></td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-medium">Sample – Sample</td>
                  <td className="py-2 pr-3 font-mono">1:N recursive</td>
                  <td className="py-2">Self-referencing FK <code className="font-mono">parent_sample_id</code></td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-medium">Sample – Off-target site</td>
                  <td className="py-2 pr-3 font-mono">M:N</td>
                  <td className="py-2">Resolved by <code className="font-mono">mutation_event</code></td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-medium">Off-target site – Gene</td>
                  <td className="py-2 pr-3 font-mono">N:1 optional</td>
                  <td className="py-2">Nullable <code className="font-mono">gene_id</code> for intergenic sites</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Transitive Dependencies Resolved in 3NF
            </h3>
            <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
              <li>
                <span className="font-mono">researcher → lab → department</span> separated into <code className="font-mono">lab</code> and <code className="font-mono">researcher</code>
              </li>
              <li>
                <span className="font-mono">experiment → cas_variant → pam_motif, fidelity</span> separated into <code className="font-mono">cas_variant</code>
              </li>
              <li>
                <span className="font-mono">site → gene → gene_type, chromosome</span> separated into <code className="font-mono">gene</code>
              </li>
              <li>
                <span className="font-mono">event → method → is_genome_wide</span> separated into <code className="font-mono">detection_method</code>
              </li>
              <li>
                <span className="font-mono">sample → organism → scientific_name</span> separated into <code className="font-mono">organism</code>
              </li>
            </ul>
            <p className="pt-1 text-xs text-slate-500 dark:text-slate-400">
              Design note: <code className="font-mono">sample.generation</code> is a stored derived attribute maintained automatically by <code className="font-mono">trg_sample_generation</code> for fast lineage queries.
            </p>
          </div>
        </TactileCard>

        <TactileCard
          intensity="panel"
          className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17] rounded-lg p-5 space-y-5"
        >
          <div>
            <h2 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100">
              Implemented SQL Objects &amp; Capabilities
            </h2>
            <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
              Every analytical view in HelixTrace executes these database constructs directly.
            </p>
          </div>

          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <th className="py-1.5 pr-3">DBMS Feature</th>
                <th className="py-1.5">Database Implementation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
              <tr>
                <td className="py-2 pr-3 font-medium">Constraints &amp; Indexes</td>
                <td className="py-2">PK, FK, UNIQUE, CHECK, DEFAULT, ENUM + 4 composite/lookup indexes</td>
              </tr>
              <tr>
                <td className="py-2 pr-3 font-medium">Triggers</td>
                <td className="py-2 font-mono">trg_sample_generation, trg_high_freq_alert</td>
              </tr>
              <tr>
                <td className="py-2 pr-3 font-medium">Scalar Function</td>
                <td className="py-2 font-mono">fn_risk_level(freq, region, gene_type)</td>
              </tr>
              <tr>
                <td className="py-2 pr-3 font-medium">Views</td>
                <td className="py-2 font-mono">v_offtarget_report, v_high_risk_events, v_experiment_summary</td>
              </tr>
              <tr>
                <td className="py-2 pr-3 font-medium">Stored Procedure</td>
                <td className="py-2 font-mono">sp_experiment_report(p_exp)</td>
              </tr>
              <tr>
                <td className="py-2 pr-3 font-medium">Recursive CTEs</td>
                <td className="py-2">Walks ancestor chains and downstream sub-clones in Lineage Tree</td>
              </tr>
              <tr>
                <td className="py-2 pr-3 font-medium">Window Ranking</td>
                <td className="py-2 font-mono">RANK() OVER (PARTITION BY guide_name ORDER BY allele_freq DESC)</td>
              </tr>
              <tr>
                <td className="py-2 pr-3 font-medium">Transactions</td>
                <td className="py-2">ACID transactions across sample updates and experiment creation</td>
              </tr>
            </tbody>
          </table>

          <div className="p-3.5 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#06080D] rounded-md space-y-1.5">
            <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">
              Running Against MySQL 8.0+ / MySQL Workbench
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Window functions and recursive CTEs require MySQL 8.0 or newer. Load <code className="font-mono">database/schema.sql</code> in MySQL Workbench or via CLI, then set <code className="font-mono">DB_CLIENT=mysql</code> and your connection variables in <code className="font-mono">.env</code>.
            </p>
          </div>
        </TactileCard>
      </div>
    </div>
  );
}
