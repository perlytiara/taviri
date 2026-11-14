# Shared by the Mac-side scripts (sourced, not run).
PI_HOST=${PI_HOST:-pi-vault}
PI_SSH=${PI_SSH:-ssh -o BatchMode=yes -o ConnectTimeout=10}
APP_DIR=${APP_DIR:-$HOME/Library/Application Support/pi-vault}
LOCAL_BACKUPS="$APP_DIR/backups"
KEY_SERVICE=pi-vault-backup
KEY_ACCOUNT=age-identity
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

pi() { $PI_SSH "$PI_HOST" "$@"; }

# The private backup key, read from the macOS login keychain (never written to a file).
identity() { security find-generic-password -s "$KEY_SERVICE" -a "$KEY_ACCOUNT" -w 2>/dev/null; }

newest_backup() { ls -1 "$LOCAL_BACKUPS"/vault-*.tar.zst.age 2>/dev/null | tail -1; }
