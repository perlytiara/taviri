# Taviri

Taviri is a self-hosted password manager suite: a browser extension, a macOS desktop app and an
Android app built from the open-source Bitwarden® clients, plus a hardened Raspberry Pi server
built on [Vaultwarden](https://github.com/dani-garcia/vaultwarden). It keeps Bitwarden's
end-to-end encryption and sync protocol unchanged and adds:

- **Autofill for sign-in pages that standard autofill gets wrong**: logins with extra fields
  (customer numbers, dates of birth, drop-downs) and multi-step pages with on-screen keypads,
  driven by data stored inside the encrypted login itself.
- **Its own identity**: own name, icons, app ids, browser bridge and data folders, so each app
  installs next to the official one and never talks to it.
- **A server you can leave running at home**: reachable only from the home network and a
  Tailscale tailnet, firewalled by default, with encrypted off-device backups, restore tests and
  automatic updates that roll back on failure.

Taviri is an independent project. It is not affiliated with, sponsored or endorsed by
Bitwarden, Inc. or the Vaultwarden project (see [NOTICE.md](NOTICE.md)).

> **Status (November 2026): early.** First public release of the source. No builds are
> distributed; build from source. Everything below was tested against a local test server with
> fake data. The server stack was rehearsed end to end on an arm64 Linux machine; it has not run
> on a Raspberry Pi yet.

## What is here

| Folder | Contents | Applies to | Licence |
|---|---|---|---|
| [`clients/`](clients/) | Patch series for the browser extension and the macOS desktop app, build scripts, end-to-end tests | [bitwarden/clients](https://github.com/bitwarden/clients) tag `browser-v2026.10.2` | GPL-3.0 |
| [`android/`](android/) | Patch series for the Android app | [bitwarden/android](https://github.com/bitwarden/android) `main` at `6366dd5b8` | GPL-3.0 |
| [`server/`](server/) | Raspberry Pi server: container stack, rebranding at image build, firewall, backups, updates, health page | [Vaultwarden](https://github.com/dani-garcia/vaultwarden) 1.37.5 (stock binary) | AGPL-3.0 |
| [`brand/`](brand/) | Name, colour and artwork shared by every app | | see [NOTICE.md](NOTICE.md) |
| [`docs/`](docs/) | [Security design](docs/security.md), [custom-field format](docs/recipes.md) | | GPL-3.0 |

The forks are kept as **patch series** against pinned upstream versions rather than as full
copies of the upstream repositories: every change Taviri makes to Bitwarden's code is in
`clients/patches/` and `android/patches/`, in order, with its reasoning in the commit message.
Upstream files are touched as little as possible and each change is marked in the code
(`Smartfill fork:`, `Taviri fork`, `Vault fork:`). New code lives in its own folders.

## What Taviri changes

**Browser extension** (Chrome MV3 and Firefox MV2;
[full list](clients/docs/extension-changes.md))

- *Extra fields*: a login's custom fields are typed into the one page control whose label best
  matches the field name, case- and accent-insensitive, ties left empty, never into a password
  box. Upstream typed a custom field into every control whose name matched.
- *Saved entry steps* (a JSON "recipe" in a custom field): fill, click, wait, on-screen keypad,
  press, across page loads, frames and shadow DOM. Format: [docs/recipes.md](docs/recipes.md).
- *Item icons*: a `taviri:icon` field picks an icon from a built-in pack, so items without a
  website still get a recognisable icon without any network request.
- Desktop unlock talks only to the Taviri desktop app.

**Desktop app** (macOS, Apple silicon; [full list](clients/docs/desktop-changes.md)): own bundle
id, data folder, keychain items, URL scheme, IPC socket and SSH agent socket; browser bridge
that accepts only the Taviri extension; auto-update off (Bitwarden's feed would replace it);
same Electron fuses as upstream release builds.

**Android app** ([notes](android/docs/vault-folder.md)): own package id, name, icon and palette
(F-Droid flavour, no Google services); a login's custom fields are filled into the boxes named
like them; a clear "No server yet" state instead of a generic error while no server is set.

**Server** ([runbook](server/README.md)): stock Vaultwarden binary with a rebranded web vault and
email templates, behind Caddy; nftables default-drop firewall, SSH keys only, fail2ban, sign-up
closed, admin page off by default, unattended security updates, nightly backups encrypted with
[age](https://age-encryption.org) to a key the server never holds, scripted restore tests,
weekly server updates with automatic rollback.

## Security

- How each part is protected, and what the extra autofill features are not allowed to do:
  [docs/security.md](docs/security.md).
- Reporting a vulnerability: [SECURITY.md](SECURITY.md). Please do not open a public issue.

## Building

All builds start from the pinned upstream version plus the patches:

```bash
clients/apply.sh      # bitwarden/clients at browser-v2026.10.2 + patches -> clients/upstream
clients/extension/build.sh all
clients/desktop/build.sh
android/apply.sh      # bitwarden/android at the pinned commit + patches -> android/upstream
```

Details, requirements and tests: [clients/README.md](clients/README.md),
[android/README.md](android/README.md), [server/README.md](server/README.md).

## Tests

- Browser extension: 55 unit tests for the new autofill code, 25 for item icons, Bitwarden's own
  autofill suites, and end-to-end scenarios that run the built extension in Chrome for Testing
  and Firefox against a local Vaultwarden and fake sites
  ([results](clients/extension/test/results/)). They include safety checks: a recipe whose click
  leads to another site types nothing there, and page-load autofill never runs a recipe.
- Desktop app: scripted login and browser-bridge tests against the local test server.
- Android: unit tests for the custom-field matching and the "No server yet" view models.
- Server: `vaultctl restore-test` starts a throw-away server on a decrypted backup and checks it
  (the health page shows when it last passed); a small standard-library vault client
  (`server/test/e2e_client.py`) registers a test account, stores an encrypted item, then logs in
  again and decrypts it, which the rehearsal used to prove a restored backup is usable.

## Licence and trademarks

Code in `clients/`, `android/` and `docs/` is GPL-3.0 ([LICENSE](LICENSE)); `server/` is
AGPL-3.0 ([server/LICENSE](server/LICENSE)), like Vaultwarden. The licences cover the code, not
the names: Bitwarden is a trademark or registered trademark of Bitwarden, Inc. in the United
States and/or other countries, and is used here only to say where the code comes from. If you
distribute a modified Taviri, give it your own name and icon. Credits and the full licence map:
[NOTICE.md](NOTICE.md).
