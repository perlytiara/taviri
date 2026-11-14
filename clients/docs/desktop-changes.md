<!-- Copy of `apps/desktop/taviri/CHANGES.md` as it reads once the patches in ../patches are applied. -->

# Taviri desktop: changes to the Bitwarden desktop app

Taviri is an unofficial, modified build of the Bitwarden desktop app (`apps/desktop` in
bitwarden/clients, GPL-3.0). Branch `taviri-desktop`, based on the `smartfill` branch (the
browser extension fork, itself on tag `browser-v2026.10.2`, desktop version 2026.10.2). Built
from the open-source (OSS) configuration only, never `bitwarden_license/`.

Every change below is marked `Taviri fork` in the code. With `TAVIRI_BRAND=off` at build time
the TypeScript side behaves exactly like upstream.

## Name and look

- **Name**: read from the browser extension's `apps/browser/webpack/smartfill-brand/brand.json`
  (`name`), so one edit renames both. Used for the app bundle (`productName`), the packaged
  `package.json`, the window title (`index.html`), the Dock and the menus.
- **Strings that name the app** ("About/Hide/Quit Bitwarden", tray, "Keep Bitwarden running in
  the background", ...) say the brand name in every language. The list is
  `APP_NAME_MESSAGE_KEYS` in `taviri/brand.js`; strings about the Bitwarden service, account,
  company or products are unchanged, and so are the logos inside the window.
- **Icons**: `taviri/make-icons.js` draws the app icon (macOS grid, `.icns`) and the menu bar
  icon from the brand kit (`brand/` in the Taviri repository: `icon.svg`, `glyph.svg`).
- **About window** and **description**: "<name> is based on Bitwarden: an unofficial, modified
  build of the Bitwarden desktop app (GPL-3.0). Not affiliated with Bitwarden Inc."
  `LICENSE_GPL.txt` and `NOTICE.txt` ship in `Contents/Resources`.

## Kept apart from an installed Bitwarden

| What                                   | Bitwarden                                              | Taviri (from `taviri/brand.json`)                                 |
| -------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| Bundle id                              | `com.bitwarden.desktop`                                | `io.github.perlytiara.taviri.desktop`                             |
| Data folder                            | `~/Library/Application Support/Bitwarden`              | `~/Library/Application Support/Taviri Desktop`                    |
| Keychain items                         | `Bitwarden`, `Bitwarden_biometric`                     | `<name>`, `<name>_biometric` (from the app name)                  |
| URL scheme                             | `bitwarden://`                                         | `taviri://` (links are translated back inside the app)            |
| Browser bridge (native messaging host) | `com.8bit.bitwarden`                                   | `io.github.perlytiara.taviri`                                     |
| Extensions allowed on the bridge       | Bitwarden's store ids                                  | Taviri's (`chromeExtensionIds`, the extension's `firefoxAddonId`) |
| IPC socket folder                      | App Group container `LTZ2PFU5D6.com.bitwarden.desktop` | `~/Library/Caches/<bundle id>` (no App Group)                     |
| SSH agent socket                       | `~/.bitwarden-ssh-agent.sock`                          | `~/.taviri-ssh-agent.sock`                                        |

Files: `src/main.ts` (data folder, URL scheme, About panel), `src/main/native-messaging.main.ts`
(bridge name, allowed ids, no DuckDuckGo manifest), `desktop_native/core/src/ipc/mod.rs` and
`desktop_native/ssh_agent/src/server/listener/unix.rs` (compile-time `TAVIRI_APP_ID` and
`TAVIRI_SSH_SOCK_NAME`), `taviri/electron-builder.taviri.js` (bundle id, scheme, no App Group).

## Behaviour changes

- **No auto-update** (`src/main/updater.main.ts`): Bitwarden's feed would replace Taviri with
  the official build. "Check for updates" opens Bitwarden's release page; updating = rebuilding.
- **SSO** always uses the localhost callback (`src/auth/login/desktop-login-component.service.ts`),
  because `bitwarden://sso-callback` opens the official app.
- **DuckDuckGo browser integration** is off (DuckDuckGo only talks to `com.8bit.bitwarden`).

## Packaging (not in upstream's build)

- `taviri/electron-builder.taviri.js`: upstream's `electron-builder.json` plus the above, no
  provisioning profile, no App Group, no notarization, no update files, arm64 `dir` target.
- `taviri/after-pack.taviri.js`: sets the same Electron fuses as upstream's release builds
  (`scripts/after-pack.js` now exports `addElectronFuses` for it); no autofill or Safari
  extension, no Developer ID signing. `clients/desktop/build.sh` signs the app ad hoc.
