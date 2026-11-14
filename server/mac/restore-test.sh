#!/usr/bin/env bash
# Prove the newest backup can be restored: decrypt it here, start a throw-away server on it
# on the Pi, check it, and throw it away. The live vault is not touched.
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/common.sh"

"$(dirname "$0")/pull-backups.sh" >/dev/null 2>&1 || true
file=${1:-$(newest_backup)}
[ -n "$file" ] && [ -f "$file" ] || { echo "no backup found in $LOCAL_BACKUPS" >&2; exit 1; }
identity >/dev/null || { echo "no backup key in the keychain (backup-key.sh init)" >&2; exit 1; }
echo "testing $(basename "$file")"
identity | age -d -i - "$file" | pi 'vaultctl restore-test'
