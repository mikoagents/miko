#!/usr/bin/env bash
# Render scripts/og/og.html to public/og.jpg (1200x630).
# Needs a Chromium binary: set CHROME, or install one with `npx playwright install chromium-headless-shell`.
set -euo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"
out="$dir/../../public/og.jpg"
tmp="$(mktemp -t miko-og).png"
trap 'rm -f "$tmp"' EXIT

chrome="${CHROME:-}"
if [[ -z "$chrome" ]]; then
	chrome="$(ls -d "$HOME"/Library/Caches/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell 2>/dev/null | tail -1 || true)"
fi
if [[ -z "$chrome" ]]; then
	echo "No Chromium found. Set CHROME=/path/to/chrome." >&2
	exit 1
fi

# Render at 2x, then downscale for crisp text.
"$chrome" --headless --disable-gpu --hide-scrollbars --allow-file-access-from-files \
	--force-device-scale-factor=2 --window-size=1200,630 \
	--virtual-time-budget=2000 \
	--screenshot="$tmp" "file://$dir/og.html" >/dev/null 2>&1

sips -z 630 1200 -s format jpeg -s formatOptions 90 "$tmp" --out "$out" >/dev/null
echo "Wrote $out"
