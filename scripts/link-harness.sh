#!/bin/sh
# Align this package's dev dependencies with the dsh it targets.
#
# Usage: sh scripts/link-harness.sh [--harness] [dsh-root | harness-checkout]
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/node_modules/@deepseek-ai"

PACKAGES="cordis schemastery dsh-credentials dsh-launch-environment dsh-web \
dsh-web-search-deepseek dsh-api-remotes dsh-client-locale dsh-client-store \
dsh-client-ui-plugin-manager dsh-client-ui-primitives dsh-client-ui-renderer \
dsh-client-ui-settings dsh-client-ui-slots"

harness_path_of() {
  case "$1" in
    cordis) echo vendor/cordis ;;
    schemastery) echo vendor/schemastery ;;
    dsh-credentials) echo packages/credentials/credentials ;;
    dsh-launch-environment) echo packages/core/launch-environment ;;
    dsh-web) echo packages/web/web ;;
    dsh-web-search-deepseek) echo packages/web/search-deepseek ;;
    dsh-api-remotes) echo packages/api/remotes ;;
    dsh-client-locale) echo packages/client/locale ;;
    dsh-client-store) echo vendor/dsh-client-store ;;
    dsh-client-ui-plugin-manager) echo packages/client/ui-plugin-manager ;;
    dsh-client-ui-primitives) echo packages/client/ui-primitives ;;
    dsh-client-ui-renderer) echo packages/client/ui-renderer ;;
    dsh-client-ui-settings) echo packages/client/ui-settings ;;
    dsh-client-ui-slots) echo packages/client/ui-slots ;;
    *) echo "" ;;
  esac
}

mode=install
arg=""
for a in "$@"; do
  case "$a" in
    --harness) mode=harness ;;
    *) arg="$a" ;;
  esac
done

install_modules=""
if [ "$mode" = "install" ]; then
  dsh_root="${arg:-${DSH_INSTALL:-}}"
  if [ -z "$dsh_root" ]; then
    npm_root="$(npm root -g 2>/dev/null || true)"
    [ -n "$npm_root" ] && [ -d "$npm_root/@deepseek-ai/dsh" ] && dsh_root="$npm_root/@deepseek-ai/dsh"
  fi
  if [ -z "$dsh_root" ]; then
    dsh_bin="$(command -v dsh 2>/dev/null || true)"
    if [ -n "$dsh_bin" ]; then
      resolved="$(readlink -f "$dsh_bin" 2>/dev/null || echo "$dsh_bin")"
      dsh_root="$(cd "$(dirname "$resolved")/../.." 2>/dev/null && pwd)/@deepseek-ai/dsh"
    fi
  fi
  [ -n "$dsh_root" ] && [ -d "$dsh_root/node_modules/@deepseek-ai" ] && install_modules="$dsh_root/node_modules/@deepseek-ai"
fi

harness="${HARNESS:-}"
if [ -z "$harness" ]; then
  candidate="$(cd "$ROOT/../../deepseek-harness" 2>/dev/null && pwd || true)"
  [ -n "$candidate" ] && harness="$candidate"
fi
if [ "$mode" = "harness" ] && [ -n "$arg" ]; then
  harness="$(cd "$arg" && pwd)"
fi

mkdir -p "$DEST"
linked=""
missing=""

for pkg in $PACKAGES; do
  if [ -n "$install_modules" ] && [ -d "$install_modules/$pkg" ]; then
    ln -sfn "$install_modules/$pkg" "$DEST/$pkg"
    linked="$linked $pkg"
    continue
  fi
  rel="$(harness_path_of "$pkg")"
  if [ -n "$harness" ] && [ -n "$rel" ] && [ -d "$harness/$rel" ]; then
    ln -sfn "$harness/$rel" "$DEST/$pkg"
    linked="$linked $pkg(harness)"
    continue
  fi
  missing="$missing $pkg"
done

echo "linked:$linked"
if [ -n "$missing" ]; then
  echo "missing (no installed dsh or harness checkout):$missing" >&2
  exit 1
fi
