#!/usr/bin/env bash
# Fetches bitwarden/android at the pinned commit (UPSTREAM.txt) into android/upstream and applies the
# Taviri patch series on a branch named taviri.
#
#   android/apply.sh            first time
#   android/apply.sh --force    delete android/upstream and start over
#
# TAVIRI_ANDROID_URL overrides where upstream is fetched from (a mirror or a local clone).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
field() { awk -v k="$1" '$1 == k { print $2 }' "$here/UPSTREAM.txt"; }
url="${TAVIRI_ANDROID_URL:-$(field repository)}"
commit="$(field commit)"
dest="$here/upstream"

if [ -e "$dest" ]; then
  [ "${1:-}" = "--force" ] || { echo "$dest already exists (--force starts over)" >&2; exit 1; }
  rm -rf "$dest"
fi

git init -q "$dest"
git -C "$dest" fetch -q --depth 1 "$url" "$commit"
git -C "$dest" checkout -q -b taviri "$commit"
GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-taviri}" GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-taviri@localhost}" \
  git -C "$dest" am -q --whitespace=nowarn "$here"/patches/*.patch

echo "android/upstream: ${commit:0:9} + $(ls "$here"/patches/*.patch | wc -l | tr -d ' ') patches (branch taviri)"
echo "next: read android/README.md (signing key, SDK), then: cd android/upstream && vault/build.sh"
