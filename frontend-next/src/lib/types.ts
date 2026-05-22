// ── Phytochemical ─────────────────────────────────────────────────────────────

export interface Phytochemical {
  id: string;
  name: string;
  iupac_name: string | null;
  market_name: string | null;
  pubchem_cid: number | null;
  smiles: string | null;
  inchi: string | null;
  inchikey: string | null;
  molecular_weight: number | null;
  logp: number | null;
  h_bond_donors: number | null;
  h_bond_acceptors: number | null;
  tpsa: number | null;
  rotatable_bonds: number | null;
  lipinski_pass: boolean | null;
  source_plant: string | null;
  plant_family: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompoundStats {
  total: number;
  with_smiles: number;
  with_rdkit_props: number;
  lipinski_pass: number;
}

// ── Protein ───────────────────────────────────────────────────────────────────

export type ProteinSource = "PDB" | "AlphaFold";
export type GridMode = "blind" | "active_site";

export interface Protein {
  id: string;
  protein_code: string;
  source: ProteinSource;
  selected_chain: string | null;
  grid_mode: GridMode | null;
  grid_params_json: Record<string, number> | null;
  pdb_path: string | null;
  pdbqt_path: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface ChainsResponse {
  protein_code: string;
  chains: string[];
  recommended: string | null;
}

export interface GridBoxResponse {
  protein_code: string;
  chain: string;
  mode: GridMode;
  grid_params: Record<string, number>;
}

// ── Docking ───────────────────────────────────────────────────────────────────

export type JobStatus =
  | "pending"
  | "preparing"
  | "docking"
  | "parsing"
  | "done"
  | "failed";

export interface DockingJob {
  id: string;
  compound_id: string;
  protein_id: string;
  session_id: string | null;
  pathway: string;
  celery_task_id: string | null;
  status: JobStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface DispatchRequest {
  protein_code: string;
  chain: string;
  compound_ids: string[];
  smiles_list: string[];
  plant_name: string | null;
  grid_mode: GridMode;
  grid_params: Record<string, number>;
}

export interface DispatchResponse {
  job_id: string;
  status: "pending";
  pathway: string;
}

// ── Results ───────────────────────────────────────────────────────────────────

export interface Result {
  id: string;
  job_id: string;
  compound_name: string;
  binding_score: number | null;
  rmsd_lower: number | null;
  rmsd_upper: number | null;
  h_bond_count: number | null;
  pose_file: string | null;
  created_at: string;
}

// ── Session ───────────────────────────────────────────────────────────────────

export interface Session {
  session_id: string;
  display_name: string;
  created_at: string;
  last_active: string;
}

// ── Workers ───────────────────────────────────────────────────────────────────

export interface WorkerInfo {
  name: string;
  status: "online" | "unknown";
  active_tasks: number;
  queue: "docking" | "fast";
}

export interface WorkerStatus {
  workers: WorkerInfo[];
  total_online: number;
  docking_queue_length: number;
  fast_queue_length: number;
  error?: string;
}

// ── SMILES validation ─────────────────────────────────────────────────────────

export interface SmilesResult {
  smiles: string | null;
  is_valid: boolean;
  molecular_weight: number | null;
  logp: number | null;
  h_bond_donors: number | null;
  h_bond_acceptors: number | null;
  tpsa: number | null;
  rotatable_bonds: number | null;
  lipinski_pass: boolean | null;
  error: string | null;
}
