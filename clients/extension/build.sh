#!/bin/zsh
# Builds the Smartfill fork from the bitwarden/clients checkout (branch smartfill) and copies the
# unpacked extensions here:
#   build/chrome-mv3/     load unpacked in Chrome, Chrome Canary, Brave, Edge…
#   build/firefox-mv2/    temporary add-on in Firefox, plus build/firefox.xpi
# Usage: ./build.sh [chrome|firefox|all]   (default: all)
set -e
HERE="${0:A:h}"
CLIENTS="${SMARTFILL_CLIENTS_DIR:-${HERE:h}/upstream}"
WHAT="${1:-all}"
cd "$CLIENTS/apps/browser"

copy_build() {
  local target="$HERE/build/$1"
  rm -rf "$target"
  mkdir -p "$target"
  # Source maps are large and not needed to run the extension.
  rsync -a --exclude '*.map' ./build/ "$target/"
  echo "→ $target ($(du -sh "$target" | cut -f1))"
}

if [[ "$WHAT" == "all" || "$WHAT" == "chrome" ]]; then
  NODE_ENV=production npm run build:chrome
  copy_build chrome-mv3
fi

if [[ "$WHAT" == "all" || "$WHAT" == "firefox" ]]; then
  NODE_ENV=production npm run build:firefox
  copy_build firefox-mv2
  rm -f "$HERE/build/firefox.xpi"
  (cd "$HERE/build/firefox-mv2" && zip -qr "$HERE/build/firefox.xpi" .)
  echo "→ $HERE/build/firefox.xpi"
fi
