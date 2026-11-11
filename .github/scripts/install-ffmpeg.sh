#!/usr/bin/env bash
# Install ffmpeg/ffprobe on a GitHub-hosted runner from a pinned static build.
# apt is not used: on 2026-11-11 the Ubuntu archive (Azure mirror and
# archive.ubuntu.com) was unreachable from runners for hours, while GitHub
# release downloads kept working. Same ffmpeg version as Ubuntu 24.04 (6.1.1).
# Checksums are GitHub's own asset digests for release b6.1.1.
set -euo pipefail

if command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null; then
  exit 0
fi

base=https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1
dir="${RUNNER_TEMP:-/tmp}/ffmpeg-bin"
mkdir -p "$dir"

fetch() {
  local name=$1 sha=$2
  curl -sSfL --retry 3 --connect-timeout 30 -o "$dir/$name.gz" "$base/$name-linux-x64.gz"
  echo "$sha  $dir/$name.gz" | sha256sum -c -
  gunzip -f "$dir/$name.gz"
  chmod +x "$dir/$name"
}

fetch ffmpeg bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa
fetch ffprobe 25d9b6ccb05e3d9de9e04e31e2506d8dd7f9f0418981965ac6df12e8d3afd067

"$dir/ffmpeg" -hide_banner -version >/dev/null
"$dir/ffprobe" -hide_banner -version >/dev/null
echo "$dir" >> "$GITHUB_PATH"
