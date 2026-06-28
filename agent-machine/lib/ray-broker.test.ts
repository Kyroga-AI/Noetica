/** Proofs: broker → KubeRay → Ray Train fine-tune lands on the cheapest compliant GPU; sovereign-only restriction;
 *  placement is evidence-shaped. Submitter is faked (KubeRay in prod). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { planTrainingCluster, fineTuneOnCheapestGpu, type RaySubmitter, type FineTuneJob } from "./ray-broker.js";
import { NEOCLOUDS } from "./cloud-broker.js";

const job: FineTuneJob = { baseModel: "Qwen/Qwen3-14B", dataset: "s3://data/train.jsonl", method: "lora", loraRank: 16, epochs: 3, outputRef: "vault://adapters/qwen3-tuned" };

function fakeSubmitter() {
  const clusters: unknown[] = []; const jobs: unknown[] = [];
  const s: RaySubmitter = {
    createCluster: (spec) => { clusters.push(spec); return { clusterId: "c1" }; },
    submitJob: (cid, j) => { jobs.push({ cid, j }); return { jobId: "j1" }; },
    status: () => "RUNNING",
  };
  return { s, clusters, jobs };
}

test("plans the cheapest GPU cluster — H100 fine-tune lands on a neocloud", () => {
  const spec = planTrainingCluster({ gpu: { type: "H100", count: 1 }, hours: 10, excludeLocal: true });
  assert.ok(spec);
  assert.ok((NEOCLOUDS as string[]).includes(spec!.provider), `cheapest H100 cluster on a neocloud, got ${spec!.provider}`);
  assert.equal(spec!.workerGroup.gpu.count, 1);
  assert.ok(spec!.workerGroup.gpu.type.includes("H100"));
  assert.ok(spec!.estUsdPerHour <= 2.0);
});

test("end-to-end: broker → cluster → Ray Train job, with evidence-shaped placement", async () => {
  const { s, clusters, jobs } = fakeSubmitter();
  const r = await fineTuneOnCheapestGpu(s, job, { gpu: { type: "H100", count: 1 }, hours: 10, excludeLocal: true });
  assert.ok(r);
  assert.equal(r!.clusterId, "c1");
  assert.equal(r!.jobId, "j1");
  assert.equal(clusters.length, 1);
  assert.equal((jobs[0] as { j: FineTuneJob }).j.baseModel, "Qwen/Qwen3-14B");
  assert.equal(r!.placement.kind, "PlacementDecision");
  assert.ok(r!.placement.objective.value >= 0);
});

test("sovereign-only restriction: confine training to approved (neocloud) supply", async () => {
  const { s } = fakeSubmitter();
  const r = await fineTuneOnCheapestGpu(s, job, { gpu: { count: 1 }, hours: 5, providers: NEOCLOUDS });
  assert.ok(r && (NEOCLOUDS as string[]).includes(r.spec.provider));
});

test("no GPU available → null (no cluster spun up)", () => {
  assert.equal(planTrainingCluster({ gpu: { type: "NONEXISTENT", count: 99 }, hours: 1 }), null);
});
