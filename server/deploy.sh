#!/usr/bin/env bash
# Copy the stack to the Pi and apply it.
#   ./deploy.sh bootstrap   first time, or after changing anything in pi/ (packages, firewall, SSH, timers)
#   ./deploy.sh             after changing the name, icon or stack: rebuild and restart
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
. "$here/mac/common.sh"
mode=${1:-apply}

echo "==> copying files to $PI_HOST"
COPYFILE_DISABLE=1 tar -C "$here" --no-xattrs --exclude __pycache__ --exclude .DS_Store -cf - stack pi | pi '
  set -e
  rm -rf /opt/pi-vault/.incoming && mkdir -p /opt/pi-vault/.incoming /opt/pi-vault/stack /opt/pi-vault/pi
  tar -C /opt/pi-vault/.incoming -xf - && chown -R root:root /opt/pi-vault/.incoming
  rsync -a --delete --exclude vault.env --exclude Caddyfile --exclude .env /opt/pi-vault/.incoming/stack/ /opt/pi-vault/stack/
  rsync -a --delete /opt/pi-vault/.incoming/pi/ /opt/pi-vault/pi/
  rm -rf /opt/pi-vault/.incoming'

case $mode in
  bootstrap)
    # Runs on the Pi as its own service, so a dropped connection cannot cut it in half.
    # First run only: this Mac's timezone for the health page, and other home-network ports to keep.
    zone=$(readlink /etc/localtime | sed 's#.*/zoneinfo/##')
    pi "command -v rsync >/dev/null || apt-get install -y -q rsync >/dev/null
        systemctl reset-failed pi-vault-bootstrap >/dev/null 2>&1 || true
        systemd-run --quiet --unit pi-vault-bootstrap --collect \\
          --setenv=PI_VAULT_TZ='$zone' \\
          --setenv=PI_VAULT_EXTRA_LAN_TCP='${PI_VAULT_EXTRA_LAN_TCP:-}' \\
          --setenv=PI_VAULT_EXTRA_LAN_UDP='${PI_VAULT_EXTRA_LAN_UDP:-}' \\
          /bin/bash -c 'bash /opt/pi-vault/pi/bootstrap.sh > /var/log/pi-vault-bootstrap.log 2>&1'"
    echo "==> setting up the Pi (log on the Pi: /var/log/pi-vault-bootstrap.log); this can take a while"
    while :; do
      sleep 30
      state=$(pi 'systemctl is-active pi-vault-bootstrap 2>/dev/null; true' 2>/dev/null)
      [ -n "$state" ] || continue          # connection hiccup: just ask again
      case $state in active|activating) continue ;; esac
      break
    done
    pi 'grep -v "Waiting for cache lock" /var/log/pi-vault-bootstrap.log | tail -n 30'
    pi 'grep -q "^Done\." /var/log/pi-vault-bootstrap.log' || { echo "the setup did not finish; see the log above" >&2; exit 1; }
    # A brand-new connection proves the firewall and SSH changes did not lock us out; only then keep them.
    $PI_SSH -o ControlPath=none "$PI_HOST" 'vaultctl confirm'
    ;;
  apply)
    pi 'install -m 755 /opt/pi-vault/pi/vaultctl /usr/local/sbin/vaultctl && vaultctl build-if-changed && vaultctl apply'
    ;;
  copy)
    pi 'install -m 755 /opt/pi-vault/pi/vaultctl /usr/local/sbin/vaultctl'
    exit 0
    ;;
  *) echo "usage: deploy.sh [bootstrap|apply|copy]" >&2; exit 2 ;;
esac
pi 'vaultctl status' || true
