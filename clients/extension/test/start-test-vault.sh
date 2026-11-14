#!/bin/zsh
# Starts the throwaway Vaultwarden used by the Smartfill tests: https://127.0.0.1:8470, fake data only,
# self-signed certificate, no web vault, no icon downloads (no outbound requests).
# Build it first (see test/README.md); data lives in ~/vaultwarden-test/data.
VW="${SMARTFILL_VW_DIR:-~/vaultwarden-test}"
mkdir -p "$VW/data"
cd "$VW" || exit 1
exec env ROCKET_ADDRESS=127.0.0.1 ROCKET_PORT=8470 \
  ROCKET_TLS="{certs=\"$VW/tls/cert.pem\",key=\"$VW/tls/key.pem\"}" \
  DATA_FOLDER="$VW/data" DOMAIN=https://127.0.0.1:8470 \
  WEB_VAULT_ENABLED=false SIGNUPS_ALLOWED=true PASSWORD_HINTS_ALLOWED=false \
  DISABLE_ICON_DOWNLOAD=true LOG_LEVEL=warn \
  "$VW/target/release/vaultwarden"
