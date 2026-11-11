#!/bin/sh
# First-time deploy: build + start the stack, then replace nginx's placeholder
# certificate with a real Let's Encrypt one.
#
#   ./deploy/init-letsencrypt.sh           # issue a certificate
#   ./deploy/init-letsencrypt.sh --force   # re-issue even if one exists
#
# Requires: .env with DOMAIN and LETSENCRYPT_EMAIL, DNS A record(s) for DOMAIN
# (and EXTRA_DOMAINS) pointing at this server, and ports 80/443 open.
set -eu

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Missing .env — copy .env.example to .env and fill it in." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
. ./.env
set +a

: "${DOMAIN:?DOMAIN must be set in .env}"
: "${LETSENCRYPT_EMAIL:?LETSENCRYPT_EMAIL must be set in .env}"
EXTRA_DOMAINS="${EXTRA_DOMAINS:-}"
STAGING="${LETSENCRYPT_STAGING:-0}"
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

echo "### Building and starting the stack (nginx boots with a placeholder cert)…"
docker compose up -d --build

if [ "$FORCE" -eq 0 ] && docker compose exec -T nginx test -f "/etc/letsencrypt/renewal/${DOMAIN}.conf"; then
  echo "### A Let's Encrypt certificate for ${DOMAIN} already exists. Use --force to re-issue."
  exit 0
fi

echo "### Removing placeholder certificate for ${DOMAIN}…"
docker compose run --rm --entrypoint sh certbot -c "\
  rm -rf /etc/letsencrypt/live/${DOMAIN} \
         /etc/letsencrypt/archive/${DOMAIN} \
         /etc/letsencrypt/renewal/${DOMAIN}.conf"

DOMAIN_ARGS="-d ${DOMAIN}"
for d in $EXTRA_DOMAINS; do
  DOMAIN_ARGS="${DOMAIN_ARGS} -d ${d}"
done

STAGING_ARG=""
[ "$STAGING" != "0" ] && STAGING_ARG="--staging"

echo "### Requesting Let's Encrypt certificate for: ${DOMAIN} ${EXTRA_DOMAINS}"
# shellcheck disable=SC2086
docker compose run --rm --entrypoint certbot certbot certonly \
  --webroot -w /var/www/certbot \
  ${STAGING_ARG} \
  ${DOMAIN_ARGS} \
  --email "${LETSENCRYPT_EMAIL}" \
  --rsa-key-size 4096 \
  --agree-tos --no-eff-email --non-interactive \
  --cert-name "${DOMAIN}"

echo "### Reloading nginx…"
docker compose exec -T nginx nginx -s reload

echo "### Done: https://${DOMAIN}"
