# App Icons

Three icon files are referenced by the PWA manifest but not yet generated:

- `icon-192.png` — 192×192 px, standard
- `icon-512.png` — 512×512 px, standard
- `icon-512-maskable.png` — 512×512 px, maskable (safe area inside a circle)

To generate these:

1. Get the WFUMC cross-and-flame logo as a high-res PNG or SVG.
2. Use https://realfavicongenerator.net/ or https://maskable.app/ to export the three sizes.
3. Drop them into this folder.

Until icons exist, the PWA install will still work but show a generic icon.
