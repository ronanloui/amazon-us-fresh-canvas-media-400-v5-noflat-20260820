# Amazon US Fresh Canvas Media 400 — Locked V5/V4 Template

Independent public media package for 400 original canvas-art designs.

## Locked template contract

- Portrait 2:3: `MAIN`, `DETAIL`, `SCENE-LIVING`, `SCENE-DINING`, `SIZE`.
- Landscape 3:2: `MAIN`, `DETAIL`, `SCENE-LIVING`, `SCENE-BEDROOM`, `SIZE`.
- Exactly five JPEG files per design; no `FLAT` role.
- Portrait `MAIN`: 1600 x 2400 px.
- Landscape `MAIN`: 2400 x 1600 px.
- All secondary roles: 2000 x 2000 px.
- Template layout, fixed labels, rooms, typography, product geometry, edges and shadows are locked. Only the original artwork placed in the designated product faces varies.
- The landscape bedroom product and headboard use the locked x = 1080 px centerline.

`template_lock_manifest.json` records the locked role sets, dimensions, labels and SHA-256 hashes for all fixed room assets. `qa_report.json` records full media validation.

## Media structure

Files are grouped by theme, orientation and design ID under `media/`. `media_manifest.json` and `media_manifest.csv` provide the corresponding GitHub Raw HTTPS URL for every file.

## Amazon workbook mapping

- Main image: `MAIN`
- Other image 1: `DETAIL`
- Other image 2: `SCENE-LIVING`
- Other image 3: `SCENE-DINING` for portrait / `SCENE-BEDROOM` for landscape
- Other image 4: `SIZE`
