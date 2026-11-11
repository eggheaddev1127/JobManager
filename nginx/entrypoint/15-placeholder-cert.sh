#!/bin/sh
# Create a self-signed placeholder certificate if Let's Encrypt hasn't issued
# one yet, so nginx can start (and serve the ACME challenge on port 80).
# deploy/init-letsencrypt.sh replaces it with a real certificate.
set -eu

: "${DOMAIN:?DOMAIN must be set}"
LIVE="/etc/letsencrypt/live/${DOMAIN}"

if [ ! -f "${LIVE}/fullchain.pem" ] || [ ! -f "${LIVE}/privkey.pem" ]; then
  echo "15-placeholder-cert: no certificate for ${DOMAIN}, creating a self-signed placeholder"
  mkdir -p "${LIVE}"
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout "${LIVE}/privkey.pem" \
    -out "${LIVE}/fullchain.pem" \
    -subj "/CN=${DOMAIN}" >/dev/null 2>&1
  touch "${LIVE}/.placeholder"
fi
