FROM node:20-bookworm-slim AS build

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ARG PNPM_VERSION=10.32.1

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ git \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare "pnpm@${PNPM_VERSION}" --activate

WORKDIR /app

COPY web/package.json web/pnpm-lock.yaml ./
COPY web/scripts/postinstall.cjs ./scripts/postinstall.cjs

RUN pnpm install --frozen-lockfile --prod=false \
  && pnpm exec playwright install chromium

COPY web/ ./

RUN pnpm build \
  && pnpm prune --prod

FROM node:20-bookworm-slim AS runtime

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ARG PNPM_VERSION=10.32.1

RUN corepack enable \
  && corepack prepare "pnpm@${PNPM_VERSION}" --activate

WORKDIR /app

COPY --from=build /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build /app/node_modules ./node_modules

RUN pnpm exec playwright install-deps chromium \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /ms-playwright /ms-playwright
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
# 后端运行时直接导入共享 DSL，前端构建产物不能替代这些源模块。
COPY --from=build /app/shared ./shared
COPY --from=build /app/server.ts ./server.ts
COPY --from=build /app/tsconfig.json /app/tsconfig.node.json /app/tsconfig.server.json ./
COPY AGENTS.md ./AGENTS.md

RUN mkdir -p /app/data /app/drafts /app/logs /app/writing-guide \
  && chown -R node:node /app /ms-playwright

USER node

ENV NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["./node_modules/.bin/tsx", "server.ts"]
