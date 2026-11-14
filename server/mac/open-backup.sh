#!/usr/bin/env bash
# Open a backup, for a real restore.
#
#   open-backup.sh FILE --to-pi          replace the live vault on the Pi with this backup
#                                        (the Pi keeps the replaced data in a folder next to it)
#   open-backup.sh FILE --extract DIR    just unpack it into DIR on this Mac
#   add  --recovery-key FILE             on another Mac: use the passphrase-protected key copy
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/common.sh"

file=${1:-}; action=${2:-}; target=""; recovery=""
[ -f "$file" ] || { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
shift 2 || true
[ "$action" != "--extract" ] || { target=${1:-}; shift || true; }
[ "${1:-}" != "--recovery-key" ] || recovery=${2:-}

decrypt() {
  if [ -n "$recovery" ]; then age -d -i "$recovery" "$file"; else identity | age -d -i - "$file"; fi
}

case $action in
  --to-pi)
    read -r -p "Replace the LIVE vault on $PI_HOST with $(basename "$file")? Type yes: " answer
    [ "$answer" = yes ] || exit 1
    decrypt | pi 'vaultctl restore --replace-live'
    ;;
  --extract)
    [ -n "$target" ] || { echo "give a folder" >&2; exit 2; }
    mkdir -p "$target" && chmod 700 "$target"
    decrypt | zstd -dc | tar -C "$target" -xf -
    echo "unpacked into $target (this is the vault's real data: delete it when done)"
    ;;
  *) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
