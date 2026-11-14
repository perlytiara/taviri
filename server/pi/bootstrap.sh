#!/usr/bin/env bash
# Sets the Pi up for the vault. Safe to run again: it only adds what is missing.
# Run as root on the Pi (the Mac's deploy.sh copies the files and starts this).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }

ROOT=/opt/pi-vault
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_SUSPEND=1   # no service restarts behind our back while this runs
. /etc/os-release

step() { printf '\n### %s\n' "$*"; }
# Wait (up to two hours) when another package job, such as the nightly security update, is running.
apt_get() { apt-get -o DPkg::Lock::Timeout=7200 "$@"; }

step "pre-flight"
# Stop before changing anything if another program already holds a port the vault needs.
conflict=""
for port in 80 443 8732; do
  if ss -Htln "sport = :$port" | grep -q . && ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^pi-vault'; then
    echo "!! port $port is already in use:" >&2
    ss -Htlnp "sport = :$port" >&2
    conflict=yes
  fi
done
if [ -n "$conflict" ] && [ ! -f /etc/pi-vault/site.env ]; then
  echo "Free those ports first (or create /etc/pi-vault/site.env with other HTTP_PORT/HTTPS_PORT), then run this again." >&2
  exit 1
fi

step "packages"
apt_get update -q
apt_get install -y -q ca-certificates curl gnupg jq sqlite3 age zstd rsync python3 openssl argon2 \
  nftables fail2ban python3-systemd unattended-upgrades

step "docker"
if ! command -v docker >/dev/null; then
  distro=$ID; [ "$ID" = raspbian ] || [ "$ID" = ubuntu ] || distro=debian
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$distro/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$distro $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt_get update -q
  apt_get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
if ! docker compose version >/dev/null 2>&1; then
  apt_get install -y -q docker-compose-plugin || apt_get install -y -q docker-compose-v2 || apt_get install -y -q docker-compose
fi
docker compose version >/dev/null || { echo "docker compose is not available" >&2; exit 1; }
systemctl enable --now docker

step "tailscale"
if ! command -v tailscale >/dev/null; then
  curl -fsSL "https://pkgs.tailscale.com/stable/$ID/$VERSION_CODENAME.noarmor.gpg" -o /usr/share/keyrings/tailscale-archive-keyring.gpg
  curl -fsSL "https://pkgs.tailscale.com/stable/$ID/$VERSION_CODENAME.tailscale-keyring.list" -o /etc/apt/sources.list.d/tailscale.list
  apt_get update -q
  apt_get install -y -q tailscale
fi
# Never ask the router to open a port for Tailscale (UPnP/NAT-PMP): the Pi stays closed from outside.
if ! grep -q '^TS_DISABLE_PORTMAPPER=' /etc/default/tailscaled 2>/dev/null; then
  printf '\n# pi-vault: never ask the router to open a port for Tailscale.\nTS_DISABLE_PORTMAPPER=1\n' >> /etc/default/tailscaled
  systemctl restart tailscaled
fi
systemctl enable --now tailscaled

step "user and folders"
id pivault >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin pivault
install -d -m 755 /opt/pi-vault /srv/pi-vault /srv/pi-vault/status /etc/pi-vault
install -d -m 700 -o pivault -g pivault /srv/pi-vault/data
install -d -m 750 -o pivault -g pivault /var/log/pi-vault
install -d -m 700 /srv/pi-vault/caddy /srv/pi-vault/caddy/data /srv/pi-vault/caddy/config /var/backups/pi-vault /var/lib/pi-vault
[ -f /var/log/pi-vault/vaultwarden.log ] || install -m 640 -o pivault -g pivault /dev/null /var/log/pi-vault/vaultwarden.log
[ -f /etc/pi-vault/backup-recipients.txt ] || install -m 644 /dev/null /etc/pi-vault/backup-recipients.txt
install -m 755 "$ROOT/pi/vaultctl" /usr/local/sbin/vaultctl

if [ ! -f /etc/pi-vault/site.env ]; then
  dev=$(ip -4 route show default | awk '{print $5; exit}')
  cidr=$(ip -4 -o addr show dev "$dev" scope global | awk '{print $4; exit}')
  net=$(python3 -c 'import ipaddress,sys; print(ipaddress.ip_interface(sys.argv[1]).network)' "$cidr")
  zone=${PI_VAULT_TZ:-$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone)}
  cat > /etc/pi-vault/site.env <<EOF
# This Pi's settings for the vault. After a change run: vaultctl apply

# Home network and this Pi's address on it (give the Pi a fixed address in the router).
LAN_CIDR="$net"
LAN_IP="${cidr%/*}"
# Extra names for the home-network certificate, space separated.
LAN_NAMES="$(hostname).local"

# Tailnet name, filled in by: vaultctl tailscale
TS_NAME=""
TS_HOSTNAME="vault"

HTTPS_PORT="443"
HTTP_PORT="80"

# Other things this Pi serves to the home network (ports or ranges like 40000-40100, space
# separated). Never to the internet.
EXTRA_LAN_TCP="${PI_VAULT_EXTRA_LAN_TCP:-}"
EXTRA_LAN_UDP="${PI_VAULT_EXTRA_LAN_UDP:-}"

# Software versions. vaultctl update moves VW_VERSION forward by itself.
VW_VERSION="1.37.5"
CADDY_VERSION="2-alpine"
# Times on the health page are shown in this timezone.
TIMEZONE="$zone"
EOF
fi

step "image"
# Built before the firewall goes on, so the safety net below only has to cover a quick restart.
if ! docker image inspect "pi-vault/vault:$(. /etc/pi-vault/site.env; echo "$VW_VERSION")" >/dev/null 2>&1; then
  vaultctl build
fi

step "safety net"
# If the new firewall or SSH settings lock us out, this undoes them after 20 minutes.
# deploy.sh cancels it (vaultctl confirm) once a fresh SSH connection has worked.
systemctl stop pi-vault-guard.timer >/dev/null 2>&1 || true
systemctl reset-failed pi-vault-guard.service >/dev/null 2>&1 || true
systemd-run --quiet --unit pi-vault-guard --on-active=20m /bin/sh -c \
  'nft delete table inet pivault; systemctl disable pi-vault-firewall.service; rm -f /etc/ssh/sshd_config.d/00-pi-vault.conf; systemctl reload ssh || systemctl reload sshd'

step "ssh: keys only"
if [ -s /root/.ssh/authorized_keys ] || ls /home/*/.ssh/authorized_keys >/dev/null 2>&1; then
  cat > /etc/ssh/sshd_config.d/00-pi-vault.conf <<'EOF'
# pi-vault: log in with keys only.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PermitEmptyPasswords no
MaxAuthTries 4
LoginGraceTime 30
X11Forwarding no
EOF
  if sshd -t; then
    systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  else
    rm -f /etc/ssh/sshd_config.d/00-pi-vault.conf
    echo "!! sshd refused the new settings; left SSH as it was" >&2
  fi
else
  echo "!! no SSH key is installed on this Pi; password login left alone" >&2
fi

step "fail2ban"
install -m 644 "$ROOT/pi/fail2ban/pi-vault.conf" /etc/fail2ban/filter.d/pi-vault.conf
install -m 644 "$ROOT/pi/fail2ban/pi-vault-admin.conf" /etc/fail2ban/filter.d/pi-vault-admin.conf
install -m 644 "$ROOT/pi/fail2ban/jail.local" /etc/fail2ban/jail.d/pi-vault.local
systemctl enable fail2ban >/dev/null 2>&1
systemctl restart fail2ban

step "automatic security updates"
install -m 644 "$ROOT/pi/apt-52pi-vault" /etc/apt/apt.conf.d/52pi-vault
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
systemctl enable --now apt-daily.timer apt-daily-upgrade.timer >/dev/null 2>&1

step "timers"
install -m 644 "$ROOT"/pi/systemd/*.service "$ROOT"/pi/systemd/*.timer /etc/systemd/system/
install -m 644 "$ROOT/pi/logrotate" /etc/logrotate.d/pi-vault
systemctl daemon-reload
systemctl enable pi-vault-firewall.service >/dev/null 2>&1

step "vault"
vaultctl apply
systemctl enable --now pi-vault-backup.timer pi-vault-status.timer pi-vault-update.timer >/dev/null 2>&1

echo
echo "Done. From a NEW connection run: vaultctl confirm   (otherwise firewall + SSH changes undo themselves 20 minutes after they were made)"
