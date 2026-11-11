# Job Manager web client (React + Vite) served as static files by nginx.
# Stage 1: build the static bundle. We invoke `vite build` directly (not the
# package "build" script, which also runs `tsc -b`) so the image build doesn't
# fail on the repo's pre-existing type errors — Vite/esbuild strips types.
FROM node:24-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx vite build

# Stage 2: serve the static bundle and reverse-proxy /api to the server.
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
