# Deploying to an Ubuntu VPS (HTTP on the public IP)

```
Internet ──► http://<server-ip>:80  nginx ──┬── /            static files  (client_dist volume)
                                            └── /api/*  ───► server:4000   (Express + SQLite)
             client  (one-shot) builds React → copies dist/ into client_dist, exits
```

Only nginx is published on the host. The API is reachable only on the internal
compose network.

> Plain HTTP means passwords and session cookies travel unencrypted. Fine for a
> trial or a private network; add a domain + HTTPS before real use.

## 1. Prepare the server (once)

```bash
# Docker Engine + compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # log out and back in

# Firewall
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw enable
```

Make sure nothing else on the host uses port 80. If a host nginx or apache is
installed, stop it: `sudo systemctl disable --now nginx apache2` — or set
`HTTP_PORT` in `.env` to another port (and open that port in ufw instead).

Also check your VPS provider's firewall / security group allows inbound TCP 80.

## 2. Get the code and configure

```bash
git clone <repo-url> jobmanager && cd jobmanager
cp .env.example .env
sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 32)/" .env
```

## 3. Deploy

```bash
docker compose up -d --build
```

Open `http://<server-ip>` (or `http://<server-ip>:<HTTP_PORT>`).

Later deploys: `git pull && docker compose up -d --build`. The `client`
container rebuilds the frontend and refreshes the `client_dist` volume;
`index.html` is sent with `Cache-Control: no-cache`, so browsers pick up the
new build right away.

## Useful commands

```bash
docker compose ps                    # status (client shows "Exited (0)" — expected)
docker compose logs -f server nginx  # logs
docker compose restart server
docker compose exec nginx nginx -t   # validate nginx config
curl -s http://localhost/api/health  # quick check from the VPS
```

## Data and backups

- SQLite database: `./server/data/` on the host (bind-mounted). Back it up with
  e.g. `cp server/data/job-manager.db ~/backup-$(date +%F).db` (stop the server
  first, or use `sqlite3 .backup`, for a consistent copy).
- `docker compose down -v` deletes the built-frontend and TeX-cache volumes
  (both are rebuilt automatically); the database is safe — it's a bind mount.

## Adding a domain + HTTPS later

Point an A record at the IP, put certbot (or a host-level Caddy/nginx) in front
for TLS, and set `COOKIE_SECURE=true` in `.env` so the session cookie is
HTTPS-only.
