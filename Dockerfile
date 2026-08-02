FROM node:20-bookworm-slim

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ git \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

WORKDIR /app

COPY AGENTS.md ./AGENTS.md
COPY web/package.json web/pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile --prod=false \
  && pnpm exec playwright install --with-deps chromium \
  && pnpm store prune

COPY web/ ./

RUN pnpm build \
  && mkdir -p /app/data /app/drafts /app/logs /app/writing-guide \
  && chown -R node:node /app

USER node

ENV NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["./node_modules/.bin/tsx", "server.ts"]
