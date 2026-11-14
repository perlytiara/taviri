#!/bin/zsh
# Creates the local code-signing identity for Taviri builds (once). Run again: does nothing.
#
# Why: an ad-hoc signature changes with every build, so macOS treats each rebuild as a new app
# and asks for the login keychain password before it may read its own items again. A build
# signed with the same certificate keeps the same identity, so the keychain (and any privacy
# permission) keeps trusting it across rebuilds.
#
# What it makes, all on this Mac only:
# - a self-signed certificate "Taviri Local Signing" (code signing only, 10 years) and its
#   private key, in a separate keychain ~/Library/Keychains/taviri-signing.keychain-db that is
#   not in the keychain search list (Keychain Access does not show it; Safari & co. never use it);
# - that keychain's random password, in the login keychain (item "taviri-signing-keychain",
#   created by `security`, so build.sh reads it back without any prompt).
# No password of yours is needed, and nothing is shown on screen. The certificate is not
# trusted system-wide and cannot sign anything Gatekeeper would accept elsewhere; it only gives
# local builds a stable identity. The public certificate is copied next to this script.
#
# Remove: security delete-keychain ~/Library/Keychains/taviri-signing.keychain-db
#         security delete-generic-password -s taviri-signing-keychain -a taviri
set -euo pipefail

NAME="Taviri Local Signing"
KC="$HOME/Library/Keychains/taviri-signing.keychain-db"
ITEM=taviri-signing-keychain
HERE="${0:A:h}"

if [[ -f "$KC" ]] && security find-generic-password -s "$ITEM" -a taviri >/dev/null 2>&1; then
  pw="$(security find-generic-password -s "$ITEM" -a taviri -w)"
  security unlock-keychain -p "$pw" "$KC"
  if security find-identity -p codesigning "$KC" | grep -q "\"$NAME\""; then
    echo "already set up: \"$NAME\" in $KC"
    security lock-keychain "$KC"
    exit 0
  fi
  security lock-keychain "$KC"
  echo "keychain exists but has no \"$NAME\" identity; remove it first (see the top of this script)" >&2
  exit 1
fi
[[ -f "$KC" ]] && { echo "$KC exists without its password item; remove it first" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
umask 077

# The keychain's password: random, only ever in the login keychain.
pw="$(/usr/bin/openssl rand -hex 32)"
security add-generic-password -s "$ITEM" -a taviri -l "Taviri signing keychain" \
  -D "keychain password" -j "Unlocks ~/Library/Keychains/taviri-signing.keychain-db for taviri-desktop/build.sh" \
  -w "$pw"

security create-keychain -p "$pw" "$KC"
security set-keychain-settings -lu -t 300 "$KC"   # locks itself after 5 minutes and on sleep
security unlock-keychain -p "$pw" "$KC"

# Self-signed certificate for code signing only. /usr/bin/openssl (LibreSSL) writes a .p12
# that `security import` reads.
cat > "$work/cert.cnf" <<EOF
[ req ]
distinguished_name = dn
prompt = no
x509_extensions = ext
[ dn ]
CN = $NAME
O = Taviri (local builds)
[ ext ]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
EOF
/usr/bin/openssl req -x509 -newkey rsa:3072 -sha256 -days 3650 -nodes \
  -keyout "$work/key.pem" -out "$work/cert.pem" -config "$work/cert.cnf" 2>/dev/null
p12pw="$(/usr/bin/openssl rand -hex 16)"
/usr/bin/openssl pkcs12 -export -inkey "$work/key.pem" -in "$work/cert.pem" \
  -name "$NAME" -out "$work/identity.p12" -passout "pass:$p12pw"

security import "$work/identity.p12" -k "$KC" -f pkcs12 -P "$p12pw" \
  -T /usr/bin/codesign -T /usr/bin/security >/dev/null
# Let Apple's tools (codesign) use the key without asking.
security set-key-partition-list -S apple-tool:,apple: -s -k "$pw" "$KC" >/dev/null

cp "$work/cert.pem" "$HERE/taviri-local-signing.pem"
security find-identity -p codesigning "$KC" | grep "\"$NAME\""
security lock-keychain "$KC"
echo "created: \"$NAME\" in $KC (public certificate: $HERE/taviri-local-signing.pem)"
