#!/usr/bin/env bash
# Copies the backend's secrets from backend/.env (and the service-account key file) into
# Google Secret Manager for the Cloud Functions deploy. Nothing is printed.
# Run from the project root:  bash backend/scripts/set-secrets.sh
set -euo pipefail
cd "$(dirname "$0")/.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

val() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | tr -d '\r' | sed -E 's/^"(.*)"$/\1/' | tr -d '\n'; }

sa="$(val GOOGLE_APPLICATION_CREDENTIALS)"
node -e "process.stdout.write(JSON.stringify(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))))" "$sa" > "$tmp/SERVICE_ACCOUNT_JSON"
for k in SMTP_PASS FILE_TOKEN_SECRET LIVEKIT_API_SECRET; do val "$k" > "$tmp/$k"; done

cd ..
for k in SERVICE_ACCOUNT_JSON SMTP_PASS FILE_TOKEN_SECRET LIVEKIT_API_SECRET; do
  if [ ! -s "$tmp/$k" ]; then echo "skip $k (empty)"; continue; fi
  firebase functions:secrets:set "$k" --data-file "$tmp/$k" --project prod --non-interactive --force >/dev/null
  echo "set $k"
done
