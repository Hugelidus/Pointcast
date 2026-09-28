# Chrome Web Store images

`node docs/launch/store/render.mjs` re-renders every image from `src/*.html` in headless Chromium (24-bit RGB PNGs): `screenshot-1.png` … `screenshot-4.png` (1280x800), `promo-small.png` (440x280), `promo-marquee.png` (1400x560) and `social-preview.png` (1280x640, for the GitHub repository's settings). `node docs/launch/store/render.mjs 3 promo-small` renders only those.
The screenshots embed real captures from `src/raw/` and the real spec `src/spec-example.md`; to capture them again, run `src/capture.mjs` (headless, muted, e2e build; see its header) and copy the files it lists into `src/raw/`.
Fonts come from Google Fonts (Inter, JetBrains Mono; system fallbacks offline), the logo from `scripts/icon/pointcast.svg`, and `icon-128.png` from `node scripts/icon/render.mjs`.
