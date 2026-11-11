# Job Manager API (Express + node:sqlite).
# Runs via tsx (not a tsc build) — node:sqlite needs Node 22.5+, and running
# the TypeScript directly mirrors the dev setup and avoids the repo's
# pre-existing tsc type errors. bcryptjs/node:sqlite are pure-JS / built-in,
# so no native build toolchain is required.
FROM node:24-slim

WORKDIR /app

# Install dependencies first for better layer caching. tsx is a devDependency,
# so we keep dev deps (default npm ci behaviour).
COPY package.json package-lock.json ./
RUN npm ci

# App source.
COPY tsconfig.json ./
COPY src ./src

# SQLite database lives here; mount a volume to persist it across restarts.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV NODE_NO_WARNINGS=1
ENV PORT=4000

EXPOSE 4000

CMD ["npx", "tsx", "src/index.ts"]
