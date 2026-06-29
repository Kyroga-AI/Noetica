# Cloud Partner Outreach — Noetica / SocioProphet

> **Purpose:** Establish provider relationships for GPU compute provisioning, data co-location, and sovereign AI workloads across US, AU, and NZ. Aligned with the cloud-broker adapter build sequence (Tier 1 → Tier 2 → Tier 3).

---

## Relationship tiers

| Tier | Relationship goal | What we need |
|---|---|---|
| **Tier 1 — Build now** | Direct commercial agreement + programmatic API access | Pricing, API keys/CLI access, SLA terms |
| **Tier 2 — Channel partner** | Reseller / referral agreement + adapter | Commercial terms + data-residency confirmation |
| **Tier 3 — Catalogue + watch** | Pricing reference, no active engineering yet | Public pricing confirmation |

---

## Priority contacts

### 1. Nebius AI Cloud (US + EU) — Tier 1 — HIGHEST PRIORITY

**Why:** Cheapest H100 spot globally (~$1.40–2.10/hr). Powers the WS-A metal proof ($18/run). Already in the catalog as the anchor SKU. The Nebius CLI (`nebius`) + REST API are documented and the `createCommand`/`teardownCommand` are written.

**What we need:**
- Service-account API key for programmatic create/teardown (authenticate via service-account JSON key)
- Confirm H100-SXM spot availability in `us-east1` and `eu-north1`
- Volume commitment pricing for sustained WS-A training runs (100+ GPU-hours/month)
- S3-compatible object storage endpoint for artifact staging

**Contact:**
- Sales: https://nebius.com/contact-sales
- Docs: https://docs.nebius.com/compute/api-reference/
- CLI setup: https://docs.nebius.com/cli/

**Talking points:** We are building a sovereign AI cloud-mesh and need the cheapest H100 spot for LoRA fine-tuning (Qwen3, Llama-3.3). We're routing WS-A workloads programmatically via our cloud broker — Nebius is the default cheapest pick. We want a volume agreement and a dedicated account contact.

---

### 2. Micron21 mCloud (AU — Melbourne + Sydney) — Tier 1 — CRITICAL FOR AU LANE

**Why:** Only confirmed AU-sovereign GPU cloud with IRAP Protected assessment AND H100/H200. The AU government sovereign lane for AI workloads is blocked without this. No other AU neocloud has both IRAP and H100 today.

**What we need:**
- Pricing for H100 SXM, H200 SXM, A100 (volume quotes for 12–18hr WS-A jobs)
- IRAP scope confirmation (which platforms cover GPU compute workloads specifically)
- API or provisioning workflow (do they have a REST API, or is it portal + ticket?)
- Data residency confirmation for `au-vic` and `au-nsw` platforms
- Partnership / reseller agreement terms

**Contact:**
- Enterprise solutions: solutions@micron21.com
- Product page: https://www.micron21.com/enterprise/mcloud-gpu-nvidia-h100
- Phone: +61 3 9751 8800 (AU)

**Talking points:** We are building a sovereign AI platform serving AU government and enterprise clients. We need IRAP-assessed GPU compute for LoRA fine-tuning and AI inference bursts. Micron21 is the only AU-sovereign provider with H100 + IRAP — we want to establish a commercial agreement and explore whether your provisioning supports programmatic API access. If not, we'd like a dedicated POC for job submission.

---

### 3. Firmus Technologies (AU — Melbourne) — Tier 2 — EARLY ACCESS DEAL

**Why:** Nvidia-backed AU AI factory with 36,000 GB300 Grace Blackwell NVL chips. Project Southgate targeting online 2026-H1. Being an early committed partner at scale beats arriving after pricing hardens. GB300 is the generational GPU leap — the whole WS-A story gets dramatically cheaper here.

**What we need:**
- Early access agreement for GB300 capacity (commit to volume in exchange for preferred pricing)
- Timeline for commercial API / programmatic provisioning
- IRAP assessment roadmap (not currently assessed — confirm whether this is planned)
- Discuss reseller / partner programme

**Contact:**
- Enquiries: info@firmus.co
- Infrastructure: https://firmus.co/infrastructure
- LinkedIn: Firmus Technologies (AU)

**Talking points:** We are an early AI infrastructure buyer planning substantial H100 → GB300 migration for sovereign AI workloads. We want to lock in early-access pricing before the Southgate facility opens at full capacity. Our workloads are LoRA fine-tuning jobs (12–72 GPU-hours, Qwen3/Llama-3.3 class models) — can we establish a committed-use agreement now?

---

### 4. AWS (US + AU + NZ) — Tier 1 — HYPERSCALER ANCHOR

**Why:** Single SDK covers us-east-1, us-west-2, ap-southeast-2 (Sydney), ap-southeast-4 (Melbourne), ap-southeast-6 (Auckland NZ). IRAP-assessed in AU. P5 H100 instances available in Sydney. The broadest jurisdictional coverage per engineering day.

**What we need:**
- AWS account setup for programmatic provisioning (existing or dedicated org account)
- Reserved capacity or Savings Plans for ap-southeast-2 P5 instances (spot capacity is constrained in AU)
- IRAP Assessed Services confirmation for GPU workloads in ap-southeast-2
- AWS Marketplace listing discussion (future — sovereign AI mesh as a marketplace product)

**Contact:**
- APAC sales: https://aws.amazon.com/contact-us/
- AU public sector: aws-au-publicsector@amazon.com
- IRAP reference: https://aws.amazon.com/compliance/irap/

**Talking points:** We need P5 H100 capacity in ap-southeast-2 for PROTECTED-level AU government AI workloads + NZ data-residency (ap-southeast-6). We want to explore Reserved Capacity for predictable WS-A training runs and confirm IRAP scope for GPU instance types.

---

### 5. CoreWeave (US) — Tier 1 — ENTERPRISE US GPU

**Why:** Enterprise-grade Kubernetes-native GPU cloud. H100 SXM with strong SLAs. Better uptime guarantees than spot-first neoclouds. Pairs with Nebius: route cost-sensitive WS-A to Nebius, SLA-critical enterprise client demos to CoreWeave.

**What we need:**
- API / kubeconfig access for programmatic GPU Job submission
- Pricing for sustained H100 SXM workloads (100+ GPU-hours/month)
- Contractual SLA terms (uptime, preemption notice)
- Reseller / partner programme eligibility

**Contact:**
- Sales: https://www.coreweave.com/contact-us
- Docs: https://docs.coreweave.com/

---

### 6. Catalyst Cloud (NZ — Wellington + Auckland) — Tier 2 — NZ SOVEREIGN

**Why:** NZ-owned, NZ-operated, NZ law. All-of-Government framework agreement makes this the preferred route for NZ public sector clients. GPU K8s acceleration confirmed; specifics TBC.

**What we need:**
- GPU instance specs (model, memory, pricing)
- API / OpenStack credentials for programmatic provisioning
- All-of-Government framework agreement number for procurement eligibility
- Data-residency confirmation (all compute within NZ)

**Contact:**
- Cloud team: cloud@catalyst.net.nz
- Support portal: https://catalystcloud.nz/

**Talking points:** We are a sovereign AI platform serving NZ government clients. We want to use Catalyst Cloud for GPU compute workloads under NZ jurisdiction. Can you share your current GPU instance types, pricing, and whether there's a programmatic provisioning API compatible with our OpenStack tooling?

---

### 7. Datacom (NZ + AU) — Tier 2 — CHANNEL PARTNER

**Why:** NZ's largest IT services company. Deep enterprise and government relationships in NZ and AU. GPU-enabled sovereign infrastructure confirmed. This is a channel-partner conversation, not just a compute target — their distribution is larger than the GPU relationship alone.

**What we need:**
- GPU instance specs and pricing
- Reseller / referral agreement for NZ and AU enterprise/government sales
- Channel partner programme details
- Data residency and sovereignty confirmation

**Contact:**
- Cloud: cloud@datacom.com
- Enterprise sales: https://datacom.com/nz/en/contact

---

### 8. AUCloud (AU — all platforms, IRAP PROTECTED) — Tier 3 — IDENTITY LANE

**Why:** No GPU today. The strongest IRAP PROTECTED posture in AU (blanket PROTECTED across 6 platforms, Hosting Certification Framework Strategic). Strategically important for hosting our OIDC broker and sovereign identity services — the trust anchor for AU government clients, not the compute layer.

**What we need:**
- Commercial terms for hosting the Noetica OIDC broker + governance services on their PROTECTED platform
- Discuss future GPU compute addition (watch for announcement)
- ISM/IRAP attestation scope for AI workloads hosted on the platform

**Contact:**
- Sales: sales@aucloud.com.au
- https://aucloud.com.au/

---

## Data co-location strategy

For AI task placement and compute co-location, the routing logic is:

```
Workload jurisdiction → IRAP required? → provider selection
─────────────────────────────────────────────────────────────
US, non-sovereign         → Nebius (cheapest) or CoreWeave (SLA)
US, enterprise SLA        → CoreWeave or AWS us-east-1
AU, non-sovereign         → AWS ap-southeast-2 (broadest coverage)
AU, IRAP required         → Micron21 mCloud (sovereign) or AWS ap-southeast-2 / Azure australiaeast
AU, classified/PROTECTED  → Micron21 mCloud + AUCloud identity layer
AU, future / highest perf → Firmus GB300 (when online)
NZ, sovereign required    → Catalyst Cloud or Datacom
NZ, standard              → AWS ap-southeast-6 (zero extra engineering)
Dev / prototype           → Nebius spot or local mesh
```

**Data staging co-location:** Artifact storage (LoRA adapters, eval outputs) should be co-located with compute to avoid cross-region egress:
- Nebius workloads → Nebius Object Storage (S3-compat, same region)
- AWS workloads → S3 in same region (ap-southeast-2 for AU, ap-southeast-6 for NZ)
- Micron21 workloads → coordinate with Micron21 on storage options (likely their own NAS/object store)
- Firmus workloads → TBD pending early-access agreement

---

## Immediate next actions (ordered)

1. **Email Micron21 solutions team this week** — H100 pricing quote + IRAP scope + API/provisioning workflow
2. **Open Nebius sales chat** — volume agreement + us-east1 spot availability + service-account key
3. **Email Firmus** — early-access capacity agreement for GB300
4. **AWS APAC contact** — P5 Reserved Capacity in ap-southeast-2 + IRAP confirmation
5. **Catalyst Cloud email** — GPU specs + OpenStack API access
6. **Datacom cloud team** — channel partner conversation framing (not just compute)
