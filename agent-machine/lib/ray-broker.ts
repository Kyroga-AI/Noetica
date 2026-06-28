/**
 * ray-broker — the executor that turns the cloud-broker from a calculator into action, and makes sovereign
 * fine-tuning real: broker picks the cheapest compliant GPU (neocloud / hyperscaler / Ascend / local) → we render a
 * KubeRay RayCluster spec for it → submit a Ray Train fine-tune (TritFabric LoRA on an open model like Qwen3).
 *
 * Ray is the moat: open + cloud-agnostic, so the SAME training fabric runs on the cheapest GPU anywhere — the
 * portability the hyperscalers' lock-in MLOps (SageMaker/Vertex/Azure ML) structurally can't offer. The RaySubmitter
 * is injectable (KubeRay-on-Kubernetes in prod), so the whole path is proven in-process. Placement flows through the
 * agentplane evidence pipeline (scope-d-governed).
 */
import { brokerCompute, toAgentplanePlacement, type ComputeRequest, type BrokerResult, type AgentplanePlacementDecision } from "./cloud-broker.js";

export interface RayClusterSpec {
  apiVersion: "ray.io/v1";
  kind: "RayCluster";
  provider: string;
  image: string;
  head: { cpu: number; memGiB: number };
  workerGroup: { replicas: number; cpu: number; memGiB: number; gpu: { type: string; count: number } };
  estUsdPerHour: number;
}

export interface FineTuneJob {
  baseModel: string;            // e.g. "Qwen/Qwen3-14B" — open, Apache-2.0
  dataset: string;              // uri to the training data
  method: "lora" | "qlora" | "sft";
  loraRank?: number;
  epochs: number;
  outputRef: string;           // where the adapter/model is written (sealed, sovereign)
}

export type JobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";

/** Pluggable cluster+job submitter. Prod impl = KubeRay on the brokered cloud's Kubernetes; tests inject a fake. */
export interface RaySubmitter {
  createCluster(spec: RayClusterSpec): { clusterId: string } | Promise<{ clusterId: string }>;
  submitJob(clusterId: string, job: FineTuneJob): { jobId: string } | Promise<{ jobId: string }>;
  status(jobId: string): JobStatus | Promise<JobStatus>;
}

/** Plan the cheapest Ray training cluster for a workload (the broker chooses the GPU). */
export function planTrainingCluster(req: ComputeRequest & { image?: string }, pre?: BrokerResult): RayClusterSpec | null {
  const result = pre ?? brokerCompute(req);
  const best = result.best;
  if (!best) return null;
  const sku = best.sku;
  return {
    apiVersion: "ray.io/v1",
    kind: "RayCluster",
    provider: sku.provider,
    image: req.image ?? "ghcr.io/socioprophet/ray-train:tritfabric",
    head: { cpu: 4, memGiB: 16 },
    workerGroup: { replicas: 1, cpu: sku.vcpus, memGiB: sku.memGiB, gpu: { type: sku.gpu?.type ?? "none", count: sku.gpu?.count ?? 0 } },
    estUsdPerHour: best.effectivePerHour,
  };
}

export interface TrainingPlacement { clusterId: string; jobId: string; spec: RayClusterSpec; placement: AgentplanePlacementDecision }

/** End-to-end: broker → KubeRay cluster → Ray Train fine-tune, on the cheapest compliant GPU. */
export async function fineTuneOnCheapestGpu(
  submitter: RaySubmitter,
  job: FineTuneJob,
  req: ComputeRequest & { image?: string },
  opts: { lane?: "staging" | "prod" } = {},
): Promise<TrainingPlacement | null> {
  const result = brokerCompute(req);
  const spec = planTrainingCluster(req, result);
  if (!spec) return null;
  const { clusterId } = await submitter.createCluster(spec);
  const { jobId } = await submitter.submitJob(clusterId, job);
  return { clusterId, jobId, spec, placement: toAgentplanePlacement(result, { lane: opts.lane ?? "staging" }) };
}
