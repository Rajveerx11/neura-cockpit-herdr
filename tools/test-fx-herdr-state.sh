#!/usr/bin/env bash
# Focused, offline regression proof for the optional fx v0.0.13 state patch.
set -euo pipefail
if [[ $# -ne 2 ]]; then
  printf 'Usage: %s /path/to/patched-fx-v0.0.13 /path/to/linux-zig-0.16.0\n' "$0" >&2
  exit 2
fi
source_dir=$(realpath "$1")
zig=$(realpath "$2")
[[ "$("$zig" version)" = 0.16.0 ]] || { echo 'Zig 0.16.0 required.' >&2; exit 2; }
[[ "$(git -C "$source_dir" describe --tags --always)" = v0.0.13 ]] || { echo 'fx v0.0.13 source required.' >&2; exit 2; }
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT
cat > "$tmp/options.zig" <<'ZIG'
pub const git_commit = "local-herdr-state-patch";
pub const app_version = "0.0.13";
pub const update_channel = "stable";
pub const wasm_surface = enum { none, core, term }.none;
ZIG
cat > "$tmp/session-options.zig" <<'ZIG'
pub const hooks = false;
pub const trace_dir = "/tmp/fx-herdr-state-tests";
pub const src_dir = "src/core/session_manager";
ZIG
cd "$source_dir"
"$zig" fmt --check src/builtins/hooks.zig src/builtins/hooks/herdr.zig src/core/app/app_worker_runtime.zig src/main.zig
"$zig" test -lc -O ReleaseSafe --cache-dir "$tmp/cache" \
  --test-filter core.app_worker_runtime --test-filter Herdr \
  --test-filter report_agent --test-filter shouldEnable --test-filter clampStatus \
  --dep build_options --dep session_manager -Mroot=src/main.zig \
  -Mbuild_options="$tmp/options.zig" --dep build_options=sm_options \
  -Msession_manager=src/core/session_manager/api.zig \
  -Msm_options="$tmp/session-options.zig"
