# Reverse proxy + static file server for Job Manager.
# - /etc/nginx/templates/*.template are rendered with ${DOMAIN} etc. on start
#   (built-in feature of the official nginx image).
# - docker-entrypoint.d scripts create a placeholder TLS cert when none exists
#   yet (so nginx can boot before Let's Encrypt runs) and reload nginx
#   periodically so renewed certificates are picked up.
FROM nginx:1.27-alpine

RUN apk add --no-cache openssl

COPY templates/ /etc/nginx/templates/
COPY entrypoint/ /docker-entrypoint.d/
# Strip CRLF (in case the repo was checked out on Windows) and make executable.
RUN sed -i 's/\r$//' /docker-entrypoint.d/*.sh /etc/nginx/templates/*.template \
 && chmod +x /docker-entrypoint.d/*.sh \
 && rm -f /etc/nginx/conf.d/default.conf \
 && mkdir -p /var/www/certbot
