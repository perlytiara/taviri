#!/usr/bin/env bash
# Fetches bitwarden/clients at the pinned tag (UPSTREAM.txt) into clients/upstream and applies the
# Taviri patch series on a branch named taviri.
#
#   clients/apply.sh            first time
#   clients/apply.sh --force    delete clients/upstream and start over
#
# TAVIRI_CLIENTS_URL overrides where upstream is fetched from (a mirror or a local clone).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
field() { awk -v k="$1" '$1 == k { print $2 }' "$here/UPSTREAM.txt"; }
url="${TAVIRI_CLIENTS_URL:-$(field repository)}"
tag="$(field tag)"
commit="$(field commit)"
dest="$here/upstream"

if [ -e "$dest" ]; then
  [ "${1:-}" = "--force" ] || { echo "$dest already exists (--force starts over)" >&2; exit 1; }
  rm -rf "$dest"
fi

git init -q "$dest"
git -C "$dest" fetch -q --depth 1 "$url" "refs/tags/$tag:refs/tags/$tag"
got="$(git -C "$dest" rev-parse "refs/tags/$tag^{commit}")"
[ "$got" = "$commit" ] || { echo "tag $tag points to $got, expected $commit: stopping" >&2; exit 1; }
git -C "$dest" checkout -q -b taviri "$commit"
GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-taviri}" GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-taviri@localhost}" \
  git -C "$dest" am -q --whitespace=nowarn "$here"/patches/*.patch

echo "clients/upstream: $tag + $(ls "$here"/patches/*.patch | wc -l | tr -d ' ') patches (branch taviri)"
echo "next: (cd clients/upstream && npm ci), then clients/extension/build.sh or clients/desktop/build.sh"
