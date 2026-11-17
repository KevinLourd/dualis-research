#!/bin/bash
# The console's deploy, on the Dualis server (/srv/console/deploy-hook.sh, run by the `deploy` user's forced SSH
# command, see web/deploy/README.md). stdin = a .tgz of the Next.js standalone build + console.env. Unpacks it as a new
# release, restarts the container on it, checks it answers, else puts the previous release back. Keeps 3 releases.
set -euo pipefail
root=/srv/console
release="$root/releases/$(date -u +%Y%m%dT%H%M%S)"
previous=$(readlink "$root/current" 2>/dev/null || true)
mkdir -p "$release"
tar xzf - -C "$release"
chmod 600 "$release/console.env"

start() {
  docker rm -f dualis-console >/dev/null 2>&1 || true
  docker run -d --name dualis-console --network host --restart unless-stopped --memory 1g \
    -e NODE_ENV=production -e PORT=3000 -e HOSTNAME=127.0.0.1 -e NODE_OPTIONS=--max-old-space-size=640 \
    --env-file "$1/console.env" -v "$1:/app:ro" -w /app node:24-slim node server.js >/dev/null
}
healthy() {
  for _ in $(seq 1 40); do
    code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/sign-in || true)
    [ "$code" = 200 ] && return 0
    sleep 1
  done
  return 1
}

ln -sfn "$release" "$root/current"
start "$release"
if healthy; then
  echo "console: healthy on $(basename "$release")"
  ls -dt "$root"/releases/* | tail -n +4 | xargs -r rm -rf
else
  echo "console: NOT healthy on $(basename "$release"), last logs:"
  docker logs --tail 30 dualis-console 2>&1 || true
  if [ -n "$previous" ] && [ -d "$previous" ]; then
    ln -sfn "$previous" "$root/current"
    start "$previous"
    healthy && echo "console: rolled back to $(basename "$previous")"
  fi
  exit 1
fi
