#!/usr/bin/env bash
# Fetch the Pi's encrypted backups and copy them to the backup disk and the cloud copy.
# Runs every day from a launch agent; safe to run by hand. Only ever copies ciphertext.
set -uo pipefail
. "$(cd "$(dirname "$0")" && pwd)/common.sh"

METAL_VOLUME=${METAL_VOLUME:-/Volumes/Backup}
METAL_DIR="$METAL_VOLUME/Taviri Backups"
DRIVE_REMOTE=${DRIVE_REMOTE:-none}  # an rclone remote:path, or none
RCLONE_CONFIG_FILE="$HOME/.config/rclone/offload.conf"
STATE="$APP_DIR/offsite.json"
LOG="$HOME/Library/Logs/pi-vault-backups.log"
KEEP_ON_MAC=60

mkdir -p "$LOCAL_BACKUPS"
log() { echo "$(date '+%F %T') $*" >> "$LOG"; echo "$*"; }
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
[ -f "$STATE" ] || echo '{}' > "$STATE"
mark() { jq --arg key "$1" --arg when "$(now)" '.[$key] = $when' "$STATE" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"; }

if ! rsync -a --timeout=120 -e "$PI_SSH" --include 'vault-*.tar.zst.age' --exclude '*' \
     "$PI_HOST:/var/backups/pi-vault/" "$LOCAL_BACKUPS/" 2>>"$LOG"; then
  log "could not reach the Pi; nothing copied"
  exit 1
fi
newest=$(newest_backup)
[ -n "$newest" ] || { log "the Pi has no backups yet"; exit 1; }
log "newest backup: $(basename "$newest")"

if [ -d "$METAL_VOLUME" ]; then
  if mkdir -p "$METAL_DIR" && rsync -a --include '*.age' --exclude '*' "$LOCAL_BACKUPS/" "$METAL_DIR/" 2>>"$LOG" \
     && cmp -s "$newest" "$METAL_DIR/$(basename "$newest")"; then
    mark metal; log "backup disk: up to date"
  else
    log "backup disk: copy FAILED"
  fi
else
  log "backup disk: disk not connected, skipped"
fi

if [ "$DRIVE_REMOTE" = none ]; then
  log "cloud copy: skipped"
elif rclone copy --config "$RCLONE_CONFIG_FILE" --include '*.age' "$LOCAL_BACKUPS" "$DRIVE_REMOTE" 2>>"$LOG" \
   && rclone check --config "$RCLONE_CONFIG_FILE" --one-way --include "$(basename "$newest")" \
        "$LOCAL_BACKUPS" "$DRIVE_REMOTE" >>"$LOG" 2>&1; then
  mark drive; log "cloud copy: up to date"
else
  log "cloud copy: copy FAILED"
fi

# Tell the Pi, so its health page shows how fresh the copies are.
pi 'cat > /var/lib/pi-vault/offsite.json' < "$STATE" 2>>"$LOG" || true

# This Mac keeps the newest copies only; the backup disk and the cloud copy keep everything.
ls -1t "$LOCAL_BACKUPS"/vault-*.tar.zst.age | tail -n +$((KEEP_ON_MAC + 1)) | while read -r old; do rm -f "$old"; done
