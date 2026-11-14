#!/usr/bin/env bash
# Copy the Mac-side helpers to the internal disk, so the daily backup copy keeps working while
# the disk that holds this folder is unplugged. Run again after changing anything in mac/.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
. "$here/common.sh"
mkdir -p "$APP_DIR/bin"
for name in common.sh pull-backups.sh restore-test.sh vault-status.sh backup-key.sh open-backup.sh backup-old-vaultwarden.sh; do
  install -m 755 "$here/$name" "$APP_DIR/bin/$name"
done
echo "installed to $APP_DIR/bin"
