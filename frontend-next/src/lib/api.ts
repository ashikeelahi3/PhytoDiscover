import axios from "axios";
import type {
  ChainsResponse,
  CompoundStats,
  DispatchRequest,
  DispatchResponse,
  DockingJob,
  GridBoxResponse,
  Phytochemical,
  Result,
  Session,
  SmilesResult,
  WorkerStatus,
} from "@/lib/types";

// ── Axios instance ────────────────────────────────────────────────────────────
// Requests go to the Next.js proxy (/api/*) which forwards to FastAPI.
// withCredentials ensures the pd_session cookie is sent on every request.

const api = axios.create({
  baseURL:
    typeof window === "undefined"
      ? (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000")
      : "",
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

// ── Session ───────────────────────────────────────────────────────────────────

export async function getSession(): Promise<Session> {
  const { data } = await api.get<Session>("/api/session/me");
  return data;
}

export async function updateDisplayName(displayName: string): Promise<Session> {
  const { data } = await api.patch<Session>("/api/session/me", {
    display_name: displayName,
  });
  return data;
}

export async function clearSession(): Promise<void> {
  await api.delete("/api/session/me");
}

// ── Compounds ─────────────────────────────────────────────────────────────────

export async function getStats(): Promise<CompoundStats> {
  const { data } = await api.get<CompoundStats>("/api/compounds/stats");
  return data;
}

export async function searchCompounds(params: {
  name?: string;
  source_plant?: string;
  lipinski_pass?: boolean;
  has_smiles?: boolean;
  min_mw?: number;
  max_mw?: number;
  max_logp?: number;
  skip?: number;
  limit?: number;
}): Promise<{ compounds: Phytochemical[]; totalCount: number }> {
  const response = await api.get<Phytochemical[]>("/api/compounds/search", {
    params,
  });
  return {
    compounds: response.data,
    totalCount: Number(response.headers["x-total-count"] ?? response.data.length),
  };
}

export function exportCompoundsCsvUrl(params: {
  name?: string;
  source_plant?: string;
  lipinski_pass?: boolean;
  has_smiles?: boolean;
}): string {
  const p = new URLSearchParams();
  if (params.name) p.set("name", params.name);
  if (params.source_plant) p.set("source_plant", params.source_plant);
  if (params.lipinski_pass != null) p.set("lipinski_pass", String(params.lipinski_pass));
  if (params.has_smiles != null) p.set("has_smiles", String(params.has_smiles));
  const qs = p.toString();
  return `/api/compounds/export/csv${qs ? `?${qs}` : ""}`;
}

export async function getCompound(id: string): Promise<Phytochemical> {
  const { data } = await api.get<Phytochemical>(`/api/compounds/${id}`);
  return data;
}

// ── SMILES validation ─────────────────────────────────────────────────────────

export async function validateSmiles(smilesList: string[]): Promise<SmilesResult[]> {
  const { data } = await api.post<SmilesResult[]>("/api/smiles/validate", {
    smiles: smilesList,
  });
  return data;
}

// ── Protein ───────────────────────────────────────────────────────────────────

export async function getProtein(code: string) {
  const { data } = await api.get(`/api/protein/${encodeURIComponent(code)}`);
  return data;
}

export async function getChains(code: string): Promise<ChainsResponse> {
  const { data } = await api.get<ChainsResponse>(
    `/api/protein/${encodeURIComponent(code)}/chains`
  );
  return data;
}

export async function computeGridBox(body: {
  protein_code: string;
  chain: string;
  mode: string;
  x_coord?: number;
  y_coord?: number;
  z_coord?: number;
  radius?: number;
}): Promise<GridBoxResponse> {
  const { data } = await api.post<GridBoxResponse>(
    "/api/protein/gridbox",
    body
  );
  return data;
}

// ── Docking ───────────────────────────────────────────────────────────────────

export async function dispatchJob(
  body: DispatchRequest
): Promise<DispatchResponse> {
  const { data } = await api.post<DispatchResponse>(
    "/api/docking/dispatch",
    body
  );
  return data;
}

export async function getJobs(params?: {
  skip?: number;
  limit?: number;
}): Promise<{ jobs: DockingJob[]; totalCount: number; displayName: string }> {
  const response = await api.get<DockingJob[]>("/api/docking/jobs", {
    params,
  });
  return {
    jobs: response.data,
    totalCount: Number(response.headers["x-session-job-count"] ?? 0),
    displayName: response.headers["x-session-display-name"] ?? "",
  };
}

export async function getJob(jobId: string): Promise<DockingJob> {
  const { data } = await api.get<DockingJob>(`/api/docking/jobs/${jobId}`);
  return data;
}

export async function getJobError(jobId: string): Promise<{
  job_id: string;
  status: string;
  error_message: string | null;
  created_at: string | null;
}> {
  const { data } = await api.get(`/api/docking/jobs/${jobId}/error`);
  return data;
}

export async function getResults(jobId: string): Promise<Result[]> {
  const { data } = await api.get<Result[]>(
    `/api/docking/results/${jobId}`
  );
  return data;
}

export function getResultsCsvUrl(jobId: string): string {
  return `/api/docking/results/${jobId}/csv`;
}

export async function getPoseFile(resultId: string): Promise<string> {
  const { data } = await api.get<string>(`/api/docking/pose/${resultId}`, {
    responseType: "text",
  });
  return data;
}

// ── Workers ───────────────────────────────────────────────────────────────────

export async function getWorkers(): Promise<WorkerStatus> {
  const { data } = await api.get<WorkerStatus>("/api/docking/workers");
  return data;
}

// ── Health ────────────────────────────────────────────────────────────────────

export async function getHealth(): Promise<{ status: string; database: string }> {
  const { data } = await api.get("/api/health");
  return data;
}

export default api;
