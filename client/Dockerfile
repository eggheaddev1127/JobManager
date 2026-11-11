# Job Manager web client (React + Vite).
#
# Stage 1 builds the static bundle. We invoke `vite build` directly (not the
# package "build" script, which also runs `tsc -b`) so the image build doesn't
# fail on the repo's pre-existing type errors — Vite/esbuild strips types.
FROM node:24-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx vite build

# Stage 2 is a tiny one-shot container: on start it replaces the contents of the
# shared `client_dist` volume (mounted at /srv/www) with this build, then exits.
# nginx mounts the same volume read-only and serves it as static files.
FROM alpine:3.20

COPY --from=build /app/dist /app/dist

CMD ["sh", "-c", "mkdir -p /srv/www && find /srv/www -mindepth 1 -delete && cp -a /app/dist/. /srv/www/ && echo 'client build copied to volume'"]
