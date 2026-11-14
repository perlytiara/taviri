#!/usr/bin/env bash
# Read-only look at the Pi before anything is changed. Prints; changes nothing.
echo "### system"; . /etc/os-release; echo "$PRETTY_NAME, $(uname -m), kernel $(uname -r)"
cat /proc/device-tree/model 2>/dev/null | tr -d '\0'; echo
uptime; df -h / | tail -1; free -h | sed -n 2p
echo "### network"; ip -4 -o addr show scope global | awk '{print $2, $4}'; ip -6 -o addr show scope global | awk '{print $2, $4}'
echo "### listening (who answers on which port)"; ss -Htlnp | awk '{print $4, $6}' | sort -u
ss -Hulnp | awk '{print "udp", $4, $6}' | sort -u
echo "### firewall today"; nft list ruleset 2>/dev/null | grep -c . | sed 's/^/nft lines: /'; command -v ufw >/dev/null && ufw status | head -3
echo "### ssh"; sshd -T 2>/dev/null | grep -E '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin|pubkeyauthentication) '
ls -la /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys 2>/dev/null
echo "### docker"; docker --version 2>/dev/null; docker compose version 2>/dev/null | head -1
docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null
echo "### other services"; systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null | awk '{print $1}' | grep -v -E '^(systemd-|dbus|getty|user@|cron|ssh|polkit|rsyslog|avahi|wpa_|NetworkManager|ModemManager|triggerhappy|bluetooth|rtkit|udisks|accounts-daemon|colord|cups|lightdm|serial-getty|containerd|docker)' | tr '\n' ' '; echo
command -v pm2 >/dev/null && pm2 jlist 2>/dev/null | python3 -c 'import json,sys; [print("pm2:", p["name"], p["pm2_env"]["status"]) for p in json.load(sys.stdin)]' 2>/dev/null
echo "### tailscale"; tailscale status 2>&1 | head -3
echo "### unattended upgrades"; systemctl is-enabled apt-daily-upgrade.timer 2>/dev/null; ls /etc/apt/apt.conf.d/ | tr '\n' ' '; echo
echo "### old vaultwarden"
ls -la /opt/vaultwarden /opt/vaultwarden-data 2>/dev/null
docker inspect vaultwarden --format 'image {{.Config.Image}}, started {{.State.StartedAt}}, restart {{.HostConfig.RestartPolicy.Name}}' 2>/dev/null
db=/opt/vaultwarden-data/db.sqlite3
if [ -f "$db" ]; then
  ls -la --time-style=long-iso "$db"*
  if command -v sqlite3 >/dev/null; then
    sqlite3 "file:$db?mode=ro" "select 'accounts: '||count(*) from users; select 'items: '||count(*) from ciphers; select 'attachments: '||count(*) from attachments; select 'organisations: '||count(*) from organizations; select 'last item change: '||max(updated_at) from ciphers; select 'last login seen: '||max(updated_at) from devices;" 2>&1
  else
    echo "(sqlite3 is not installed here; item counts are read on the Mac from the backup copy)"
  fi
fi
