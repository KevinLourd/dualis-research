#!/bin/bash
# Forced command of the GitHub deploy key on the box (authorized_keys: command="/root/dualis-wa/deploy-hook.sh").
# stdin = a tar.gz of wa/ + the shared web files + wa/box.env (written by CI from repo secrets).
# Rebuilds and restarts the container only when the shipped code changed, so a merge elsewhere does not drop the
# WhatsApp connection.
set -euo pipefail
ROOT=/root/dualis-wa
cd "$ROOT"
exec 9>"$ROOT/.lock"
flock -w 600 9
rm -rf incoming && mkdir incoming
tar xzf - -C incoming
install -m 600 incoming/wa/box.env "$ROOT/.env"
rm incoming/wa/box.env
# Code AND env: a rotated secret must recreate the container too.
hash=$( (cd incoming && find . -type f -print0 | sort -z | xargs -0 sha256sum; sha256sum < "$ROOT/.env") | sha256sum | cut -d' ' -f1)
if [ -f .deployed ] && [ "$(cat .deployed)" = "$hash" ] && [ "$(docker inspect -f '{{.State.Running}}' dualis-wa 2>/dev/null)" = "true" ]; then
  rm -rf incoming
  echo "unchanged ($hash), container running: nothing to do"
  exit 0
fi
rm -rf src && mv incoming src
nice -n 10 docker compose -p dualis-wa -f src/wa/docker-compose.yml build
docker compose -p dualis-wa -f src/wa/docker-compose.yml up -d
echo "$hash" > .deployed
sleep 5
docker ps --filter name=dualis-wa --format '{{.Names}} {{.Status}}'
docker logs --tail 5 dualis-wa 2>&1 | grep -a '^\[wa\]' || true
