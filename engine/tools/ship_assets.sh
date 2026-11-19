#!/usr/bin/env bash
# Ship-ready runtime assets: sync canonical ../assets -> public/assets, prune authoring/unreferenced files,
# then meshopt + WebP every runtime GLB in place (copies only; ../assets is never touched).
# Run from engine/ via `npm run sync-assets`.
set -euo pipefail
D=public/assets
bash "$HOME/.claude/skills/video-to-game/scripts/sync_assets.sh" ../assets "$D"
find "$D" -type d -name views -prune -exec rm -rf {} +      # reference images
rm -f "$D"/textures/Rock030/Rock030_1K-JPG_*                # unused ambientCG maps (runtime uses Rock030_detail.jpg)
G="${GLTF_TRANSFORM:-$(command -v gltf-transform || echo "npx --no-install @gltf-transform/cli")}" # global install: npm i -g @gltf-transform/cli@4.5.1
find "$D" -name '*.glb' | while read -r f; do
  t="$f.tmp.glb"
  # 16-bit positions keep colliders/instanced meshes within ~1 mm; nodes are never merged or renamed
  $G webp "$f" "$t" >/dev/null   # textures first: later steps must not re-write the meshopt extension away
  $G meshopt "$t" "$f" --level high --quantize-position 16 --quantize-normal 14 >/dev/null
  rm -f "$t"
  $G validate "$f" | grep -q "No errors found" || { echo "ship_assets: validate failed: $f" >&2; exit 1; }
done
