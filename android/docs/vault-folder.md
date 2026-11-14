<!-- Copy of `vault/README.md` as it reads once the patches in ../patches are applied. -->

# Taviri for Android (personal fork of Bitwarden)

A rebranded build of the [Bitwarden Android app](https://github.com/bitwarden/android) (GPL-3.0)
for one phone. It has its own name, icon, colours and package id, so it installs **next to** the
official Bitwarden app and shares nothing with it. `upstream` is Bitwarden's
repo, `origin` is ours.

Everything that belongs to the fork lives in this `vault/` folder, plus a few small edits in the
app that are all marked `Vault fork:` (`git grep "Vault fork"` lists them).

## Build and install

```bash
vault/build.sh --install
```

That re-applies the brand, builds the release APK (about 6 minutes), signs it with the local key
and installs it on the phone over adb. Without `--install` it stops after signing; the APK is in
`vault/out/`.

What it needs on the Mac:

| Need | Where |
|---|---|
| JDK 21 | Homebrew `openjdk@21` (the system Java 26 is too new for Gradle) |
| Android SDK | Homebrew `android-commandlinetools` (`/opt/homebrew/share/android-commandlinetools`) |
| Rust + Android NDK | only to build Bitwarden's SDK, see below |

Paths and names are set in `vault/env.sh`.

## Changing the name, package id, colours or server

Edit `vault/brand.properties`, then run `vault/build.sh --install`.

- `name`: app name. All 80-odd strings that say "Bitwarden" are renamed in every language, and
  the login-screen wordmark is redrawn.
- `applicationId`: Android package id. A new id is a new app for Android.
- `defaultServerUrl`: see the next section.
- `hue`, `neutralTint`, `accentHue`: the look. Bitwarden's blues are rotated to this hue with
  their lightness kept, so text contrast stays as Bitwarden designed it.

`vault/apply_brand.py` does the work and can be run alone. It writes the overlay in
`app/src/vault/res` (generated, committed) and the launcher icon files.

The name is final: **Taviri** (Tahitian for "key"), package id `io.github.perlytiara.taviri`.
The icon, logo and colour come from the **brand kit** shared with the web vault
(`brand/` in the Taviri repository, exported from the server folder). Its artwork, a keyhole, is a
placeholder until the owner approves or replaces it.

The folder `vault/`, the repo name and the `Vault fork:` markers keep the project's working name;
only what the phone shows carries the brand.

### The brand kit

`brandKit` in `brand.properties` names the kit folder. Every build copies the kit into
`vault/brand/kit/` (so the repo builds without that folder) and makes from the copy:

| From the kit | Becomes |
|---|---|
| `glyph.svg` (keyhole alone) | launcher icon front layer, themed-icon layer, start-up logo, status bar icon |
| `mark.svg` + `glyph.svg` | the small colour logo in autofill pop-ups |
| `logo.svg` (mark + wordmark) | the logo on the login screen, coloured by the light or dark theme |
| `brand.json` → `colour` | launcher icon background, and the hue of the whole palette when `hue` is empty |

When the kit changes (new artwork, new colour), `vault/build.sh --install` picks it up; nothing
else to edit. `vault/tools/preview.py` draws `vault/preview/brand.png` to look at the result
without building. Without any kit the script draws a built-in mark and sets the name in Inter.

One role can be overridden by hand with an Android vector drawable in `vault/brand/`:
`icon_foreground.xml`, `icon_monochrome.xml`, `splash_icon.xml`, `autofill_icon.xml`,
`notification_icon.xml` (24 x 24, shape only) or `wordmark.xml` (218 x 34 canvas, paths named
`logo` follow the theme).

## Pointing the app at the Raspberry Pi server

`defaultServerUrl` is the server the app uses until another one is picked. Right now it is a
placeholder (`https://vault-pi.invalid`) that leads nowhere.

1. Put the Pi's address in `vault/brand.properties`.
2. `vault/build.sh --install`.

The planned addresses (see `server/README.md`):

- `https://vault.<tailnet>.ts.net`, reached over Tailscale with a publicly trusted certificate.
  The phone needs Tailscale switched on; it then works on Wi-Fi and mobile data. The `<tailnet>`
  part exists once the owner has signed the Pi in to Tailscale.
- Fallback on the home Wi-Fi only: `https://192.168.1.20`, with the Pi's own certificate
  authority ("Taviri Root"), which has to be installed on the phone first.

The address must be **https**. The app trusts certificates installed on the phone by the user, so
a private certificate authority works once its certificate is installed in Android's settings.
Plain `http://` is refused by the app's network rules
(`app/src/main/res/xml/network_security_config.xml`); allowing it for one host is a small edit
there.

Without rebuilding, the server can also be changed on the phone: login screen → **Logging in on**
→ **Self-hosted**. A choice made there wins over the built-in default.

### While there is no server

As long as `defaultServerUrl` is a placeholder (a host under `.invalid`, which can never exist)
the app says so instead of failing with Bitwarden's generic "An error has occurred":

- the login screen shows a note, "No server yet", under the server selector;
- Continue and Create account open a "No server yet" message before any password is typed;
- nothing typed is sent anywhere, since the address cannot resolve.

Independently of the placeholder, a login that fails because the server does not answer
(unknown name, refused connection, timeout) now names the server and suggests checking Tailscale
or the home Wi-Fi. Texts: `app/src/main/res/values/vault_strings.xml`.

## The signing key

- Keystore: `~/.config/vault-android/release.p12` (outside the repo, alias `vault`).
- Its password: macOS Keychain, item `vault-android-release-key` (account `vault`). It was
  generated randomly and has never been printed or written to a file. `vault/build.sh` pipes it
  from the Keychain into `apksigner`.
- Created by `vault/make-key.sh`, which refuses to overwrite an existing key.

**Back up the keystore file.** Android only accepts an update signed with the same key; with a
new key the app has to be uninstalled first (its local data goes, the vault on the server stays).

## Bitwarden's SDK

The app needs Bitwarden's Rust SDK. Bitwarden publishes it on GitHub Packages, which wants a token
with the `read:packages` scope; a default `gh` login does not have it. So
`vault/build-sdk.sh` builds the same SDK from source (`bitwarden/sdk-internal`, the exact commit
the app pins, arm64 only) into `vault/sdk-repo`, and Gradle looks there first. `vault/build.sh`
runs it by itself when the pinned version is missing (about 10 minutes, the first time).

To use Bitwarden's own build instead, run `gh auth refresh -h github.com -s read:packages` once,
then `GITHUB_TOKEN=$(gh auth token) vault/build.sh`.

## Extra fields on a login

A login's **custom fields** are filled into the boxes named like them, as in the browser extension
fork and the Grok Bot connector (`docs/recipes.md`, section 1):

- The field name is compared with the box's label, placeholder, name, id and title, ignoring case
  and accents. Equal beats "contains" beats "all words present".
- If two boxes match equally well, neither is filled. A box takes one field. Password boxes never
  take a custom field.
- Extra fields are placed before the username, so a box labelled "Numéro fiscal" gets that field
  and not the username.
- Text boxes, drop-downs (the choice whose text is the value) and checkboxes (ticked for
  `true`, `1`, `yes`, `oui`, `on`) are handled. Linked fields, rule-style names (`id=…`) and
  `grokbot:recipe` are skipped.

Limits on Android: it works where the app receives real form details, which means native apps and
browsers with native autofill (Chrome with "Autofill using another service", Firefox). It fills
together with a login, so a page that shows only an extra box and no username or password box gets
no suggestion. Saved entry steps (`grokbot:recipe`) are not run on Android.

Code: `app/src/main/kotlin/com/x8bit/bitwarden/data/autofill/customfield/`, tests next to it under
`app/src/test`.

## Taking Bitwarden's updates

```bash
git fetch upstream
```

```bash
git merge upstream/main
```

```bash
vault/build.sh --install
```

Conflicts can only come from the files marked `Vault fork:`; for generated files (icons, palette
values, `app/src/vault/res`) keep either side and let `vault/build.sh` regenerate them.
GitHub Actions are switched off in this repo, so Bitwarden's workflows never run here.

## What differs from the official app

- F-Droid flavour: no Google services, so **no push notifications**. The vault syncs when the app
  is opened or refreshed.
- Both apps answer `bitwarden://` links (two-step login with a security key, SSO), so Android may
  ask which app to open while both are installed.
- Passkey and autofill provider entries appear under the fork's own name.
- Bitwarden's own tests: the ones touched by the fork are adjusted and pass (`*autofill*`,
  `*landing*`, `*login*`, `*startregistration*` view models, the default-server test in `data`).
  Screen tests that look for English text containing "Bitwarden" fail under the rename (for
  example one in `StartRegistrationScreenTest`); the full upstream suite has not been run.
