# Deploying to an Ubuntu VPS

```
Internet ──► :80/:443  nginx ──┬── /            static files  (client_dist volume)
                               └── /api/*  ───► server:4000   (Express + SQLite)
             client  (one-shot) builds React → copies dist/ into client_dist, exits
             certbot            renews the Let's Encrypt certificate every 12h
```

Only nginx is published on the host. The API is reachable only on the internal
compose network.

## 1. Prepare the server (once)

```bash
# Docker Engine + compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # log out and back in

# Firewall
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw enable
```

Make sure nothing else on the host is using ports 80/443. If a host nginx or
apache is installed, stop it: `sudo systemctl disable --now nginx apache2`.

Point DNS at the VPS: an **A record** for your domain (and any `EXTRA_DOMAINS`,
e.g. `www`) → the VPS public IP. Check it with `dig +short your.domain`.

## 2. Get the code and configure

```bash
git clone <repo-url> jobmanager && cd jobmanager
cp .env.example .env
nano .env        # set DOMAIN, LETSENCRYPT_EMAIL, SESSION_SECRET (openssl rand -hex 32)
```

## 3. First deploy (builds everything and issues the TLS certificate)

```bash
./deploy/init-letsencrypt.sh
```

Tip: set `LETSENCRYPT_STAGING=1` for a first trial run, then set it back to `0`
and run `./deploy/init-letsencrypt.sh --force`.

Open `https://your.domain`.

## 4. Later deploys

```bash
git pull
docker compose up -d --build
```

The `client` container rebuilds the frontend and refreshes the `client_dist`
volume, then nginx serves the new files. `index.html` is sent with
`Cache-Control: no-cache`, so browsers pick up the new build right away.

## Useful commands

```bash
docker compose ps                    # status (client shows "Exited (0)" — that's expected)
docker compose logs -f server nginx  # logs
docker compose restart server
docker compose exec nginx nginx -t   # validate nginx config
```

## Data and backups

- SQLite database: `./server/data/` on the host (bind-mounted). Back it up with
  e.g. `cp server/data/job-manager.db ~/backup-$(date +%F).db` (stop the server
  first, or use `sqlite3 .backup`, for a consistent copy).
- Certificates live in the `certbot_conf` Docker volume. Don't run
  `docker compose down -v` unless you want to wipe certificates and the built
  frontend (the database is safe — it's a bind mount).
