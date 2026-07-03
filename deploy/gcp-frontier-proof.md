# Prove frontier on GCP — runbook

Spin up an L4 GPU mesh node on GCP, prove the sovereign mesh matches a frontier model
(Claude / GPT) head-to-head, keep the artifact, tear the node down. One command.

## What runs where
```
your laptop ──(gcloud)──▶ GCP L4 GPU node (g2-standard-8, Spot)
                              cloud-init.sh: NVIDIA driver + Ollama :11434 + pull model
   client-proof.sh ──(MESH_URL=http://<node>:11434/v1)──▶ node  ── vs ──▶  Claude / GPT APIs
   → prints the scoreboard, writes the proof artifact, then auto-teardown (trap on exit)
```

## Preconditions (you provide the credentials — the scripts hold none)
```bash
gcloud auth login
export GCP_PROJECT=<your-project-id>          # or: gcloud config set project <id>
# Ensure an L4 quota in the zone: Console → IAM → Quotas → "NVIDIA L4 GPUs" ≥ 1 (region of GCP_ZONE)
export ANTHROPIC_API_KEY=...                  # adds a live Claude arm  (optional)
export OPENAI_API_KEY=...                     # adds a live GPT arm     (optional)
```
Without the API keys the proof still runs — mesh-only (no head-to-head). With them, it scores the
mesh against the live frontier models.

## Run
```bash
cd agent-machine
./scripts/gcp-prove-frontier.sh 8          # 8 = number of head-to-head problems
```

## Tunables (env)
| Var | Default | Meaning |
|---|---|---|
| `GCP_PROJECT` | gcloud config | target project |
| `GCP_ZONE` | `us-central1-a` | must have L4 quota |
| `MESH_SKU` | `g2-standard-8` | L4 GPU machine (G2 bundles one L4) |
| `MESH_MODEL` | `qwen2.5-coder:7b` | model the node serves |
| `MESH_SPOT` | `1` | Spot VM (cheapest); `0` = on-demand |
| `MESH_NODE` | `noetica-proof` | instance name |

## Safety
- The node's `:11434` is firewalled to **your laptop's public IP only**.
- A teardown trap deletes the instance **and** the firewall rule on any exit (success, error, Ctrl-C) —
  no lingering GPU spend. If the script is killed hard, tear down manually:
  ```bash
  gcloud compute instances delete noetica-proof --zone us-central1-a --quiet
  gcloud compute firewall-rules delete noetica-proof-ollama --quiet
  ```

## This is the proof, not the platform
This stands up a *throwaway* GPU node to prove frontier tonight. The durable mesh (GKE / hybrid /
multi-tenant) is the next build — this validates the head-to-head first, cheaply.
