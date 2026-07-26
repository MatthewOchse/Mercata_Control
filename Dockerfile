# Mercata Control Plane — production image (Next.js standalone)
#
# On Caesar:
#   cd ~/caesar/control && docker compose build && docker compose up -d

FROM node:22-bookworm-slim AS base

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ─── Dependencies ─────────────────────────────────────────────────────────────

FROM base AS deps

COPY package.json package-lock.json ./

RUN npm config set fetch-retries 10 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && npm ci --include=dev

# ─── Build ────────────────────────────────────────────────────────────────────

FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# Build-time placeholders — runtime uses real env from compose.
ENV DATABASE_URL=mysql://build:build@127.0.0.1:3306/mercata_control
ENV SESSION_SECRET=build-time-placeholder-not-used
ENV ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

RUN npm run build

# ─── Tools (migrate / seed) ───────────────────────────────────────────────────

FROM base AS tools

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json

ENV NODE_ENV=production

# ─── Runtime ──────────────────────────────────────────────────────────────────

FROM base AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/assets ./assets
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Native modules used via serverExternalPackages
COPY --from=builder /app/node_modules/argon2 ./node_modules/argon2

RUN mkdir -p /app/storage/invoices /app/storage/business-files /app/storage/caddy-snapshots \
  && chown -R nextjs:nodejs /app/storage

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
