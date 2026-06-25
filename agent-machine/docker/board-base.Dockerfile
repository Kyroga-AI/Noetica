# board-base — the BAKED board image. Everything slow about a board VM boot (apt node, pip sci-stack, the
# ollama install AND the model pulls) is baked here so a VM boots in ~3min (pull image + code + brain) instead
# of ~10min (install everything every time). Stored in Artifact Registry; run via gcp-board-fast.sh on COS.
# Fast-changing bits (code, brain, checkpoint) are pulled at runtime by the entrypoint — NOT baked.
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive HOME=/root OLLAMA_MODELS=/root/.ollama/models

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates git gnupg python3 python3-pip apt-transport-https tar coreutils procps && \
    rm -rf /var/lib/apt/lists/*

# Node 20 (the board runs on tsx)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*

# google-cloud-cli — the entrypoint pulls code/brain/checkpoint from GCS, syncs status, and self-deletes the VM
RUN curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
      > /etc/apt/sources.list.d/google-cloud-sdk.list && \
    apt-get update && apt-get install -y google-cloud-cli && rm -rf /var/lib/apt/lists/*

# the sci-stack the board + vector/induction scripts import (sympy compute, numpy/scipy/sklearn, etc.)
RUN pip3 install --no-cache-dir numpy scipy scikit-learn sympy jsonschema pypdf gensim

# ollama + BAKE the models — this is the single biggest boot win (no 5GB model pull on every VM)
RUN curl -fsSL https://ollama.com/install.sh | sh
RUN nohup ollama serve >/var/log/ollama-build.log 2>&1 & \
    for i in $(seq 1 30); do ollama list >/dev/null 2>&1 && break; sleep 2; done && \
    ollama pull qwen2.5:7b && \
    ollama pull nomic-embed-text && \
    ollama list

COPY run-board.sh /usr/local/bin/run-board.sh
RUN chmod +x /usr/local/bin/run-board.sh
ENTRYPOINT ["/usr/local/bin/run-board.sh"]
