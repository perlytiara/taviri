# End-to-end tests

The built extension (`../build/chrome-mv3`) is loaded unpacked in a separate, headless Chrome for
Testing profile (recreated on every run), logs in to a fake local vault and fills
fake local sites. Fake data only. The test browser cannot reach anything but this Mac: every host
name except `localhost` and `*.localhost` is blocked.

## Pieces

| File | What it does |
|---|---|
| `site-server.mjs` | Fake sites on `http://*.localhost:8471` (see the list at the top of the file) |
| `start-test-vault.sh` | Throwaway Vaultwarden on `https://127.0.0.1:8470` (self-signed certificate) |
| `seed-vault.mjs` | Creates a fake account and the test logins on that Vaultwarden |
| `run-e2e.mjs` | Runs the scenarios in Chrome for Testing, writes `results/e2e-results.md` and `.json` |
| `run-e2e-firefox.mjs` | The same sites with the Firefox build, writes `results/e2e-firefox-results.md` and `.json` |
| `firefox-bidi.mjs` | A small WebDriver BiDi driver for a throwaway headless Firefox |
| `paths.mjs` | Where the tests look for the fork, the built extension and the test vault |

## One-time setup: the throwaway Vaultwarden

Bitwarden clients only talk to HTTPS servers, so the test vault has its own certificate. Built
once in `~/vaultwarden-test` (about 2 GB with its Rust toolchain; safe
to delete, nothing else uses it):

```bash
git clone --depth 1 --branch 1.37.5 https://github.com/dani-garcia/vaultwarden.git ~/vaultwarden-test
```

```bash
cd ~/vaultwarden-test && RUSTUP_HOME=$PWD/.toolchain/rustup CARGO_HOME=$PWD/.toolchain/cargo rustup toolchain install 1.99.1 --profile minimal
```

```bash
cd ~/vaultwarden-test && RUSTUP_HOME=$PWD/.toolchain/rustup CARGO_HOME=$PWD/.toolchain/cargo CARGO_PROFILE_RELEASE_LTO=false CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16 cargo build --features sqlite --release
```

```bash
mkdir -p ~/vaultwarden-test/tls && cd ~/vaultwarden-test/tls && openssl req -x509 -newkey rsa:2048 -nodes -days 60 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" -keyout key.pem -out cert.pem && openssl x509 -in cert.pem -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64 > spki.txt
```

The certificate lasts 60 days; rerun the last command (and restart the vault) when it expires.

## Run

Two servers, each in its own terminal tab:

```bash
clients/extension/test/start-test-vault.sh
```

```bash
node clients/extension/test/site-server.mjs
```

Then seed the vault (again after changing the test logins in `seed-vault.mjs`) and run:

```bash
NODE_EXTRA_CA_CERTS=~/vaultwarden-test/tls/cert.pem node clients/extension/test/seed-vault.mjs
```

```bash
node clients/extension/test/run-e2e.mjs
```

`node run-e2e.mjs bank game` runs only those scenarios; `--verbose` prints the pages' console.

Firefox:

```bash
node clients/extension/test/run-e2e-firefox.mjs
```

It runs a temporary copy of `/Applications/Firefox Nightly.app` (an instant APFS clone, deleted
afterwards), never the installed app: starting the installed Nightly a second time makes Firefox
apply the update your open Nightly has staged, under it, and relaunch the test with a visible
window. That happened once on 2026-11-14.

The fake account, the Bitwarden CLI's data (kept apart from your own `bw` configuration) and the
test browser profile live in `~/vaultwarden-test/smartfill-state`, next to the test
vault and outside the Drive mirror. Deleting `~/vaultwarden-test` removes all of it.
