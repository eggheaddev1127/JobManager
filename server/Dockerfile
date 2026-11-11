# Job Manager API (Express + node:sqlite).
# Runs via tsx (not a tsc build) — node:sqlite needs Node 22.5+, and running
# the TypeScript directly mirrors the dev setup and avoids the repo's
# pre-existing tsc type errors. bcryptjs/node:sqlite are pure-JS / built-in,
# so no native build toolchain is required.

# Fetch the static Tectonic binary (LaTeX engine used for resume PDFs).
FROM debian:bookworm-slim AS tectonic
ARG TARGETARCH
ARG TECTONIC_VERSION=0.15.0
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && case "${TARGETARCH:-amd64}" in \
      amd64) ARCH=x86_64 ;; \
      arm64) ARCH=aarch64 ;; \
      *) echo "unsupported arch: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && curl -fsSL "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-${ARCH}-unknown-linux-musl.tar.gz" \
    | tar -xz -C /usr/local/bin tectonic \
 && /usr/local/bin/tectonic --version

FROM node:24-slim

# Tectonic downloads its TeX bundle over HTTPS on first use.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=tectonic /usr/local/bin/tectonic /usr/local/bin/tectonic

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
ENV HOST=0.0.0.0
ENV PORT=4000

EXPOSE 4000

CMD ["npx", "tsx", "src/index.ts"]
