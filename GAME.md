# Sky Wanderer (working title)

## Brief
- **Genre:** 3D puzzle-platformer.
- **Fantasy:** a small cloaked wanderer with a wooden staff crosses floating stone islands at dawn.
- **Core mechanic:** platforming between islands. The staff solves puzzles in two ways:
  1. **Raise stones:** strike a glowing rune; a stone platform rises or a bridge assembles (`switch` + `bridge`/`platform` mechanisms).
  2. **Wind:** strike a wind totem to switch a gust on/off or turn its direction, so it carries the player across gaps (`wind` mechanism, toggled by `switch`).
- **Original work.** No existing game, character or level is recreated.

## Scope
| Item | Value |
|---|---|
| Dimension | 3D, third-person camera |
| Engine | Three.js (Vite), template `engine/` |
| Target platform | Web (desktop browser) |
| World mode | Mixed: procedural islands + CC0 textures; Tripo for a few hero props (ruin pillar, rune stone, wind totem) |
| Levels | 3: l1 teaches runes, l2 teaches wind, l3 combines both |
| Target play time | ~120 s per level (first-time human); bot target ≤ 90 s |
| Bot falls allowance | 0 per level |

## Budget
- **$10 total** for generation (OpenAI, fal, Tripo).
- Already spent on pipeline test: ~$0.78 (1 still, 1 video, 1 Tripo model); those outputs are reused as reference in `ref/`.

Plan (estimates, confirmed per batch before spending):
| Step | Estimate |
|---|---|
| Phase 1: 2 extra hero stills; optional second video | $0.25 + $0.35 |
| Phase 2: turnaround edits (4), Tripo multiview, rig, 4 animations | ~$1.40 |
| Phase 3/5: 3 hero props (still + model each) | ~$1.20 |
| Phase 5: level concepts (3 levels × 3) | ~$1.00 |
| Reserve for retries | rest |

## Controls (planned)
WASD / arrows move, Space jump (hold for higher), E or left click: staff strike.
