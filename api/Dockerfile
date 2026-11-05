# skolia-api on Node. Build from the repo root (it needs the pnpm workspace and shared/):
#   docker build -f api/Dockerfile .
# Node runs the TypeScript directly (type stripping), so there's no build step.
FROM node:24.18.1-slim

RUN npm install -g pnpm@11.20.0

WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared ./shared
COPY api/package.json ./api/
RUN pnpm install --frozen-lockfile --prod --filter @skolia/api...

COPY api/src ./api/src
COPY api/migrations ./api/migrations

WORKDIR /app/api
ENV HOST=0.0.0.0 PORT=8787
EXPOSE 8787
CMD ["node", "src/node/main.ts"]
