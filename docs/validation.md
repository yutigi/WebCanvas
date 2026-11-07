# Prototype validation

Checked on Windows with Node.js 22.18.0 on 2026-11-07.

## Passed

- `npm test`: 18 tests passed. These cover URL policy, imported board validation, resource caps, raster-image restrictions, board round trips, coordinate transforms, multiple-view eligibility, clipping, overlap, and camera fitting.
- `npm run check`: all source, helper, and test JavaScript parsed successfully.
- Preview server: HTML and renderer module both returned HTTP 200 on `http://127.0.0.1:4173`.
- Visual check in Microsoft Edge: canvas, browser placeholders, toolbar, outline, and minimap rendered.
- UI interaction checks: added a sticky note; edited its contents; finished editing with Escape; entered presentation; navigated stops; exited presentation; opened URL entry; verified that `javascript:alert(1)` was rejected with an HTTP(S)-only explanation.

These preview checks exercise the canvas UI. They do not verify native Chromium view integration.

## Blocked in this environment

`npm install --cache .cache/npm --fetch-retries=0 --fetch-timeout=15000` failed with `EACCES` fetching `https://registry.npmjs.org/electron`. No Electron runtime was installed and no lockfile could be generated from the registry.

`npm run test:smoke` correctly reported that Electron was not installed. The real native-view integration suite has **not run**. Desktop startup, view positioning on Windows/DPI changes, live page input, session enforcement, native dialogs, capture behavior, and portable packaging remain unverified. No Windows executable has been produced. macOS/Linux have not been tested.

## Complete native verification

From an environment with registry and Electron binary download access:

```powershell
npm install
npm test
npm run check
npm run test:smoke
npm start
npm run build
```

The smoke test uses a separate `.cache/smoke-profile` and a loopback HTTP fixture. It checks two simultaneous real views, input, page controls/history, session separation, sandbox preferences, prohibited navigation, captures, recovery, and cleanup. It includes a site with restrictive framing headers. A passing result should be recorded before calling the desktop browser verified.

Manually verify dragging/resizing at different display scaling settings, two simultaneously live websites, overlap with notes/tools, 25% overview, return to live browsing, board file save/reopen (including images), presentation website input, denied device requests, blocked popups/downloads, network errors, and reload after a crashed page.
