#!/bin/bash
# Adapter for the launcher's credential-helper contract. Tokens stay in the child environment.
set +x
set -eu
if [ "$#" -lt 4 ] || [ "$1" != REWB-CONFLUENCE-API-TOKEN ] || [ "$2" != REWB_TOKEN ] || [ "$3" != -- ]; then
  printf 'Invalid credential-helper arguments.\n' >&2
  exit 2
fi
: "${BWS_KEYCHAIN_SERVICE:?Set the Keychain item name}"
: "${BWS_KEYCHAIN_ACCOUNT:?Set the Keychain account}"
shift 3
if ! REWB_TOKEN=$(/usr/bin/security find-generic-password -s "$BWS_KEYCHAIN_SERVICE" -a "$BWS_KEYCHAIN_ACCOUNT" -w 2>/dev/null) || [ -z "$REWB_TOKEN" ]; then
  printf 'Cannot read the Confluence token. Check or unlock Keychain.\n' >&2
  exit 1
fi
export REWB_TOKEN
exec "$@"
