# Microsoft Edge Add-ons listing

Everything [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview) asks for when you create a Microsoft Edge extension, step by step (registering for its Microsoft Edge program is free). The texts and images are the Chrome Web Store's ([chrome-web-store.md](chrome-web-store.md), [store/](store/)): the two listings say the same thing, so each text lives in one place. Edge runs the same package as Chrome; `pnpm e2e:edge` runs the end-to-end suite in headless Edge.

## Package

Upload `pointcast-<version>-chrome-store.zip`: `pnpm zip:store` in `packages/extension` (from the repository root, `pnpm --filter @pointcast/extension zip:store`) writes it to `packages/extension/.output/`. It is the same file as the Chrome Web Store upload. Store builds leave out the manifest `key`, because each store gives its item an id of its own ([After publishing](#after-publishing-edges-id)). Do not upload the GitHub release zip: it carries the Chrome Web Store item's key.

The listing's name, Pointcast, comes from the manifest's `name` (`packages/extension/wxt.config.ts`).

## Availability

- **Visibility:** *Hidden* during the beta (installable by anyone with the link, not listed in search, like the Chrome Web Store's *Unlisted*); switch to *Public* later.
- **Markets:** all.

## Properties

- **Category:** Developer tools
- **Privacy policy requirements:** *Yes*, the extension accesses personal information: the user's voice, the elements they point at and their clicks, all handled on their device and never sent to the developer or third parties (the Chrome Web Store's [data usage](chrome-web-store.md#privacy-practices) declaration).
- **Privacy policy URL:** https://github.com/Hugelidus/pointcast/blob/main/PRIVACY.md
- **Website URL:** https://github.com/Hugelidus/pointcast
- **Support contact details:** https://github.com/Hugelidus/pointcast/issues
- **Mature content:** No.

## Store listing

One listing, in **English**:

- **Description:** the Chrome Web Store's **Description** ([Store listing](chrome-web-store.md#store-listing)), unchanged: it names no browser.
- **Short description**, if the form asks for one: the manifest's `description`, as in the Chrome Web Store:

  ```
  Talk and point at your web app: your coding agent gets a spec with the exact elements and the code behind them.
  ```

- **Extension Store logo:** `store/icon-128.png` (128x128 is the smallest Partner Center accepts; it recommends 300x300).
- **Small promotional tile (440x280):** `store/promo-small.png`
- **Screenshots (1280x800):** `store/screenshot-1.png` … `store/screenshot-4.png`
- **Large promotional tile (1400x560):** `store/promo-marquee.png`
- **YouTube video URL:** none yet.
- **Search terms** (up to 7, 30 characters each):

  ```
  coding agent
  voice to spec
  point and click spec
  Claude Code
  speech to text
  localhost
  developer tools
  ```

## Submission

**Notes for certification:**

```
pointcast only runs on local development hosts (localhost, 127.0.0.1, *.localhost, *.test) until the user enables another site from its popup. To test it:
1. Serve any web page locally, for example "npx http-server -p 8080" in a folder with an HTML file, and open http://localhost:8080.
2. Open the pointcast toolbar popup and press Record; allow the microphone when asked.
3. Talk while you Alt+click a few elements of the page, then press Stop.
The first recording downloads the speech model once (about 291 MB, from huggingface.co); transcription runs on the device. The Markdown spec is then copied to the clipboard and saved under Downloads/pointcast/. No account, sign-in or server is needed.
Source code (MIT): https://github.com/Hugelidus/pointcast
```

If certification asks why a permission is needed, the Chrome Web Store's [permission justifications](chrome-web-store.md#privacy-practices) apply word for word.

## After publishing: Edge's id

Edge Add-ons gives the item an id of its own, not the Chrome Web Store's: the 32 letters at the end of the listing's URL, `https://microsoftedge.microsoft.com/addons/detail/pointcast/<id>`. A pointcast MCP server only accepts recordings from the extension ids it knows (D11), so:

1. Append that id to `OFFICIAL_EXTENSION_IDS` in `packages/core/src/handoff.ts` (the list the CLI's receiver accepts), and ship it in the next CLI release.
2. Until users have that release, an install from Edge Add-ons falls back to Edge's downloads, and the popup names the id to accept: `POINTCAST_EXTENSION_IDS=<id>` in the MCP server's environment.

Edge users who install from the Chrome Web Store (Edge allows it once they turn on *Allow extensions from other stores*), or load the GitHub release zip unpacked, get the Chrome Web Store id, which pointcast MCP servers accept out of the box.
