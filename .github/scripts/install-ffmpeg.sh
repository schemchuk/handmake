#!/usr/bin/env bash
# Install ffmpeg/ffprobe on a GitHub-hosted Ubuntu runner.
# The runner's default Azure mirror can stall on every package (seen 2026-11-11),
# so point apt at archive.ubuntu.com instead. Network timeouts and retries make a
# stalled connection fail fast instead of hanging.
set -euo pipefail

if command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null; then
  exit 0
fi

for list in /etc/apt/apt-mirrors.txt /etc/apt/sources.list /etc/apt/sources.list.d/*; do
  if [ -f "$list" ] && grep -q 'azure\.archive\.ubuntu\.com' "$list"; then
    sudo sed -i 's|azure\.archive\.ubuntu\.com|archive.ubuntu.com|g' "$list"
  fi
done

apt_opts=(-o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30)
sudo apt-get "${apt_opts[@]}" update
sudo apt-get "${apt_opts[@]}" install -y --no-install-recommends ffmpeg
