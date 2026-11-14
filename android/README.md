# Taviri for Android

Built from Bitwarden's [Android app](https://github.com/bitwarden/android) at the commit in
[UPSTREAM.txt](UPSTREAM.txt) plus the patch series in [`patches/`](patches/) (one line per patch:
[patches/README.md](patches/README.md)).

The fork's own tooling lives in a `vault/` folder that the first patch adds; the few edits to
Bitwarden's code are marked `Vault fork:` (`git grep "Vault fork"` in the patched tree lists
them). The folder's own notes, as they read after the patches:
[docs/vault-folder.md](docs/vault-folder.md).

What it changes:

- own package id (`io.github.perlytiara.taviri`), name, launcher icon, logos and colours, all
  generated from `vault/brand.properties` and the [brand kit](../brand/);
- F-Droid flavour: no Google services, so no push notifications (the vault syncs when the app is
  opened or refreshed);
- a login's custom fields are filled into the boxes named like them, with the same rules as the
  browser extension;
- a built-in default server with a clear "No server yet" state while it is a placeholder, and a
  clearer message when the server does not answer.

## Build

```bash
android/apply.sh
```

Then, in `android/upstream`, follow [docs/vault-folder.md](docs/vault-folder.md). In short, it
needs JDK 21, the Android SDK and, the first time, Rust with the Android NDK: `vault/build-sdk.sh`
builds Bitwarden's SDK (`bitwarden/sdk-internal`, the commit the app pins) from source, so no
GitHub Packages token is needed. Release builds are signed with your own key:
`vault/make-key.sh` creates one and keeps its password in the macOS Keychain. Then:

```bash
vault/build.sh
```

The signed APK is in `vault/out/`. Set `defaultServerUrl` in `vault/brand.properties` to your
server first (https only), or pick the server on the login screen.

## Tests

The fork's unit tests live next to the code they test, for example
`app/src/test/kotlin/com/x8bit/bitwarden/data/autofill/customfield/`. Run them with Gradle as for
upstream (see upstream's `README.md`). Screen tests that look for English text containing
"Bitwarden" fail under the rename; the full upstream suite has not been run on the fork.
