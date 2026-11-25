export interface User {
  sub: number;
  email: string;
  fullName: string;
  role: 'admin' | 'researcher';
  labId: number | null;
}

export interface Lab {
  lab_id: number;
  lab_name: string;
  department: string;
}

export interface AuthStatus {
  needsBootstrap: boolean;
  hasUsers: boolean;
  envPasscodeConfigured: boolean;
  labs: Lab[];
}

export interface DashboardData {
  totals: {
    samples: number;
    mutations: number;
    high_risk: number;
    alerts: number;
    experiments: number;
    guides: number;
  };
  experiments: ExperimentSummary[];
  fidelityStats: Array<{
    fidelity: 'Standard' | 'High';
    mutations: number;
    avg_freq: number;
    max_freq: number;
  }>;
  mismatchStats: Array<{
    mismatch_count: number;
    events: number;
    avg_freq: number;
    max_freq: number;
  }>;
  mutationDistribution: Array<{
    mutation_type: string;
    cnt: number;
    avg_freq: number;
  }>;
  labRisk: Array<{
    lab_name: string;
    high_risk_events: number;
  }>;
}

export interface SampleNode {
  sample_id: number;
  sample_code: string;
  cell_line: string;
  organism_id: number;
  organism_name: string;
  experiment_id: number;
  experiment_title: string;
  cas_variant: string;
  cas_fidelity: 'Standard' | 'High';
  parent_sample_id: number | null;
  parent_sample_code: string | null;
  generation: number;
  created_date: string;
  status: 'active' | 'frozen' | 'discarded';
  notes: string | null;
  path: string;
  mutation_count: number;
  max_allele_freq: number;
  high_risk_count: number;
}

export interface SampleTrace {
  sample: {
    sample_id: number;
    sample_code: string;
    cell_line: string;
    generation: number;
    status: 'active' | 'frozen' | 'discarded';
    created_date: string;
    notes: string | null;
    experiment_id: number;
    organism_id: number;
  };
  ancestors: Array<{
    sample_id: number;
    sample_code: string;
    generation: number;
    status: string;
    generations_back: number;
    event_id: number | null;
    mutation_type: string | null;
    allele_freq: number | null;
    detected_on: string | null;
    guide_name: string | null;
    chromosome: string | null;
    position: number | null;
    region_type: string | null;
    hit_gene: string | null;
  }>;
  descendants: Array<{
    sample_id: number;
    sample_code: string;
    generation: number;
    status: string;
    depth: number;
    mutations: number;
    max_freq: number;
  }>;
}

export interface OffTargetEvent {
  event_id: number;
  experiment_id: number;
  experiment: string;
  sample_code: string;
  generation: number;
  guide_name: string;
  chromosome: string;
  position: number;
  mismatch_count: number;
  region_type: 'exon' | 'intron' | 'intergenic';
  hit_gene: string | null;
  gene_type: 'tumor_suppressor' | 'oncogene' | 'other' | null;
  mutation_type: 'SNV' | 'insertion' | 'deletion' | 'indel';
  allele_freq: number;
  method_name: string;
  detected_on: string;
  risk_level: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface UnhitSite {
  site_id: number;
  guide_name: string;
  chromosome: string;
  position: number;
  mismatch_count: number;
  region_type: string;
  target_gene: string | null;
}

export interface RankedMutation {
  event_id: number;
  guide_name: string;
  sample_code: string;
  hit_gene: string | null;
  allele_freq: number;
  risk_level: 'HIGH' | 'MEDIUM' | 'LOW';
  rank_in_guide: number;
}

export interface ExperimentSummary {
  experiment_id: number;
  title: string;
  researcher: string;
  cas_variant: string;
  fidelity: 'Standard' | 'High';
  total_samples: number;
  total_mutations: number;
  max_freq: number;
  avg_freq: number;
  start_date?: string;
  lab_name?: string;
}

export interface GuideRnaRecord {
  guide_id: number;
  guide_name: string;
  spacer_seq: string;
  pam_seq: string;
  on_target_score: number;
  target_gene: string;
  target_chromosome: string;
  target_gene_type: string;
  organism: string;
  predicted_sites: number;
  detected_mutations: number;
  avg_freq: number;
  worst_freq: number;
  total_load: number;
}

export interface OffTargetSiteRecord {
  site_id: number;
  guide_id: number;
  guide_name: string;
  chromosome: string;
  position: number;
  mismatch_count: number;
  region_type: 'exon' | 'intron' | 'intergenic';
  gene_id: number | null;
  gene_symbol: string | null;
}

export interface AlertLogRecord {
  alert_id: number;
  event_id: number;
  message: string;
  created_at: string;
  experiment: string;
  sample_code: string;
  guide_name: string;
  hit_gene: string | null;
  allele_freq: number;
  risk_level: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface AlertsResponse {
  alertLogs: AlertLogRecord[];
  highRiskEvents: OffTargetEvent[];
  tumorSuppressorSamples: Array<{
    sample_code: string;
    cell_line: string;
    generation: number;
    status: string;
    notes: string | null;
  }>;
  cleanSamples: Array<{
    sample_code: string;
    cell_line: string;
    generation: number;
    status: string;
    experiment_title: string;
  }>;
  integrityOrphanEvents: number;
}

export interface ReferenceCatalog {
  organisms: Array<{ organism_id: number; common_name: string; scientific_name: string }>;
  labs: Lab[];
  researchers: Array<{ researcher_id: number; full_name: string; email: string; lab_id: number }>;
  casVariants: Array<{ cas_id: number; variant_name: string; pam_motif: string; fidelity: 'Standard' | 'High' }>;
  detectionMethods: Array<{ method_id: number; method_name: string; is_genome_wide: number | boolean }>;
  genes: Array<{
    gene_id: number;
    gene_symbol: string;
    organism_id: number;
    chromosome: string;
    gene_type: 'tumor_suppressor' | 'oncogene' | 'other';
    scientific_name: string;
  }>;
  offTargetSites: OffTargetSiteRecord[];
  experiments: Array<{ experiment_id: number; title: string }>;
  guideLinks: Array<{ experiment_id: number; guide_id: number }>;
}

export interface NcbiAnnotation {
  symbol: string;
  organism: string;
  ncbiGeneId: string | null;
  officialName: string;
  chromosome: string;
  mapLocation: string | null;
  summary: string;
  source: 'ncbi_live' | 'local_reference';
  apiKeyConfigured: boolean;
}
