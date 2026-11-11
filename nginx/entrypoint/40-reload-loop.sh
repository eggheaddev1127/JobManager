#!/bin/sh
# Reload nginx every 6 hours so certificates renewed by the certbot container
# are picked up without a restart.
(
  while :; do
    sleep 6h
    nginx -s reload 2>/dev/null || true
  done
) &
