#!/usr/bin/env python3
"""Health summary for the vault.

Prints the checks, and writes them to /srv/pi-vault/status/ (status.json and a small page
served at https://<vault>/status/). Exit code: 0 all good, 1 something to look at, 2 broken.
"""
import datetime as dt
import html
import json
import shutil
import socket
import ssl
import subprocess
import sys
import urllib.request
from pathlib import Path

STATE = Path("/var/lib/pi-vault")
OUT = Path("/srv/pi-vault/status")
STACK = Path("/opt/pi-vault/stack")
SITE = Path("/etc/pi-vault/site.env")
RECIPIENTS = Path("/etc/pi-vault/backup-recipients.txt")

ORDER = {"ok": 0, "warn": 1, "fail": 2}
checks = []


def add(name, level, detail):
    checks.append({"name": name, "level": level, "detail": detail})


def run(cmd, timeout=20):
    try:
        done = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return done.returncode, (done.stdout or "") + (done.stderr or "")
    except (OSError, subprocess.TimeoutExpired) as error:
        return 255, str(error)


def load_env(path):
    env = {}
    try:
        lines = Path(path).read_text(encoding="utf8").splitlines()
    except OSError:
        return env
    for line in lines:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf8"))
    except (OSError, ValueError):
        return None


def hours_since(stamp):
    if not stamp:
        return None
    try:
        when = dt.datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    except ValueError:
        return None
    if when.tzinfo is None:
        when = when.astimezone()
    return (dt.datetime.now(dt.timezone.utc) - when).total_seconds() / 3600


def ago(hours):
    if hours is None:
        return "never"
    if hours < 1:
        return f"{int(hours * 60)} min ago"
    if hours < 48:
        return f"{int(hours)} h ago"
    return f"{int(hours / 24)} days ago"


def by_age(name, hours, ok_below, warn_below, detail):
    if hours is None:
        add(name, "warn", detail)
    elif hours < ok_below:
        add(name, "ok", detail)
    elif hours < warn_below:
        add(name, "warn", detail)
    else:
        add(name, "fail", detail)


def cert_days(host, port):
    """Days until the certificate served for `host` expires (None when the handshake fails)."""
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    try:
        with socket.create_connection((host, port), timeout=8) as raw:
            with context.wrap_socket(raw, server_hostname=host) as tls:
                der = tls.getpeercert(binary_form=True)
    except OSError:
        return None
    done = subprocess.run(["openssl", "x509", "-inform", "DER", "-noout", "-enddate"],
                          input=der, capture_output=True, timeout=10)
    text = done.stdout.decode().strip().replace("notAfter=", "")
    try:
        end = dt.datetime.strptime(text, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=dt.timezone.utc)
    except ValueError:
        return None
    return (end - dt.datetime.now(dt.timezone.utc)).total_seconds() / 86400


def main():
    site = load_env(SITE)
    vault_env = load_env(STACK / "vault.env")
    brand = load_env(STACK / "image" / "brand.env").get("BRAND_NAME", "Vault")
    https_port = int(site.get("HTTPS_PORT", "443") or 443)

    # The server itself.
    version = ""
    try:
        with urllib.request.urlopen("http://127.0.0.1:8732/alive", timeout=6) as reply:
            alive = reply.status == 200
        with urllib.request.urlopen("http://127.0.0.1:8732/api/config", timeout=6) as reply:
            version = json.load(reply).get("version", "")
    except (OSError, ValueError):
        alive = False
    add("Vault server", "ok" if alive else "fail",
        f"running, release {site.get('VW_VERSION', '?')}" if alive and version else "not answering")

    # HTTPS on each address.
    lan_ip = site.get("LAN_IP", "")
    if lan_ip:
        days = cert_days(lan_ip, https_port)
        add("HTTPS on the home network", "ok" if days and days > 0 else "fail",
            f"https://{lan_ip} answers" if days and days > 0 else f"https://{lan_ip} does not answer")
    ts_name = site.get("TS_NAME", "")
    if ts_name:
        days = cert_days(ts_name, https_port)
        if days is None or days <= 0:
            add("HTTPS on the tailnet", "fail", f"https://{ts_name} does not answer")
        else:
            add("HTTPS on the tailnet", "ok" if days > 14 else "warn",
                f"https://{ts_name}, certificate good for {int(days)} days")

    # Tailscale.
    code, out = run(["tailscale", "status", "--json"])
    if code != 0:
        add("Tailscale", "warn", "not installed or not running")
    else:
        try:
            info = json.loads(out)
        except ValueError:
            info = {}
        state = info.get("BackendState", "?")
        if state != "Running":
            add("Tailscale", "warn", f"not signed in yet ({state}): run `vaultctl tailscale`")
        else:
            expiry = (info.get("Self") or {}).get("KeyExpiry")
            left = hours_since(expiry)
            if expiry and left is not None and -left / 24 < 30:
                add("Tailscale", "warn",
                    f"this machine's key expires in {int(-left / 24)} days: disable key expiry for it in the admin console")
            elif expiry:
                add("Tailscale", "warn", "connected, but key expiry is still on: disable it for this machine in the admin console")
            else:
                add("Tailscale", "ok", "connected, key does not expire")

    # Backups.
    has_key = RECIPIENTS.exists() and "age1" in RECIPIENTS.read_text(encoding="utf8")
    backup = read_json(STATE / "backup.json")
    if not has_key:
        add("Nightly backup", "warn", "no backup key installed yet (on the Mac: mac/backup-key.sh init)")
    else:
        hours = hours_since(backup.get("when")) if backup else None
        size = f", {backup['bytes'] // 1024} KB" if backup else ""
        by_age("Nightly backup", hours, 26, 50, f"last one {ago(hours)}{size}")

    offsite = read_json(STATE / "offsite.json") or {}
    for key, label in (("metal", "Copy on the backup disk"), ("drive", "Cloud copy")):
        hours = hours_since(offsite.get(key))
        by_age(label, hours, 50, 24 * 8, f"last copied {ago(hours)}")

    drill = read_json(STATE / "restore-test.json")
    if not drill:
        add("Restore test", "warn", "never run (on the Mac: mac/restore-test.sh)")
    elif drill.get("result") != "ok":
        add("Restore test", "fail", f"failed {ago(hours_since(drill.get('when')))}")
    else:
        hours = hours_since(drill.get("when"))
        by_age("Restore test", hours, 24 * 45, 24 * 120, f"passed {ago(hours)}")

    # Locks.
    code, rules = run(["nft", "list", "table", "inet", "pivault"])
    _, addrs = run(["ip", "-6", "-o", "addr", "show", "scope", "global"])
    import ipaddress
    current = set()
    for line in addrs.splitlines():
        parts = line.split()
        if len(parts) > 3 and parts[1] == (site.get("LAN_IFACE") or parts[1]):
            try:
                current.add(str(ipaddress.ip_interface(parts[3]).network))
            except ValueError:
                pass
    try:
        allowed = Path("/etc/pi-vault/firewall.nft").read_text(encoding="utf8")
    except OSError:
        allowed = ""
    stale = [net for net in current if not net.startswith(("fd", "fc")) and net not in allowed]
    if code != 0:
        add("Firewall", "fail", "rules are not loaded")
    elif stale:
        add("Firewall", "warn", "the home network's IPv6 prefix changed: run `vaultctl apply`")
    else:
        add("Firewall", "ok", "on: only the home network and the tailnet get in")

    code, out = run(["fail2ban-client", "status"])
    wanted = ["sshd", "pi-vault", "pi-vault-admin"]
    missing = [jail for jail in wanted if jail not in out]
    if code != 0 or missing:
        add("fail2ban", "fail", "not running" if code != 0 else "jails missing: " + ", ".join(missing))
    else:
        banned = 0
        for jail in wanted:
            _, text = run(["fail2ban-client", "status", jail])
            for line in text.splitlines():
                if "Currently banned" in line:
                    banned += int(line.split(":")[-1].strip() or 0)
        add("fail2ban", "ok", f"watching SSH and vault logins, {banned} address(es) banned now")

    code, out = run(["sshd", "-T"])
    settings = dict(line.split(" ", 1) for line in out.splitlines() if " " in line)
    keys_only = (settings.get("passwordauthentication") == "no"
                 and settings.get("kbdinteractiveauthentication", "no") == "no"
                 and settings.get("permitrootlogin") in ("no", "without-password", "prohibit-password"))
    add("SSH", "ok" if keys_only else "fail", "keys only" if keys_only else "password login is still possible")

    signups = vault_env.get("SIGNUPS_ALLOWED", "true").lower()
    add("Sign-up", "ok" if signups == "false" else "warn",
        "closed (invitations only)" if signups == "false" else "open right now")
    token = vault_env.get("ADMIN_TOKEN", "")
    if not token:
        add("Admin page", "ok", "off")
    elif token.startswith("$argon2"):
        add("Admin page", "warn", "on, behind an argon2-hashed password (`vaultctl admin-off` when done)")
    else:
        add("Admin page", "fail", "on with a plain-text token")

    # Updates.
    code, out = run(["systemctl", "is-enabled", "apt-daily-upgrade.timer"])
    stamp = Path("/var/lib/apt/periodic/upgrade-stamp")
    hours = (dt.datetime.now().timestamp() - stamp.stat().st_mtime) / 3600 if stamp.exists() else None
    if "enabled" not in out:
        add("System security updates", "fail", "automatic updates are off")
    elif Path("/var/run/reboot-required").exists():
        add("System security updates", "warn", "installed; the Pi restarts by itself at 04:30 to finish")
    else:
        by_age("System security updates", hours if hours is not None else 0, 72, 24 * 10,
               f"automatic, last run {ago(hours)}" if hours is not None else "automatic, first run pending")

    update = read_json(STATE / "update.json")
    if not update:
        add("Vault server updates", "warn", "weekly check has not run yet")
    else:
        text = update.get("note", "")
        bad = any(word in text for word in ("failed", "needs", "could not"))
        add("Vault server updates", "warn" if bad else "ok", f"{text} (checked {ago(hours_since(update.get('when')))})")

    usage = shutil.disk_usage("/srv/pi-vault")
    free = usage.free / usage.total * 100
    add("Disk", "ok" if free > 15 else ("warn" if free > 5 else "fail"),
        f"{usage.free // 2**30} GB free ({free:.0f}%)")

    overall = max((c["level"] for c in checks), key=ORDER.get)
    now = dt.datetime.now().astimezone()
    try:
        from zoneinfo import ZoneInfo
        now = now.astimezone(ZoneInfo(site.get("TIMEZONE", "")))
    except Exception:
        pass
    report = {"name": brand, "overall": overall, "checked": now.isoformat(timespec="seconds"), "checks": checks}

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "status.json").write_text(json.dumps(report, indent=1), encoding="utf8")
    (OUT / "index.html").write_text(page(report, now), encoding="utf8")

    if "--quiet" not in sys.argv:
        mark = {"ok": " ok ", "warn": "LOOK", "fail": "FAIL"}
        print(f"{brand}: {headline(overall)}   (checked {now:%H:%M})")
        for check in checks:
            print(f"  [{mark[check['level']]}] {check['name']}: {check['detail']}")
    return ORDER[overall]


def headline(overall):
    return {"ok": "all good", "warn": "working, a few things to look at", "fail": "something is broken"}[overall]


def page(report, now):
    rows = "".join(
        f'<li class="{c["level"]}"><span class="dot"></span><div><b>{html.escape(c["name"])}</b>'
        f'<span>{html.escape(c["detail"])}</span></div></li>'
        for c in report["checks"]
    )
    name = html.escape(report["name"])
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="300">
<title>{name} status</title>
<link rel="icon" type="image/png" sizes="32x32" href="/images/favicon-32x32.png">
<style>
:root {{ --bg:#f6f7f9; --card:#fff; --ink:#17202a; --soft:#5b6673; --line:#e3e6ea; --ok:#1f8a4c; --warn:#b7791f; --fail:#c53030; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg:#14181d; --card:#1d2229; --ink:#eef1f4; --soft:#a3adb8; --line:#2c333c; --ok:#4cc38a; --warn:#e3b341; --fail:#f47067; }} }}
body {{ margin:0; background:var(--bg); color:var(--ink); font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }}
main {{ max-width:620px; margin:0 auto; padding:28px 16px 48px; }}
h1 {{ font-size:22px; margin:0 0 4px; }}
.sum {{ font-size:18px; font-weight:600; margin:0 0 4px; }}
.sum.ok {{ color:var(--ok); }} .sum.warn {{ color:var(--warn); }} .sum.fail {{ color:var(--fail); }}
.when {{ color:var(--soft); margin:0 0 18px; font-size:14px; }}
ul {{ list-style:none; margin:0; padding:0; background:var(--card); border:1px solid var(--line); border-radius:12px; }}
li {{ display:flex; gap:12px; align-items:flex-start; padding:12px 16px; border-top:1px solid var(--line); }}
li:first-child {{ border-top:0; }}
.dot {{ flex:none; width:10px; height:10px; border-radius:50%; margin-top:7px; background:var(--ok); }}
li.warn .dot {{ background:var(--warn); }} li.fail .dot {{ background:var(--fail); }}
li div {{ min-width:0; }} li b {{ display:block; font-weight:600; }} li span {{ color:var(--soft); font-size:14px; overflow-wrap:anywhere; }}
a {{ color:inherit; }}
</style></head><body><main>
<h1>{name}</h1>
<p class="sum {report['overall']}">{headline(report['overall']).capitalize()}</p>
<p class="when">Checked {now:%A %d %B, %H:%M}. This page refreshes itself.</p>
<ul>{rows}</ul>
</main></body></html>
"""


if __name__ == "__main__":
    sys.exit(main())
