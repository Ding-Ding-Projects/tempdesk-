#!/usr/bin/env bash
# Enable the broker on an existing local Linux portal deployment.
set -euo pipefail
die() { printf '%s\n' "$1" >&2; exit 1; }
(( $# >= 1 && $# <= 2 )) || die 'Usage: bash compose-kiosk.sh /absolute/credential [ /absolute/ca.pem ]'
cd -- "$(dirname -- "$0")"
repo=$(realpath -e -- ..)
endpoint=${DOCKER_HOST:-}
if [[ -z $endpoint || -n ${DOCKER_CONTEXT:-} ]]; then
  endpoint=$(docker context inspect --format '{{.Endpoints.docker.Host}}')
fi
[[ $endpoint == unix:///* ]] || die 'Run on the Docker host with a local Unix socket.'
check_file() {
  local file=$1 resolved parent owner mode
  [[ $file == /* && -f $file && ! -L $file ]] || die 'Supply an existing absolute regular file without symlinks.'
  resolved=$(realpath -e -- "$file")
  [[ $file == "$resolved" && $resolved != "$repo/"* ]] || die 'Use a canonical path outside the source and build context.'
  parent=$(dirname -- "$resolved")
  while [[ $parent != / ]]; do
    mode=$(stat -c '%a' -- "$parent")
    owner=$(stat -c '%u' -- "$parent")
    (( (8#$mode & 0022) == 0 && (owner == 0 || owner == EUID) )) || die 'Use a trusted directory without group or world write access.'
    parent=$(dirname -- "$parent")
  done
}
check_file "$1"
mode=$(stat -c '%a' -- "$1")
owner=$(stat -c '%u' -- "$1")
group=$(stat -c '%g' -- "$1")
(( (8#$mode & 7137) == 0 && ((8#$mode & 0040) == 0 || group == 10001) && (owner == 0 || owner == 10001 || owner == EUID) )) || die 'The broker credential must have restricted ownership and permissions.'
(( (owner == 10001 && (8#$mode & 0400)) || (group == 10001 && (8#$mode & 0040)) )) || die 'The portal UID or GID 10001 must already have read access.'
export TEMPDESK_KIOSK_KEY_SOURCE="$1"
files=(-f compose.yaml)
pull_args=()
published_prefix='ghcr.io/ding-ding-projects/tempdesk-portal@'
digest=${TEMPDESK_PORTAL_DIGEST:-}
if [[ -z $digest ]]; then
  current_guest=$(docker compose "${files[@]}" ps -q tempdesk-guest)
  if [[ -n $current_guest ]]; then
    current_image=$(docker inspect --format '{{.Config.Image}}' "$current_guest")
    if [[ $current_image == "$published_prefix"* ]]; then digest=${current_image#"$published_prefix"}; fi
  fi
fi
if [[ -n $digest ]]; then
  [[ $digest =~ ^sha256:[0-9a-f]{64}$ ]] || die 'Use the exact digest from a portal publication receipt.'
  export TEMPDESK_PORTAL_DIGEST="$digest"
  files+=(-f compose.published.yaml)
  pull_args=(--pull never)
fi
files+=(-f compose.kiosk.yaml)
if (( $# == 2 )); then
  check_file "$2"
  [[ $1 != "$2" && ! "$1" -ef "$2" ]] || die 'Select a separate CA bundle.'
  mode=$(stat -c '%a' -- "$2")
  owner=$(stat -c '%u' -- "$2")
  group=$(stat -c '%g' -- "$2")
  (( (8#$mode & 0022) == 0 && (owner == 0 || owner == EUID) )) || die 'Use a trusted CA file without shared write access.'
  (( (8#$mode & 0004) || (group == 10001 && (8#$mode & 0040)) || (owner == 10001 && (8#$mode & 0400)) )) || die 'The portal must already have read access to the CA bundle.'
  export TEMPDESK_KIOSK_CA_SOURCE="$2"
  files+=(-f compose.kiosk-ca.yaml)
fi
docker compose "${files[@]}" config --quiet
exec docker compose "${files[@]}" up --no-build --no-deps --force-recreate "${pull_args[@]}" -d tempdesk-guest
