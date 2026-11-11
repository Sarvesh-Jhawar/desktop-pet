# Milly Window Transparency Debugging Report

## Purpose

This report captures the current code, configuration, platform details, changes already made, and remaining unknowns for the black background visible around Milly. It is intended as a handoff to another AI or developer for further diagnosis.

## Observed problem

- The user reports that the desktop pet still shows a black background/rectangle instead of displaying only Milly over the desktop.
- The black region has not been independently reproduced or captured in this session. No screenshot or Windows runtime visual inspection was available.
- The Rive renderer has now been switched from WebGL2 to Canvas as a diagnostic/fix attempt. The user reports that this change did not change the black background.
- User tested a fresh Tauri run with a semi-transparent red page background and reported a faint red tint over the desktop.
- User estimates the black region at about 250 x 250, matching the canvas rather than the 300 x 300 native window.
- A query-string test mode was added to disable Rive and replace the canvas with a CSS marker. The frontend build passes, but launching the native test failed because the C: drive ran out of space while Cargo was building.
- Thus, window alpha composition appears to work from the red-tint test, and the canvas/Rive path is the leading suspect, but it is not yet isolated because the Rive-bypass native test has not run.
- Therefore, this report describes the current implementation and evidence; it does not claim that the black pixels have been conclusively traced to the native window, WebView2, Angular CSS, or the Rive canvas.

## Runtime and toolchain facts

Facts reported by `npx tauri info` in this workspace:

- OS: Windows 10.0.26300 x64
- WebView2: 157.0.4341.42
- Rust toolchain: stable MSVC; rustc 1.98.1
- Tauri Rust crate: 2.11.6
- Wry: 0.55.1
- Tao: 0.35.3
- Tauri JavaScript API: 2.11.1
- Tauri CLI: 2.11.5
- Frontend: Angular; package scripts use Angular CLI

These are the inspected environment versions; they do not prove which rendering path is producing the black pixels.

## Pet window configuration

File: `src-tauri/tauri.conf.json`, `app.windows`.

The pet window is label `main` and currently has:

```json
{
  "label": "main",
  "title": "Desktop Pet",
  "width": 300,
  "height": 300,
  "transparent": true,
  "backgroundColor": "#00000000",
  "decorations": false,
  "alwaysOnTop": true,
  "resizable": false,
  "skipTaskbar": true,
  "shadow": false,
  "visible": true
}
```

Relevant lines: `src-tauri/tauri.conf.json:18-31`.

Notes:

- `transparent: true` requests a transparent native window.
- `backgroundColor: "#00000000"` is an eight-digit hex RGBA value with alpha zero.
- `decorations: false` removes the native frame/title bar.
- `alwaysOnTop: true` keeps the pet above other windows.
- `skipTaskbar: true` hides the pet's taskbar button; it is not itself a transparency setting.
- The separate `dashboard` window is 980 x 720, starts hidden, has decorations enabled, and does not have the pet's transparent-window options (`tauri.conf.json:33-42`).
- The Tauri CLI accepts the current config (`npx tauri info` succeeded), and a PowerShell JSON check confirmed the values above.
TS2345: Argument of 
## Rust startup override

File: `src-tauri/src/lib.rs`, inside `tauri::Builder::setup`.

```rust
let pet_window = app.get_webview_window("main").ok_or_else(|| {
    std::io::Error::new(
        std::io::ErrorKind::NotFound,
        "Pet window 'main' is not configured",
    )
})?;
pet_window.set_background_color(Some(tauri::webview::Color(0, 0, 0, 0)))?;
```

Relevant lines: `src-tauri/src/lib.rs:52-59`.

Notes:

- The setup fails with an explicit error if the configured `main` window cannot be found.
- `set_background_color` is called on Tauri's `WebviewWindow`, which sets both its native window background and WebView background in the installed Tauri 2.11.6 source (`tauri::webview::webview_window::WebviewWindow::set_background_color` delegates to both layers).
- The call propagates errors with `?`; it does not silently ignore failures.
- `cargo check --manifest-path .\src-tauri\Cargo.toml` passed after this change.

## Frontend document and CSS

### Document shell

`src/index.html` contains only the normal Angular root:

```html
<body>
  <app-root></app-root>
</body>
```

There is no inline body background in this HTML.

### Global styles

File: `src/styles.css`.

- `html, body` use `background: transparent !important`, zero margin/padding, full width/height, and hidden overflow (`styles.css:28-38`).
- `app-root` is block-level, full width/height, and uses `background: transparent !important` (`styles.css:85-91`).
- Dashboard-specific selectors change height/overflow only when `<app-dashboard>` is present (`styles.css:92-105`).
- Global CSS variables include dark colors, but those variables are not assigned as the `html`, `body`, or `app-root` background.
- Other global styles such as `.glass-panel` intentionally have backgrounds, but they are component/card styles rather than the pet root.

### Angular application wrapper

File: `src/app/app.css`.

- `:host` has a transparent background (`app.css:1-3`).
- `.app-container` is full-size, overflow-visible, and transparent (`app.css:5-11`).
- `app-pet` and the routed element are sized to fill the parent (`app.css:13-23`).

### Pet component styles

File: `src/app/features/pet/pet.css`.

- `:host` is full-size and has `background: transparent !important` (`pet.css:1-6`).
- `.pet-container` is full-size, positioned relative, overflow-visible, and has `background: transparent !important` (`pet.css:8-13`).
- The `canvas` is displayed as a 250 x 250 block and has `background: transparent !important`, no border, and no outline (`pet.css:16-28`).
- Other deliberate opaque/translucent backgrounds exist for interactive controls, such as the quick-action wheel and speech bubble. These are bounded UI elements and should not, by themselves, paint the entire 300 x 300 window.
- A project search found one `color-scheme` declaration in `pet.css`, scoped to `.quick-reminder-form input[type='datetime-local']` and set to `light`. No root-level `color-scheme: dark` or `prefers-color-scheme` rule was found.

### Pet component markup and renderer

File: `src/app/features/pet/pet.html`.

- The root is `<div class="pet-container">` (`pet.html:1`).
- The canvas is `<canvas #petCanvas width="250" height="250" ...>` near the end of the component (`pet.html:229-235`).
- The canvas has no CSS class or inline background color.

Files: `src/app/features/pet/pet.ts` and `src/app/core/pet-state.service.ts`.

- A Rive runtime is created using `new Rive({...})` (`pet.ts:346`).
- It receives `canvas: this.canvasRef.nativeElement` (`pet.ts:350`).
- When Rive loads, the component calls `resizeDrawingSurfaceToCanvas()` (`pet.ts:366`).
- The renderer and associated types are now imported from `@rive-app/canvas` in both files.
- The Canvas package is pinned at version 2.45.0, matching the version of the previously resolved WebGL2 package.
- The Angular production build passes with the Canvas package, confirming that the existing `Rive`, `StateMachineInput`, state-machine, and canvas setup APIs type-check in this project.
- Append `?transparencyTest=1` to the pet WebView URL to skip Rive initialization, hide the canvas, and show a CSS-only cyan circle. This query mode is implemented by `Pet.transparencyTestMode` in `pet.ts`, the conditional marker in `pet.html`, and its CSS in `pet.css`.
- The current evidence confirms CSS canvas transparency only. It does **not** establish whether the Canvas renderer is clearing to transparent pixels at runtime or whether the artwork itself contains a black background. Those remain important checks.

## Platform implementation findings

Inspected the locally installed Tauri/Wry/Tao sources:

- Tauri 2.11.4 runtime source creates a Windows softbuffer surface when the native window's `transparent` flag is true and redraws that surface (`tauri-runtime-wry-2.11.4/src/lib.rs`, around lines 4088-4103 and 4517-4704).
- Tao 0.35.3's Windows implementation has a transparency setup path (`tao-0.35.3/src/platform_impl/windows/window.rs`, around lines 1283-1295), including DWM blur-behind handling.
- Tao's `WS_EX_TRANSPARENT | WS_EX_LAYERED` assignment appears in the `IGNORE_CURSOR_EVENT` code path (`tao-0.35.3/src/platform_impl/windows/window_state.rs`, around lines 280-288). This is not a suitable blind fix for this interactive pet: `WS_EX_TRANSPARENT` can affect mouse hit testing/click-through.
- Wry 0.55.1 has a WebView2 `set_background_color` method. The app already sets the WebView background to zero alpha through Tauri's `WebviewWindow::set_background_color`.
- The installed Tauri CLI schema describes `backgroundColor` as the window and WebView background color. Its Windows caveat says alpha is ignored for the *window layer*; for the WebView layer on Windows 8 and newer, alpha zero is meaningful while nonzero alpha is replaced with 255.
- The same schema supports `additionalBrowserArgs` in a window configuration. Its description says custom arguments replace Wry's default arguments, so a GPU test should retain Wry's default `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection` argument as well as `--disable-gpu`.

These source inspections make a missing generic `WS_EX_LAYERED` flag less likely to be the right next change. They do not prove the actual runtime pixels are being composed with alpha.

## Additional project search results

- Search of project CSS, HTML, TypeScript, JavaScript, Rust, JSON, and TOML found no `windowEffects`, `set_effects`, vibrancy plugin, or `window-vibrancy` usage.
- Search found no root-level dark color-scheme or `prefers-color-scheme` declaration. The only `color-scheme` rule is the light datetime input noted above.
- The only configured windows in `tauri.conf.json` are `main` and `dashboard`. The `main` entry is the transparent pet. The `dashboard` entry is intentionally a regular decorated window.
- Rust creates or reuses the dashboard in `open_dashboard` and can also create it from the tray menu. These paths do not create another pet window. No TypeScript `new WebviewWindow` call was found.
- Glob of `src-tauri/tauri*.{json,json5,toml}` found only `src-tauri/tauri.conf.json`; no platform-specific duplicate Tauri config was found.
- The project also has hidden settings/tasks handling if those labels exist, but no settings/tasks windows are configured in the inspected `tauri.conf.json`. These listeners do not create windows in the inspected Rust code.

## Changes already made during this transparency investigation

1. Added `"backgroundColor": "#00000000"` to the `main` window.
2. Added an explicit Rust startup call setting the main `WebviewWindow` background to `Color(0, 0, 0, 0)`.
3. Set `skipTaskbar` to `true`, so the pet no longer has a taskbar button. This only changes taskbar presentation, not alpha behavior.
4. Replaced `@rive-app/webgl2` with `@rive-app/canvas@2.45.0` in `package.json` and `package-lock.json`; updated imports in `pet.ts` and `pet-state.service.ts`.
5. Added a Rive-bypass test mode selected with `?transparencyTest=1`. It hides the pet canvas and displays a CSS-only marker for visual isolation.
6. Added `src-tauri/tauri.transparency-test.conf.json`, a temporary Tauri config overlay that serves Angular on port 4201 and opens the test mode.
7. No raw Win32 style flags or Windows crate dependency were added.
8. No blanket change was made to dashboard styles or the intentional UI card/menu backgrounds.

The report was generated after these edits. The taskbar behavior is an intentional side effect that should be considered when changing the window configuration.

## Validation already performed

- `npx tauri info`: succeeded and recognized the app configuration and Windows/WebView2 environment.
- PowerShell JSON validation: confirmed `main.transparent === true`, `main.backgroundColor === "#00000000"`, `main.decorations === false`, and `main.skipTaskbar === true`.
- `cargo check --manifest-path .\src-tauri\Cargo.toml`: passed after adding the Rust override.
- `npm run build`: passed after switching to Canvas. Angular still reports `@rive-app/canvas` as CommonJS/non-ESM, so this package change did not remove the optimization warning.
- `npm test`: 17 passed and 2 failed. Failures are the existing app-title assertion and motivational-quote shuffle assertion; the pet component spec passed.
- User-reported visual checks from a fresh Tauri run: semi-transparent red tint was visible over the desktop, and the black region appears approximately canvas-sized (250 x 250).
- `npm run build` passed after adding the query-string Rive-bypass mode.
- Attempted to launch the native diagnostic using the Tauri config overlay, but Cargo failed creating `src-tauri\target\debug\deps\app_lib.lib` with OS error 112 ("There is not enough space on the disk"). The failed command was stopped; no diagnostic window was launched.

## Important distinction for the next investigator

The visible black area can come from different layers:

1. **Native window composition**: Tauri/Tao window surface or Windows DWM.
2. **WebView2 surface**: opaque WebView background despite CSS being transparent.
3. **HTML/CSS painting**: a root/ancestor element or pseudo-element painting a background.
4. **Rive canvas/artwork**: the Canvas renderer clears opaquely or the `.riv` artboard contains a black background.
5. **Application observation/setup**: the viewed window may not be the configured `main` Tauri window (for example browser preview, stale executable/build, or another desktop overlay).

The currently inspected HTML/CSS rules make item 3 less likely, but do not rule it out at runtime. The Rive canvas alpha behavior (item 4) and actual window identity/build (item 5) remain unverified. A screenshot was not available to establish whether the black rectangle's bounds exactly match the 300 x 300 native window, the 250 x 250 canvas, or another window.

## Suggested next diagnostic steps

Run a targeted Windows test before changing native window styles:

1. Free enough space on C: for Cargo to complete a debug build; the prior launch stopped with OS error 112.
2. From the repository root, run `npx tauri dev --config .\src-tauri\tauri.transparency-test.conf.json`. The overlay sets the dev URL to `http://localhost:4201/?transparencyTest=1` and starts Angular on port 4201. This launches the pet without Rive and with a CSS-only cyan circle.
3. If the black rectangle disappears in that mode, native/WebView alpha composition is likely working and the cause is in Rive/canvas rendering or `.riv` artwork. If it remains, investigate WebView/native composition even though the red-tint test showed page-level alpha.
4. The red-tint test and approximate dimensions have already been reported: faint red showed through; black appears around 250 x 250. Do not repeat these unless a new runtime/build could change the result.
5. If the Rive-bypass mode removes the black, inspect the `.riv` artboard background and renderer output. If it does not, isolate with a minimal static transparent page.
6. If needed, test `additionalBrowserArgs` with `--disable-gpu` while preserving Wry's default feature-disable argument. Treat this as a diagnostic only due to the GPU performance impact.
7. Only consider further GPU flags or Win32 composition/style changes after controlled tests point to WebView/native composition. Preserve Milly's mouse interaction; avoid `WS_EX_TRANSPARENT` unless click-through is explicitly desired and separately managed.

## Handoff request for another AI

Investigate the black rectangle from the evidence above. The user has already reported a faint-red-through result from the fresh Tauri test and estimates the black area at 250 x 250. The Rive runtime is now `@rive-app/canvas@2.45.0`, and the user reports no visible change. A native Rive-bypass test mode is implemented but has not launched because Cargo ran out of C: disk space. First free disk space and rerun `npx tauri dev --config .\src-tauri\tauri.transparency-test.conf.json`, then use the observed result to isolate Rive/canvas versus WebView/native composition. Do not repeat the already-applied transparent CSS/config/Rust settings as if they were missing. Use the exact installed versions and verify any proposed API against those versions. Avoid adding click-through styles that break interaction. If visual runtime evidence is unavailable, state what evidence is needed rather than claiming the issue is fixed.

## Electron follow-up (2026-11-11)

The desktop shell was migrated to Electron. A native screen capture with the Rive canvas disabled showed the cyan test marker over the VS Code window with the surrounding Electron window fully transparent. This verifies that Electron's transparent `BrowserWindow` and the page's transparent CSS work on this machine.

With Rive enabled, the black/dark rectangle returns. A delayed readback from the Rive canvas (after its first render) reported opaque `#161616` pixels at the canvas corners (`RGBA 22,22,22,255`), while the canvas context reports `alpha: true` and its computed CSS background is transparent. The opaque pixels are therefore being drawn into the Rive canvas; they are not the Electron window background or a CSS background.

Testing `useOffscreenRenderer: true`, disabling Electron hardware acceleration, and disabling the canvas bob animation did not resolve the issue. Those experiments were reverted. No GPU or animation workaround should be retained.

### Implemented workaround

The project does not include an editable Rive source file, so a renderer-side background removal was implemented instead:

- The original Rive canvas remains active, invisible, and receives Rive interactions.
- A second visible canvas copies the rendered frame.
- Each frame, an edge-connected flood fill removes pixels matching the canvas-corner background color within a small RGB tolerance. Seeding from all four edges prevents isolated dark features in Milly from being removed.
- The visible canvas is transparent outside the pet; the original Rive asset is unchanged.

Verification: `npm run build` passed, and a desktop screenshot of the running Electron app showed Milly with the VS Code/editor visible around the pet instead of a black rectangle. The workaround is in `src/app/features/pet/pet.ts`, with the paired canvases in `pet.html` and CSS in `pet.css`.
