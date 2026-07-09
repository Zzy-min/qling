# DRAFT — optional isolation image for Qling CLI
# Build: docker build -f packaging/docker/Dockerfile -t qling:1.0.0 .
FROM node:22-bookworm-slim

WORKDIR /app

# Build tools for better-sqlite3
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ git \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src
COPY skills ./skills
RUN npm install --no-save typescript@5.5.0 \
  && npx tsc \
  && npm uninstall typescript

ENV NODE_ENV=production \
    QLING_WORKSPACE_DIR=/workspace \
    QLING_WRITE_SANDBOX=workspace \
    QLING_GUARD_NETWORK_MODE=strict \
    QLING_FILE_STATE_DIR=/qling-state

RUN mkdir -p /workspace /qling-state \
  && ln -sf /app/dist/index.js /usr/local/bin/qling \
  && chmod +x /app/dist/index.js

WORKDIR /workspace
ENTRYPOINT ["node", "/app/dist/index.js"]
CMD ["--help"]
