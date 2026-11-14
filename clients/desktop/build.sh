#!/bin/zsh
# Builds Taviri.app (the Bitwarden desktop app fork) from the worktree in ./clients.
#
#   ./build.sh                 icons + Rust + webpack + package + ad-hoc signature
#   ./build.sh --install       ... and copy it to ~/Applications/Taviri.app (stops if Taviri is open)
#   ./build.sh --install --quit   ... quitting a running Taviri first
#   ./build.sh --skip-native   reuse the last Rust build (when only TypeScript changed)
#   ./build.sh --install-only  copy the last build to ~/Applications without rebuilding
#
# Name and ids: clients/apps/desktop/taviri/brand.json (the name itself is read from the
# browser extension's brand.json, see README.md). Output: clients/apps/desktop/dist/mac-arm64/.
# Caches (cargo, Electron download) go to ./.cache on this disk, which backups skip.
set -euo pipefail

HERE="${0:A:h}"
CLIENTS="${TAVIRI_CLIENTS_DIR:-${HERE:h}/upstream}"
DESKTOP="$CLIENTS/apps/desktop"
CACHE="$HERE/.cache"
INSTALL_DIR="$HOME/Applications"

install=0; native=1; build=1; quit=0
for arg in "$@"; do
  case "$arg" in
    --install) install=1 ;;
    --skip-native) native=0 ;;
    --install-only) install=1; build=0 ;;
    --quit) quit=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

step() { print -P "\n%F{green}== $*%f"; }
brand() { (cd "$DESKTOP" && node taviri/brand.js "$1"); }

[[ -d "$DESKTOP" ]] || { echo "missing $CLIENTS: run ../apply.sh first" >&2; exit 1; }
NAME="$(brand name)"
APP_ID="$(brand appId)"
APP="$DESKTOP/dist/mac-arm64/$NAME.app"

if (( build )); then
  mkdir -p "$CACHE"
  [[ -f "$CACHE/CACHEDIR.TAG" ]] || printf 'Signature: 8a477f597d28d172789f06886806bc55\n' > "$CACHE/CACHEDIR.TAG"

  if [[ ! -d "$CLIENTS/node_modules" ]]; then
    step "npm ci (first build)"
    (cd "$CLIENTS" && ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --ignore-scripts --no-audit --no-fund)
  fi

  step "icons from the brand kit"
  (cd "$DESKTOP" && node taviri/make-icons.js)

  if (( native )); then
    step "Rust: native module + desktop_proxy (release)"
    # Upstream pins Rust 1.97.1 (desktop_native/rust-toolchain.toml). Use an installed toolchain
    # that is at least that new instead of installing one; never changes the default toolchain.
    if [[ -z "${RUSTUP_TOOLCHAIN:-}" ]]; then
      for tc in 1.97.1 1.98.0 1.99.1; do
        if rustup run "$tc" rustc --version >/dev/null 2>&1; then export RUSTUP_TOOLCHAIN="$tc"; break; fi
      done
    fi
    export CARGO_HOME="${CARGO_HOME_TAVIRI:-$CACHE/cargo}"
    export TAVIRI_APP_ID="$APP_ID"
    export TAVIRI_SSH_SOCK_NAME="$(brand sshSocketName)"
    (cd "$DESKTOP/desktop_native" && node build.js --release)
    # The ids are baked in at compile time; a build without them would share Bitwarden's sockets.
    strings "$DESKTOP/desktop_native/dist/desktop_proxy.darwin-arm64" | grep -q "$APP_ID" \
      || { echo "desktop_proxy was built without TAVIRI_APP_ID" >&2; exit 1; }
    strings "$DESKTOP/desktop_native/napi/desktop_napi.darwin-arm64.node" | grep -q "$TAVIRI_SSH_SOCK_NAME" \
      || { echo "native module was built without TAVIRI_SSH_SOCK_NAME" >&2; exit 1; }
  fi

  step "webpack (main, renderer, preload)"
  (cd "$DESKTOP" && npm run build)

  step "package $NAME.app (unsigned, arm64)"
  rm -rf "$DESKTOP/dist"
  (cd "$DESKTOP" && \
    ELECTRON_CACHE="$CACHE/electron" ELECTRON_BUILDER_CACHE="$CACHE/electron-builder" \
    CSC_IDENTITY_AUTO_DISCOVERY=false \
    npx electron-builder --config taviri/electron-builder.taviri.js --mac dir --arm64 -p never)

  # Apple silicon only runs signed code, and there is no Bitwarden Developer ID here. The app is
  # signed with the local identity from signing/make-signing-identity.sh: the same certificate
  # every time, so the keychain keeps trusting rebuilds. Without it, ad hoc ("-"): runs the
  # same, but each rebuild looks like a new app to the keychain (password prompts, see README).
  SIGN_KC="$HOME/Library/Keychains/taviri-signing.keychain-db"
  SIGN_NAME="Taviri Local Signing"
  sign=(--sign -)
  if [[ -f "$SIGN_KC" ]] && kc_pw="$(security find-generic-password -s taviri-signing-keychain -a taviri -w 2>/dev/null)"; then
    security unlock-keychain -p "$kc_pw" "$SIGN_KC"
    unset kc_pw
    sign_hash="$(security find-identity -p codesigning "$SIGN_KC" | awk -v n="\"$SIGN_NAME\"" 'index($0, n) {print $2; exit}')"
    [[ -n "$sign_hash" ]] && sign=(--sign "$sign_hash" --keychain "$SIGN_KC" --timestamp=none)
  fi
  if [[ "${sign[2]}" == "-" ]]; then
    step "ad-hoc signature (run signing/make-signing-identity.sh for a stable one)"
  else
    step "signature: $SIGN_NAME"
  fi
  codesign --force --deep "${sign[@]}" "$APP"
  for proxy in "$APP/Contents/MacOS/desktop_proxy" "$APP/Contents/MacOS/desktop_proxy.inherit"; do
    codesign --force "${sign[@]}" --identifier "$APP_ID" "$proxy"
  done
  codesign --force "${sign[@]}" "$APP"
  [[ -f "$SIGN_KC" ]] && security lock-keychain "$SIGN_KC"
  codesign --verify --deep --strict "$APP"
  codesign --display --requirements - "$APP" 2>&1 | grep -o 'designated => .*'

  step "checks"
  plist="$APP/Contents/Info.plist"
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")" == "$APP_ID" ]]
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleName' "$plist")" == "$NAME" ]]
  ! /usr/libexec/PlistBuddy -c 'Print :BitwardenAppGroupIdentifier' "$plist" >/dev/null 2>&1
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleURLTypes:0:CFBundleURLSchemes:0' "$plist")" == "$(brand urlScheme)" ]]
  [[ -f "$APP/Contents/Resources/LICENSE_GPL.txt" && -f "$APP/Contents/Resources/NOTICE.txt" ]]
  echo "ok: $APP ($(du -sh "$APP" | cut -f1))"
fi

if (( install )); then
  [[ -d "$APP" ]] || { echo "nothing built yet: $APP" >&2; exit 1; }
  step "install to $INSTALL_DIR/$NAME.app"
  main_exe="$INSTALL_DIR/$NAME.app/Contents/MacOS/$NAME"
  if pgrep -xf "$main_exe( .*)?" >/dev/null; then
    if (( ! quit )); then
      echo "$NAME is open: quit it first, or run again with --quit (the build is kept in $APP)" >&2
      exit 1
    fi
    # A plain TERM signal, like quitting from the menu (no AppleScript, so no automation prompt).
    echo "quitting the running $NAME first"
    pkill -TERM -xf "$main_exe( .*)?" || true
    for _ in {1..30}; do pgrep -xf "$main_exe( .*)?" >/dev/null || break; sleep 0.5; done
    pgrep -xf "$main_exe( .*)?" >/dev/null && { echo "$NAME did not quit" >&2; exit 1; }
  fi
  mkdir -p "$INSTALL_DIR"
  rm -rf "$INSTALL_DIR/$NAME.app"
  ditto "$APP" "$INSTALL_DIR/$NAME.app"
  # Tell Launch Services about the app (icon, taviri:// links) without opening it.
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
    -f "$INSTALL_DIR/$NAME.app" || true
  echo "installed: $INSTALL_DIR/$NAME.app (data: ~/Library/Application Support/$(brand dataFolder))"
fi
