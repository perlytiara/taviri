#!/usr/bin/env bash
# Save the OLD Vaultwarden's data (the one that ran on port 8222) before anything on the Pi changes.
# Copies /opt/vaultwarden (settings) and /opt/vaultwarden-data to this Mac, encrypted with the
# backup key, next to the other backups. Reads only: nothing on the Pi is stopped, moved or deleted.
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/common.sh"
identity >/dev/null || { echo "make the backup key first: backup-key.sh init (it works before the Pi is set up)" >&2; exit 1; }
mkdir -p "$LOCAL_BACKUPS"
out="$LOCAL_BACKUPS/old-vaultwarden-$(date +%Y%m%d-%H%M%S).tar.zst.age"
public=$(identity | age-keygen -y)

pi 'cd /opt && ls -d vaultwarden vaultwarden-data >/dev/null && tar -cf - vaultwarden vaultwarden-data' \
  | zstd -q -10 | age -r "$public" -o "$out.partial"
mv "$out.partial" "$out"

# Prove the copy opens and the database inside is whole.
check=$(mktemp -d); trap 'rm -rf "$check"' EXIT
identity | age -d -i - "$out" | zstd -dc | tar -C "$check" -xf -
db="$check/vaultwarden-data/db.sqlite3"
[ -f "$db" ] || { echo "no database in the copy: look at $out by hand" >&2; exit 1; }
[ "$(sqlite3 "$db" 'PRAGMA integrity_check;')" = ok ] || { echo "the copied database is damaged" >&2; exit 1; }
echo "saved $out ($(stat -f %z "$out") bytes)"
sqlite3 "$db" "select 'accounts: '||count(*) from users; select 'items: '||count(*) from ciphers; select 'attachments: '||count(*) from attachments; select 'last item change: '||coalesce(max(updated_at),'never') from ciphers;"
