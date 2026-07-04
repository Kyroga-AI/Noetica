# Build from the REPO ROOT (docker build -f agent-machine/Dockerfile .), not agent-machine/ alone —
# server.ts and several lib/*.ts files import across the agent-machine boundary into the repo root's
# own lib/governance and lib/pricing (confirmed by grepping every ../ relative import in server.ts +
# lib/*.ts; this is the exhaustive set, not a guess). Mirroring the repo's real directory layout under
# /app is far more robust than trying to enumerate every cross-boundary file by hand.
FROM node:20-slim

WORKDIR /app/agent-machine

# code_execute's Python path (lib/math_operators.py, lib/eval_sympy.py) and the CAS-grading tool
# (scripts/cas_grade.py) hard-depend on python3 + these packages — see requirements.txt's own header
# comment. build-essential (make/g++) is for node-gyp — a transitive npm dep (rocksdb, via some
# level*/abstract-leveldown chain; not a direct package.json entry) ships no prebuilt binary for this
# platform and compiles from source during npm ci.
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip build-essential && \
    rm -rf /var/lib/apt/lists/*
COPY agent-machine/requirements.txt ./
RUN pip3 install --break-system-packages --no-cache-dir -r requirements.txt

COPY agent-machine/package.json agent-machine/package-lock.json ./
RUN npm ci --omit=dev

# Everything esbuild's --bundle step needs to resolve at BUILD time: server.ts's own tree, plus the
# JSON/data files several lib/*.ts import directly (canon/academy/data), plus the two repo-root lib
# dirs that server.ts/lib/*.ts reach into across the agent-machine boundary.
COPY agent-machine/tsconfig.json agent-machine/server.ts ./
COPY agent-machine/lib ./lib
COPY agent-machine/scripts ./scripts
COPY agent-machine/canon ./canon
COPY agent-machine/academy ./academy
COPY agent-machine/data ./data
COPY lib/governance /app/lib/governance
COPY lib/pricing /app/lib/pricing

RUN npm install --save-dev esbuild tsx typescript && \
    npm run build && \
    npm prune --omit=dev

# config/ is read at RUNTIME (not needed for the build above) via server.ts's own
# join(__dirname, 'config', ...) — no '..', since server.ts sits beside config/ pre-bundle. esbuild
# bundles everything into one dist/server.js, so Node's native __dirname for every __dirname reference
# in the bundle — regardless of which source file it originally came from — resolves to dist/ (the
# bundle's own location). That means config/ needs to be nested INSIDE dist/ to match, unlike
# canon/academy/data above (already handled correctly since those were needed pre-bundle anyway).
COPY agent-machine/config ./dist/config

EXPOSE 8080

CMD ["node", "dist/server.js"]
