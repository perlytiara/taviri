# Security design

What Taviri adds to Bitwarden's apps and to a Vaultwarden server, what could go wrong with each
addition, and what stops it. To report a problem, see [SECURITY.md](../SECURITY.md).

## What is not changed

No patch touches Bitwarden's encryption, key derivation, vault sync or account protocol code.
Vault data stays end-to-end encrypted exactly as upstream: the server only ever stores encrypted
items, and Taviri's own data (extra fields, saved entry steps, icon choices) lives inside those
encrypted items as ordinary custom fields. The server binary is the stock Vaultwarden release.

## Browser extension

Taviri's extension can do more on a web page than upstream's: type into several controls and run
saved steps (click, wait, type on an on-screen keypad, press Enter). The risk is a page, or a
person who can edit a login, getting the extension to type a secret where it does not belong.

| Risk | What prevents it |
|---|---|
| A look-alike or hostile page triggers the steps | Steps run only when the user asks for a fill (popup, inline menu or keyboard shortcut) and only for a login saved for that site. "Autofill on page load" never runs steps (end-to-end test). |
| Steps navigate to another site and keep typing | After every page load the background checks again that the tab still matches the login, that the vault is unlocked and that the tab is in front; otherwise the run stops. End-to-end test: a recipe whose click leads to another site types nothing there and that site receives nothing. |
| A shared (organization) login carries steps written by someone else | Steps in organization logins are ignored and the login is filled the regular way (`SMARTFILL_RUN_ORGANIZATION_RECIPES` is off), so anyone who can edit a shared login cannot make other members' browsers click things. |
| An extra field lands in the wrong box | A custom field goes into exactly one control, the best label match; ties leave every candidate empty; a password box never receives a custom field. Bitwarden's explicit rule syntax (`id=`, `name=`, `regex=`…) behaves as upstream. |
| Taviri's own settings leak into pages | Custom fields named `taviri:…` are never typed into a page, and a login with saved steps is filled only by its steps, so the steps field itself is never typed anywhere. |
| A broken or malicious recipe | Recipes are parsed and validated before anything runs; an invalid one shows a notice and types nothing (end-to-end test). |
| Two-step codes used beyond the user's plan | `totp` in a recipe follows upstream's entitlement rule for TOTP autofill. |
| Item icons leak which sites you use | Pack icons are compiled into the extension; choosing one makes no network request. |
| The extension talks to another desktop app | Desktop unlock uses Taviri's own native-messaging host name, never Bitwarden's. |

Steps are executed by a content script with synthetic DOM events, so they act with the page's
own privileges and no more. The new code is in `src/autofill/smartfill/` of the patched
extension; [clients/docs/extension-changes.md](../clients/docs/extension-changes.md) lists every
upstream file touched.

## Desktop app (macOS)

The fork's job is to run next to an installed Bitwarden without sharing anything with it.

- Own bundle id, data folder, keychain items, URL scheme, IPC socket folder (no shared App Group)
  and SSH agent socket, so neither app can read the other's state or answer the other's links.
- Own native-messaging host whose manifest allows only Taviri's extension ids; Bitwarden's
  manifests are never written or removed. DuckDuckGo integration is off because it only knows
  Bitwarden's host.
- Auto-update is off: Bitwarden's update feed would replace Taviri with the official build.
  Updating means rebuilding from source.
- SSO always uses the localhost callback, so the sign-in result cannot be delivered to the
  official app through `bitwarden://`.
- Packaging sets the same Electron fuses as upstream's release builds. Builds are signed ad hoc,
  or with a self-signed certificate kept in a keychain of its own
  (`clients/desktop/signing/make-signing-identity.sh`), so that the app's designated requirement
  stays the same across rebuilds and the keychain keeps trusting it.

## Android app

- Own package id, label and icon; the F-Droid flavour, so no Google services and no push relay.
- While no server is configured (a placeholder host under `.invalid`, which cannot exist), the
  login and registration screens say "No server yet" before a password is typed, and nothing is
  sent anywhere.
- Plain `http://` servers are refused by the app's network rules. User-installed certificate
  authorities are trusted, so a home server with its own CA works once that CA is installed.
- A login's custom fields are filled into boxes matched by label, with the same rules as the
  extension (one box per field, ties left empty, never a password box). Saved entry steps are
  not run on Android.

## Server

The server is meant to sit in a home network and never face the internet.

- **Exposure**: answers only the home network and the Tailscale tailnet. nftables default-drop
  firewall (IPv4 and IPv6), and Caddy refuses outside addresses a second time. No port
  forwarding, no public DNS name. HTTPS only; plain HTTP redirects.
- **Containers**: Vaultwarden and Caddy run with host networking so that the firewall, not
  Docker's port publishing, decides what is reachable; both have read-only file systems, drop
  all capabilities (Caddy keeps only the right to bind ports 80 and 443) and set
  `no-new-privileges`; Vaultwarden runs as an unprivileged user and listens on 127.0.0.1 only.
- **Accounts**: sign-up closed (a timed window can open it); the admin page is off unless
  switched on, and then protected by an argon2 hash of a password typed on the server.
- **Brute force**: fail2ban on SSH, vault logins, two-step codes and the admin page.
- **Changes to the box**: before touching the firewall or SSH, the bootstrap arms a timer that
  undoes those changes by itself unless a fresh SSH connection confirms them in time, so a
  mistake cannot lock the owner out.
  SSH accepts keys only.
- **Updates**: unattended security updates with automatic restarts; a weekly job moves to a new
  Vaultwarden release only after a backup, rolls back to the old version and database if the new
  one does not answer, and changes nothing if the rebranding no longer fits the new release.
- **Backups**: nightly, encrypted with age to a public key; the private key never touches the
  server (it lives in the owner's login keychain, with an optional passphrase-protected recovery
  copy). Copies leave the server only encrypted.
- **Restore tests**: a scripted restore starts a throw-away server on a decrypted backup and
  checks it; the health page shows when that last passed.
- **Source for users**: the About page links to the server's source (AGPL-3.0 section 13).

Runbook and details: [server/README.md](../server/README.md).

## Known limitations

- No external security audit has been done.
- Builds are not reproducible, and no binaries are published.
- The desktop app's window still shows Bitwarden's logos (see [NOTICE.md](../NOTICE.md)).
- Synthetic events (`isTrusted: false`) are ignored by some sites; those sites cannot be filled
  by saved steps.
- The extension's id on Chromium browsers depends on how it is installed; a builder must put
  their own extension id in the desktop app's `chromeExtensionIds` for desktop unlock to work.
- Each patch series follows one pinned upstream version. Security fixes from Bitwarden reach
  Taviri only when the series is moved to a newer upstream release.
