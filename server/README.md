# Taviri server

A private password vault for a Raspberry Pi (or another Debian-family Linux machine) on a home
network. The server is [Vaultwarden](https://github.com/dani-garcia/vaultwarden), which speaks the
Bitwarden protocol, so the Taviri apps and Bitwarden's own apps work with it. The web vault,
emails and admin page show the Taviri name and icon.

> **Status:** rehearsed end to end on an arm64 Linux machine (install, backup, restore test,
> update with rollback). Not yet run on a Raspberry Pi.

Licence: AGPL-3.0 ([LICENSE](LICENSE)). If people other than you use your server, its About page
must keep pointing at the source you run (`BRAND_SOURCE_URL`, below).

## How it fits together

```
phone / Mac / browser extension
        │  HTTPS only
        ▼
   Caddy (front door)  ── https://vault.<tailnet>.ts.net   certificate from Tailscale (trusted everywhere)
        │              ── https://<the Pi's LAN address>   certificate from the Pi's own authority
        ▼
   Vaultwarden (listens on 127.0.0.1 only)  →  /srv/pi-vault/data
```

- Reachable from the home network and the tailnet only. Anything else gets no answer: the
  firewall drops it, and Caddy refuses it a second time.
- Both containers use the host's network, so the firewall really decides (Docker's own port
  publishing would bypass it). Vaultwarden runs as an unprivileged user; both containers are
  read-only with all capabilities dropped.

## What you need

- The Pi with Raspberry Pi OS or Debian, reachable over SSH **as root with a key**; add a
  `Host pi-vault` entry to `~/.ssh/config` (or set `PI_HOST`).
- A Mac as the admin machine: it runs `deploy.sh`, holds the backup key in its login keychain and
  fetches the encrypted backups. Homebrew `age` and `rclone` (only for a cloud copy).
- Optional: a Tailscale account, for access away from home with a publicly trusted certificate.

## Folders

| Path | What |
| --- | --- |
| `stack/image/` | the image build: stock Vaultwarden plus `rebrand.py`, which renames and recolours the web vault, emails and admin page and fails loudly when an upstream change no longer fits. `brand.env` holds the name, colour and `BRAND_SOURCE_URL` |
| `stack/` | `compose.yml`, the Caddy template, the server settings template |
| `pi/` | what gets installed on the Pi: `bootstrap.sh`, `vaultctl`, firewall, fail2ban, systemd timers, health page |
| `mac/` | admin-side helpers: backup key, backup copies, restore test, status, `install.sh` for the daily copy job |
| `deploy.sh` | copies `stack/` and `pi/` to the Pi and applies them |
| `tools/export-brand-kit.sh` | exports the artwork to [`../brand/`](../brand/) for the apps |
| `test/` | test-only tools: a small vault client and a mail catcher |

On the Pi: `/opt/pi-vault/stack` (the running stack; `vault.env` there is the only file with
secrets and never leaves the Pi), `/etc/pi-vault/site.env` (addresses, ports, versions),
`/srv/pi-vault/data` (the vault), `/var/backups/pi-vault` (the last 14 encrypted backups),
`/usr/local/sbin/vaultctl` (one command for everything; `vaultctl` alone lists it).

## Install

1. Look first, change nothing: `ssh pi-vault 'bash -s' < pi/inspect.sh` (system, open ports,
   other services). If another service needs LAN ports, list them in `PI_VAULT_EXTRA_LAN_TCP`
   (and `_UDP`) for the next step, or the new firewall closes them.
2. `./deploy.sh bootstrap`. It stops if another program holds port 80 or 443. It installs the
   packages, Docker, the firewall, fail2ban and the timers. Before the firewall and SSH changes
   it arms a timer that undoes them by itself unless a fresh SSH connection confirms them in time
   (`deploy.sh` does that for you).
3. `mac/backup-key.sh init` (creates the backup key in the login keychain and gives the Pi the
   public half), `ssh pi-vault vaultctl backup`, `mac/pull-backups.sh`, `mac/restore-test.sh`.
4. Optional: `vaultctl tailscale` on the Pi prints a sign-in link; in the Tailscale admin console
   turn on HTTPS certificates and disable key expiry for the Pi.
5. `mac/backup-key.sh recovery-copy` saves a passphrase-protected copy of the backup key next to
   the backups. Without it (or a paper copy from `backup-key.sh show`), losing the Mac means the
   backups cannot be opened.

## Health

`https://<vault address>/status/` or `mac/vault-status.sh`: server up, HTTPS, Tailscale, last
backup, backup copies, last restore test, firewall, fail2ban, SSH keys-only, sign-up closed,
admin page, security updates, server updates, disk space. Green is fine, amber means look,
red means broken.

## People and the admin page

Sign-up is closed. To let someone in (on the Pi, as root):

- `vaultctl signup-window 15` opens sign-up for 15 minutes, then closes it by itself.
- `vaultctl admin-on` turns the admin page on at `/admin`; you type a password and only its argon2
  hash is stored. Invite people there, then `vaultctl admin-off`.

Wrong passwords: 5 failed logins in 15 minutes ban the address for an hour (3 on the admin page,
4 on SSH); repeat offenders are banned for a week. `fail2ban-client unban <address>` lifts a ban.

## Backups

Every night the Pi writes `vault-<date>.tar.zst.age` to `/var/backups/pi-vault`: a consistent
copy of the database, attachments, the server key, settings and the Pi's certificate authority,
encrypted with [age](https://age-encryption.org) to a key whose private half never touches the Pi.

`mac/pull-backups.sh` fetches them to the Mac and can copy them on to an external disk
(`METAL_VOLUME`, default `/Volumes/Backup`) and to a cloud folder through rclone
(`DRIVE_REMOTE=remote:path`, off by default). Nothing is deleted there. Run it daily, for example
from a launchd agent; `mac/install.sh` first copies the helpers to
`~/Library/Application Support/pi-vault/bin`, so the job keeps working when this folder sits on
a disk that is unplugged.

Restore:

- **Test** (touches nothing live): `mac/restore-test.sh` decrypts the newest backup, starts a
  throw-away server on it on the Pi, checks it and removes it. The health page shows when this
  last passed. Run it monthly.
- **For real:** `mac/open-backup.sh <file> --to-pi`. The current data is kept as
  `/srv/pi-vault/data.replaced-<date>`.
- **On a new Pi:** `./deploy.sh bootstrap`, then the line above.
- **On another Mac:** add `--recovery-key backup-key.recovery.age` (asks for the passphrase).

Moving from an existing plain Vaultwarden install: `mac/backup-old-vaultwarden.sh` saves its
settings and data, encrypted, next to the other backups.

## Updates

- **System:** security fixes install themselves every night; when one needs a restart, the Pi
  restarts at 04:30.
- **Vaultwarden:** weekly, `vaultctl update` looks for a new release, rebuilds the branded image,
  backs up, switches and checks the server answers. If it does not, it goes back to the old
  version and the old database. If the rebranding no longer fits the new release, it changes
  nothing and the health page says so. Caddy is refreshed in the same run.

## Name, icon and source link

Edit `stack/image/brand.env` (and `icon.svg` / `mark.svg`), then `./deploy.sh`. The web vault,
page titles, logos, favicons, admin page, emails and the authenticator QR label follow. With
`RECOLOUR="yes"` buttons and links take the brand colour (lightness kept, so contrast stays as
designed). Then `tools/export-brand-kit.sh` refreshes [`../brand/`](../brand/) for the apps.

`BRAND_SOURCE_URL` is the link on the About page to the source of what you run (AGPL-3.0
section 13). If you change anything, point it at your own fork.

Left as they are, by design: the About page credits Vaultwarden and the Bitwarden web client and
links their source; the import screen lists "Bitwarden (json)" as a file format; the server's
API calls itself "Vaultwarden" to apps; a few rarely seen illustrations may still contain a small
shield drawing.

## Security, in one list

- HTTPS only; plain HTTP redirects.
- Firewall (nftables): default drop. SSH, 80 and 443 only from the home network and the tailnet;
  IPv6 from the internet is dropped too.
- SSH: keys only.
- Sign-up closed; admin page off unless switched on, then behind an argon2 hash.
- fail2ban on SSH, vault logins, two-step codes and the admin page.
- Unattended security updates with automatic restart.
- Backups encrypted before they leave the Pi; the Pi cannot read them.
- On purpose: no port forwarding, no public DNS name, no push relay through Bitwarden's servers.

In the router: give the Pi a fixed address, and check that no port is forwarded to it.
More: [docs/security.md](../docs/security.md).
