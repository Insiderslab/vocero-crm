ARG NODE_IMAGE=docker.io/library/node:22-alpine@sha256:025b8e975a61d94e33abeafaad1255ef44e4898cf1a1b6446860009c72e6d284

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_PRIVATE_BUILD_WORKER=1 NODE_OPTIONS=--max-old-space-size=1400
ARG SOURCE_COMMIT=""
ENV SOURCE_COMMIT=${SOURCE_COMMIT}
RUN node -e 'const fs=require("node:fs");const p="next.config.ts";const s=fs.readFileSync(p,"utf8");const n="const nextConfig: NextConfig = {";if(s.split(n).length!==2)throw new Error("unexpected next.config.ts structure");fs.writeFileSync(p,s.replace(n,n+"\n  experimental: { cpus: 1 },"));'
RUN pnpm build
RUN pnpm exec esbuild scripts/migrate.mjs --bundle --platform=node --format=esm --outfile=migrate.bundle.mjs \
    --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);"

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ARG SOURCE_MANIFEST_SHA256
LABEL heili.source-manifest=${SOURCE_MANIFEST_SHA256}
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S vocero && adduser -S vocero -G vocero && mkdir -p /data/media && chown -R vocero:vocero /data
COPY --from=builder --chown=vocero:vocero /app/.next/standalone ./
COPY --from=builder --chown=vocero:vocero /app/.next/static ./.next/static
COPY --from=builder --chown=vocero:vocero /app/public ./public
COPY --from=builder --chown=vocero:vocero /app/migrate.bundle.mjs ./migrate.mjs
COPY --from=builder --chown=vocero:vocero /app/drizzle ./drizzle
USER vocero
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["sh", "-c", "node migrate.mjs && node server.js"]
