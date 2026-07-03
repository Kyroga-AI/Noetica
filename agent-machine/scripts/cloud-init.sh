#!/usr/bin/env bash
# cloud-init.sh — GPU mesh-node bootstrap for the frontier proof.
#
# Runs as root on first boot (GCE `startup-script`, or --user-data on other clouds). It brings up an
# OpenAI-compatible inference endpoint the proof harness can point MESH_URL at:
#   1. ensures an NVIDIA driver (a no-op on GCP's `common-gpu-*` images, which ship the driver),
#   2. installs Ollama and serves it on 0.0.0.0:11434,
#   3. pre-pulls the proof model (read from instance metadata `mesh-model`, default qwen2.5-coder:7b).
#
# When ready it writes /var/run/mesh-ready and the model is loadable at http://<node>:11434/v1.
# Referenced by lib/cloud-provision.ts createCommand() and scripts/gcp-prove-frontier.sh.
set -euxo pipefail

# Model to serve — pass via GCE metadata `mesh-model`; fall back to the proof default.
MODEL="$(curl -s -H 'Metadata-Flavor: Google' \
  http://metadata.google.internal/computeMetadata/v1/instance/attributes/mesh-model 2>/dev/null || true)"
MODEL="${MODEL:-${MESH_MODEL:-qwen2.5-coder:7b}}"

# 1. NVIDIA driver. Driver-ready images (ubuntu-accelerator) already have it — skip. On stock RHEL 9
#    (our default) install it: EPEL for dkms, matching kernel headers, then the NVIDIA CUDA-repo driver.
#    Falls back to GCP's cross-distro installer if the dnf path doesn't land nvidia-smi.
if ! command -v nvidia-smi >/dev/null 2>&1 && command -v dnf >/dev/null 2>&1; then
  dnf install -y dnf-plugins-core || true
  dnf install -y "https://dl.fedoraproject.org/pub/epel/epel-release-latest-9.noarch.rpm" || dnf install -y epel-release || true
  dnf install -y "kernel-devel-$(uname -r)" "kernel-headers-$(uname -r)" gcc make dkms python3 || true
  dnf config-manager --add-repo https://developer.download.nvidia.com/compute/cuda/repos/rhel9/x86_64/cuda-rhel9.repo || true
  dnf clean all || true
  dnf -y module install nvidia-driver:latest-dkms || dnf -y install nvidia-driver nvidia-driver-cuda || true
  modprobe nvidia 2>/dev/null || true
fi
# Cross-distro fallback (also covers Debian/Ubuntu overrides): GCP's official GPU-driver installer.
if ! command -v nvidia-smi >/dev/null 2>&1; then
  curl -fsSL -o /tmp/install_gpu_driver.py \
    https://raw.githubusercontent.com/GoogleCloudPlatform/compute-gpu-installation/main/linux/install_gpu_driver.py || true
  python3 /tmp/install_gpu_driver.py || true
fi
nvidia-smi || echo "[cloud-init] WARN: no GPU driver — ollama will fall back to CPU (slower, still runs)"

# 2. Ollama, served on all interfaces so the (firewalled) proof client can reach it.
curl -fsSL https://ollama.com/install.sh | sh
mkdir -p /etc/systemd/system/ollama.service.d
cat >/etc/systemd/system/ollama.service.d/override.conf <<'OVERRIDE'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
OVERRIDE
systemctl daemon-reload
systemctl enable --now ollama

# 3. Wait for the daemon, then pull the model so /v1/models reports it ready.
for _ in $(seq 1 40); do
  curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break
  sleep 3
done
ollama pull "$MODEL"

touch /var/run/mesh-ready
echo "[cloud-init] mesh ready — serving ${MODEL} on 0.0.0.0:11434"
