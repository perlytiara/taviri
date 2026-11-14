# Notice

Taviri is built from the work of others. This file says whose, under which licence, and what
Taviri changed.

## Upstream projects

| Project | Used for | Licence | Copyright |
|---|---|---|---|
| [bitwarden/clients](https://github.com/bitwarden/clients), tag `browser-v2026.10.2` | browser extension (`apps/browser`), desktop app (`apps/desktop`), shared libraries | GPL-3.0 (the Bitwarden License parts are not used, see below) | Bitwarden Inc. |
| [bitwarden/android](https://github.com/bitwarden/android) | Android app | GPL-3.0 | Bitwarden Inc. |
| [bitwarden/sdk-internal](https://github.com/bitwarden/sdk-internal) | the Rust SDK inside the Android app, built from source | GPL-3.0, chosen from its "GPL-3.0 or Bitwarden SDK License" option | Bitwarden Inc. |
| [Vaultwarden](https://github.com/dani-garcia/vaultwarden) 1.37.5 | the server (stock container image; its email and admin templates are rebranded) | AGPL-3.0 | its contributors |
| [bw_web_builds](https://github.com/dani-garcia/bw_web_builds) | the web vault shipped in the Vaultwarden image (rebranded at image build) | GPL-3.0 | Bitwarden Inc. and its contributors |
| [Caddy](https://github.com/caddyserver/caddy) | HTTPS front of the server (stock image) | Apache-2.0 | its authors |

Every file changed by Taviri carries a marker in the code (`Smartfill fork:`, `Taviri fork`,
`Vault fork:`), and every change is in the patch series with a dated commit message, as GPL-3.0
section 5(a) asks. The browser extension and the desktop app ship the GPL text and a notice
that they are modified builds; the server says so on its About page. The Android app says so in
its source and documentation only (an in-app notice is still to do).

## Licences of this repository

| Path | Licence |
|---|---|
| `clients/` (patches, build scripts, tests) | GPL-3.0, [LICENSE](LICENSE) |
| `android/` (patches) | GPL-3.0, [LICENSE](LICENSE) |
| `docs/` | GPL-3.0, [LICENSE](LICENSE) |
| `server/` | AGPL-3.0, [server/LICENSE](server/LICENSE) (copy: [LICENSES/AGPL-3.0.txt](LICENSES/AGPL-3.0.txt)) |
| `brand/` (artwork) | GPL-3.0 as part of the apps that use it; no trademark rights, see below |

Copyright of the changes and of the new files: © 2026 the Taviri author.

**Bitwarden License code is not used.** bitwarden/clients also contains code under the Bitwarden
License (`bitwarden_license/`). No patch touches it, and Taviri builds use only the open-source
configurations (`npm run build:chrome`, `build:firefox`, desktop `build:oss`). The Android SDK is
built without its `bitwarden-license` feature.

**Source for the server's users (AGPL-3.0 section 13).** The server's About page links to the
source of the running build (`BRAND_SOURCE_URL` in `server/stack/image/brand.env`). If you run a
modified server for other people, point that link at your modified source.

**Distributing builds.** GPL-3.0 and AGPL-3.0 require that anyone who receives a build can get
its complete corresponding source. A patch series is not enough on its own once you ship
binaries: publish the full patched source (for example as an archive next to each release), or
point to this repository at the exact commit together with the upstream tag it applies to and
keep both available.

## Trademarks

Bitwarden is a trademark or registered trademark of Bitwarden, Inc. in the United States and/or
other countries. Vaultwarden is the name of a separate open-source project. Both names are used
here only to say truthfully where the code comes from and what it works with. Taviri is not
affiliated with, sponsored or endorsed by Bitwarden, Inc. or the Vaultwarden project.

Following
[Bitwarden's trademark guidelines](https://github.com/bitwarden/server/blob/main/TRADEMARK_GUIDELINES.md),
Taviri replaces Bitwarden's name, logos, icons and colours in the browser extension, the Android
app and the server, and every app has its own ids and data folders. Some texts still name
Bitwarden where they refer to Bitwarden's own servers, products or copyright. **Not finished:**
the desktop app has its own name, icon and ids, but the logos inside its window are still
Bitwarden's; they must be replaced before a desktop build is given to anyone.

The licences above cover the code, not names or logos (GPL-3.0 section 7(e)): they grant no
rights in the name "Taviri" or its logo. If you distribute a modified version, give it your own
name and icon.
