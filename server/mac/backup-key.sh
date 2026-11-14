#!/usr/bin/env bash
# The key that opens the vault's backups.
#
# The private half lives only in this Mac's login keychain. The Pi gets the public half:
# it can write backups but cannot read them, and neither can the cloud storage or anyone who
# finds the backup disk.
#
#   backup-key.sh init            make the key (once) and install its public half on the Pi
#   backup-key.sh public          print the public half
#   backup-key.sh recovery-copy   save a passphrase-protected copy next to the backups
#                                 (YOU type the passphrase; without this copy or a paper copy,
#                                  losing this Mac means losing the backups)
#   backup-key.sh show            print the private key, for a paper copy in a safe place
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/common.sh"
command -v age-keygen >/dev/null || { echo "age is missing: brew install age" >&2; exit 1; }

case "${1:-}" in
  init)
    if identity >/dev/null; then
      echo "a backup key is already in the keychain; keeping it"
    else
      key=$(age-keygen 2>/dev/null | grep '^AGE-SECRET-KEY-')
      # Through `security -i` so the key never appears in a process list.
      printf 'add-generic-password -U -s %s -a %s -l pi-vault-backup-key -T /usr/bin/security -w %s\n' \
        "$KEY_SERVICE" "$KEY_ACCOUNT" "$key" | security -i >/dev/null
      unset key
      identity >/dev/null || { echo "could not store the key in the keychain" >&2; exit 1; }
      echo "new backup key stored in the login keychain (item: pi-vault-backup-key)"
    fi
    public=$(identity | age-keygen -y)
    echo "$public" | pi 'cat > /etc/pi-vault/backup-recipients.txt'
    echo "public half installed on the Pi: $public"
    ;;
  public)
    identity | age-keygen -y
    ;;
  recovery-copy)
    [ -t 0 ] || { echo "run this in a terminal: you type the passphrase yourself" >&2; exit 1; }
    mkdir -p "$LOCAL_BACKUPS"
    out="$LOCAL_BACKUPS/backup-key.recovery.age"
    echo "Choose a passphrase you will still know in ten years (it is asked twice)."
    identity | age -p -o "$out"
    echo "saved $out; the next backup copy run puts it on the backup disk and the cloud copy too"
    ;;
  show)
    [ -t 1 ] || { echo "prints a secret: run it in a terminal, not into a file or a pipe" >&2; exit 1; }
    identity
    ;;
  *)
    sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
    ;;
esac
