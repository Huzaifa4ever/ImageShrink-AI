#!/bin/sh

set -eu

STAMP_NAME=.ci-install-stamp
KEYS=""
DIR=""

while [ $# -gt 0 ]; do
  case "$1" in
    --key) KEYS="$KEYS $2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    --) shift; break ;;
    *) echo "cached-install: unexpected argument '$1'" >&2; exit 2 ;;
  esac
done

[ -n "$KEYS" ] || { echo "cached-install: at least one --key is required" >&2; exit 2; }
[ -n "$DIR" ]  || { echo "cached-install: --dir is required" >&2; exit 2; }
[ $# -gt 0 ]   || { echo "cached-install: no install command given after --" >&2; exit 2; }

for key in $KEYS; do
  [ -f "$key" ] || { echo "cached-install: key file '$key' does not exist" >&2; exit 2; }
done

WANT=$(cat $KEYS | sha256sum | cut -d' ' -f1)
STAMP="$DIR/$STAMP_NAME"

if [ "${REFRESH_CACHES:-false}" = "true" ]; then
  echo "cache: REFRESH_CACHES is set - reinstalling $DIR"
elif [ -d "$DIR" ] && [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$WANT" ]; then
  echo "cache HIT  $DIR is current for:$KEYS"
  exit 0
elif [ -d "$DIR" ]; then
  echo "cache MISS $DIR exists but was built from different dependencies - reinstalling"
else
  echo "cache MISS $DIR does not exist - installing"
fi

"$@"

mkdir -p "$DIR"
printf '%s' "$WANT" > "$STAMP"
echo "cache: stamped $DIR"
