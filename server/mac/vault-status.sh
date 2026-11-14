#!/usr/bin/env bash
# One glance: is the vault healthy? (Same checks as the https://<vault>/status/ page.)
. "$(cd "$(dirname "$0")" && pwd)/common.sh"
pi 'vaultctl status'
