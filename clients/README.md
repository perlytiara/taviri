# Taviri browser extension and desktop app

Both are built from Bitwarden's [clients](https://github.com/bitwarden/clients) monorepo at tag
`browser-v2026.10.2` (see [UPSTREAM.txt](UPSTREAM.txt)) plus the patch series in [`patches/`](patches/):
the extension's changes first, then the desktop app's. The list with one line per patch is in
[patches/README.md](patches/README.md).

What each patch changes, file by file: [docs/extension-changes.md](docs/extension-changes.md)
and [docs/desktop-changes.md](docs/desktop-changes.md). Only the open-source configurations are
built; nothing under `bitwarden_license/` is touched or used.

## Get the patched source

```bash
clients/apply.sh
```

It fetches the pinned tag into `clients/upstream`, checks the commit, and applies the patches
with `git am` (so `git log` in there shows each change). Then install the dependencies, as for
upstream (Node.js 24.17 or later, npm 11):

```bash
cd clients/upstream && npm ci
```

## Browser extension

```bash
clients/extension/build.sh all
```

Output in `clients/extension/build/`: `chrome-mv3/` (load it unpacked in a Chromium browser with
Developer mode on), `firefox-mv2/` and `firefox.xpi` (Firefox Developer Edition or Nightly with
unsigned add-ons allowed, or as a temporary add-on). The extension has its own Firefox id, so it
installs next to the official Bitwarden extension.

The name and colour come from `apps/browser/webpack/smartfill-brand/brand.json` in the patched
tree; the artwork from [`../brand/`](../brand/). `SMARTFILL_BRANDING=off` builds the upstream
look with the new autofill features.

## Desktop app (macOS, Apple silicon)

```bash
clients/desktop/build.sh
```

Needs Xcode command line tools and a Rust toolchain (for the native module), like upstream's
desktop build. It packages `Taviri.app` in `clients/upstream/apps/desktop/dist/mac-arm64/`;
`--install` copies it to `~/Applications`. Optional, once: `clients/desktop/signing/make-signing-identity.sh`
creates a local self-signed code-signing identity in a keychain of its own, so rebuilds keep the
same signature and the keychain keeps trusting the app; without it the app is signed ad hoc.

For desktop unlock from the extension, put your extension's id in
`apps/desktop/taviri/brand.json` (`chromeExtensionIds`) before building: on Chromium browsers an
unpacked extension's id depends on where it was loaded from.

## Tests

Unit tests, from `clients/upstream`:

```bash
cd apps/browser && npx jest src/autofill/smartfill
```

```bash
npx jest --config libs/common/jest.config.js libs/common/src/vault/icon
```

End-to-end tests run the built extension in a separate headless Chrome for Testing profile (and
a throwaway Firefox) against a local Vaultwarden with a fake account and fake sites; nothing can
leave the machine. Setup and commands: [extension/test/README.md](extension/test/README.md); last
results: [extension/test/results/](extension/test/results/). The desktop app has scripted login
and browser-bridge tests in [desktop/test/](desktop/test/).
