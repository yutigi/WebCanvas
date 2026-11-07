# Prototype validation

Checked on Windows with Node.js 22.18.0 on 2026-11-07.

## Passed

- `npm test`: 18 tests passed. These cover URL policy, imported board validation, resource caps, raster-image restrictions, board round trips, coordinate transforms, multiple-view eligibility, clipping, overlap, and camera fitting.
- `npm run check`: all source, helper, and test JavaScript parsed successfully.
- Preview server: HTML and renderer module both returned HTTP 200 on `http://127.0.0.1:4173`.
- Visual check in Microsoft Edge: canvas, browser placeholders, toolbar, outline, and minimap rendered.
- UI interaction checks: added a sticky note; edited its contents; finished editing with Escape; entered presentation; navigated stops; exited presentation; opened URL entry; verified that `javascript:alert(1)` was rejected with an HTTP(S)-only explanation.

These preview checks exercise the canvas UI. They do not verify native Chromium view integration.

## Native verification for 0.1.1

The earlier registry-access restriction was resolved. Electron 45.2.3 and the executable resource editor are installed with versions recorded in `package-lock.json`.

`npm run test:smoke` passed on Windows with the normal Chromium sandbox enabled. It verified two live pages, native input, browser history and reload, captures, isolated sessions, sandbox preferences, URL policy, recovery, and view cleanup. The test waits for compositor frames and asynchronous browser destruction; delayed snapshot callbacks now ignore closed views.

`npm run build` produced the Windows x64 portable executable. Its embedded icon was extracted and visually checked against the Web Canvas logo, and Windows file/product version metadata reports `0.1.1`. The ICO includes 16, 24, 32, 48, 64, 128, and 256 pixel images.

The same native smoke suite also passed when launched through the packaged `Web Canvas.exe`.

## Background video regression

The expanded source smoke test reproduced frozen hidden video with background throttling enabled. With throttling disabled and media-aware snapshot scheduling, it passes using a local muted video fed by an animated canvas stream. It verifies advancing video frames after switching to another card and hiding the native view, distinct preview images within five seconds while the app is unfocused, playback/pause detection, and media state reset after reload. This does not require YouTube or network media and does not validate YouTube-specific behavior or DRM playback. Older portable builds predate this fix; the new `WebCanvas.exe` build includes it.

The application is unsigned. Manual checks for display scaling, native file dialogs, the full presentation workflow, and the remaining cases below are still needed. macOS/Linux have not been tested.

## Windows process branding

The Windows development launcher and portable build now use `WebCanvas.exe`. Its embedded `ProductName`, `FileDescription`, and `InternalName` are `WebCanvas`, and `OriginalFilename` is `WebCanvas.exe`. The matching crash helper is renamed to `WebCanvas_wer.dll`. PowerShell process inspection reported the running process name as `WebCanvas`.

The native smoke suite passed on the first branded development launch, a subsequent cached launch, and the new `release/WebCanvas-win32-x64/WebCanvas.exe` portable build. It asserts the Electron app name and actual executable filename as well as browser/video behavior. Windows executable metadata was checked for both cached and portable runtimes. The development launcher leaves `node_modules/electron/dist/electron.exe` untouched. Normal startup explicitly retains `%APPDATA%/web-canvas` for recovery; smoke tests use their separate fixture profile.

## Release verification for 0.1.2

Checked on Windows x64 with Node.js 22.18.0 and Electron 45.2.3 on 2026-11-08 (Asia/Bangkok).

- `npm test`: all 18 tests passed.
- `npm run check`: all JavaScript syntax checks passed.
- `npm run test:smoke`: the source native suite passed with Chromium sandboxing enabled.
- `npm run build`: rebuilt the Windows x64 portable application from the current source.
- The same native suite passed through the packaged `release/WebCanvas-win32-x64/WebCanvas.exe`.
- Packaged executable metadata reports version `0.1.2`, product/file description `WebCanvas`, and original filename `WebCanvas.exe`.

The native suite covers snapshots while subresources stall, preserving the existing document after attachment/204 navigations, multiple-player preview scheduling, unfocused and hidden video, media cleanup across navigation/reload, and recovery after load errors and renderer crashes, alongside the existing browser, session, sandbox, recovery, and cleanup checks. The deliberate failing-page fixture emits `ERR_EMPTY_RESPONSE`; the suite verifies recovery and exits successfully.

This release remains an unsigned portable prototype. The outstanding manual and platform checks above still apply.

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
