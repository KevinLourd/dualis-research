# Build context = the repository root (the service bundles shared logic and hosted dimensions from web/src).
FROM node:24-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@12.16.1
WORKDIR /app/wa
COPY wa/package.json wa/pnpm-lock.yaml wa/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY wa/src ./src
COPY wa/tsconfig.json wa/tsconfig.build.json ./
COPY web/src ../web/src
RUN pnpm build
ENV NODE_ENV=production AUTH_DIR=/data/auth MODELS_DIR=/data/models
CMD ["node", "dist/main.mjs"]
