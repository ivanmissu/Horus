# Production image: Next.js standalone server plus a small schema-sync toolchain.
# Build context is frontend/ (see docker-compose.yml).

FROM docker.1ms.run/library/node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Playwright's postinstall downloads browsers this image never runs.
RUN npm ci --ignore-scripts

FROM docker.1ms.run/library/node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_NEW_WINDOW_DAYS=7
ENV NEXT_PUBLIC_NEW_WINDOW_DAYS=$NEXT_PUBLIC_NEW_WINDOW_DAYS
RUN npm run build

FROM docker.1ms.run/library/node:22-bookworm-slim AS migrator
WORKDIR /opt/horus-migrate
RUN npm init -y \
  && npm install --no-fund --no-audit dotenv@17.3.1 drizzle-orm@0.45.2 mysql2@3.24.6 pg@8.23.1 drizzle-kit@0.31.10
COPY drizzle.config.ts ./drizzle.config.ts
COPY src/db ./src/db

FROM docker.1ms.run/library/node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV TZ=Asia/Shanghai
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid 1001 --home-dir /home/nextjs --create-home nextjs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=migrator --chown=nextjs:nodejs /opt/horus-migrate /opt/horus-migrate
COPY --chown=nextjs:nodejs docker-entrypoint.sh docker-entrypoint.cjs load-env.cjs /usr/local/bin/
# The bootstrap uses the migrator's pinned dotenv, independent of Next output tracing.
ENV NODE_PATH=/opt/horus-migrate/node_modules
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh
USER nextjs
EXPOSE 3000
ENTRYPOINT ["node", "/usr/local/bin/docker-entrypoint.cjs"]
CMD ["node", "server.js"]
