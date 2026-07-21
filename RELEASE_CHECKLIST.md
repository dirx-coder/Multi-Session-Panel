# Multi-Session-Panel v1.0 Release Checklist

## Project Overview

Multi-Session-Panel is an Electron desktop application for managing multiple embedded browser panels in a phone-style grid. It provides workspace persistence, isolated in-app browser sessions, layout controls, and a floating Global Controller for coordinated click, scroll, repeat, and auto-click workflows.

## Version Information

- Release: `v1.0.0`
- Product name: `Multi-Session-Panel`
- Package name: `multi-session-panel`
- Runtime: Electron
- Main entry: `src/main.js`
- Renderer entry: `src/renderer/index.html`

## Architecture Summary

- `src/main.js`: owns the Electron `BrowserWindow`, `BrowserView` lifecycle, session partitions, device emulation, and IPC handlers.
- `src/preload.js`: exposes the safe `window.panelApi` bridge to the renderer through `contextBridge`.
- `src/renderer/app.js`: manages renderer state, workspace layout, selection, Global Controller behavior, visual target placement, and automation UI.
- `src/renderer/styles.css`: contains the desktop UI, phone panel, floating controller, theme, fullscreen, and automation highlight styling.
- `src/userAgentManager.js`: assigns validated desktop Chrome User-Agent strings to isolated session partitions.
- `package.json`: defines launch scripts and the v1.0 syntax check command.
- `.panel-data/`: runtime Electron user data and browser profiles, created automatically.

## Main Features

- Workspace management with persistent panel state.
- Embedded Chromium panels with isolated profile partitions.
- Browser-labeled panel creation for Chrome, Firefox, DuckDuckGo, and Edge profiles.
- Mobile viewport emulation for compact phone-style browsing.
- Panel selection, multi-selection, drag ordering, deletion, and fullscreen focus.
- Toolbar controls for launch, reload, close, refresh, theme, layout, and URL updates.
- Floating Global Controller with scroll, double-click, stop, auto mode, repeat mode, concurrency mode, and visual click target.
- Dedicated Global Controller reset actions:
  - Reset Coordinates clears Click X/Y, removes the visual target, and disables Hover Target Mode.
  - Reset Automation stops running automation and resets automation settings while preserving the click target.
  - Reset All GC restores the Global Controller defaults without deleting workspace or browser session data.
- Auto Click target detection, saved targets, progress, summary, and error states.

## Installation Steps

1. Install Node.js 22.12 or newer.
2. Install dependencies:

```bash
npm install
```

3. Start the desktop app:

```bash
npm start
```

4. Run the local release check:

```bash
npm run check
```

## Build Instructions

This repository currently defines development launch scripts only:

```bash
npm start
npm run dev
npm run check
```

For distributable production builds, add and validate an Electron packaging tool such as Electron Forge or electron-builder before publishing installers. Do not treat `npm start` as a packaged production build.

## Production Checklist

- Confirm `npm install` completes cleanly on the target platform.
- Confirm `npm start` launches the Electron shell.
- Create, append, replace, select, reorder, reload, close, and delete panels.
- Validate layout controls: columns, scale, compact view, save layout, load layout, sidebar collapse, and control panel collapse.
- Validate manual row count while `Auto Arrange` is disabled.
- Validate browser filters for Chrome, Firefox, DuckDuckGo, and Edge labels.
- Validate fullscreen dashboard and per-panel fullscreen behavior.
- Validate dark and light themes persist across restart.
- Validate Global Controller reset actions independently.
- Validate visual target drag and Run Click against selected and all panels.
- Validate scroll up, scroll down, double click, stop, auto mode, repeat mode, and concurrent/sequential modes.
- Validate Auto Click detection, saved targets, run progress, cancellation, and error display.
- Run `npm run check` before tagging or packaging.
- Confirm app restart preserves workspaces, theme, UI collapse state, layouts, and saved automation targets.
- Confirm Reset All GC does not delete workspaces, close browser sessions, refresh phone tabs, or alter selected workspaces.

## Known Limitations

- Browser names map to isolated Chromium session profiles; native Chrome, Firefox, DuckDuckGo, and Edge executables are not embedded.
- The project does not yet include an automated test suite.
- The project does not yet include a packaging script for distributable installers.
- Runtime browser data is stored under `.panel-data/` and should not be committed.
- Renderer state is stored in localStorage; clearing Electron user data clears persisted app settings.

## Folder Structure

```text
panel/
├── package.json
├── package-lock.json
├── README.md
├── RELEASE_CHECKLIST.md
├── src/
│   ├── main.js
│   ├── preload.js
│   ├── userAgentManager.js
│   ├── userAgentManager.ts
│   ├── userAgents.json
│   └── renderer/
│       ├── index.html
│       ├── styles.css
│       └── app.js
└── .panel-data/
```

## Environment Variables

No required environment variables are currently defined.

## Troubleshooting

- If the app opens with no panels, click `Start All` or create tabs from the toolbar.
- If embedded pages fail to load, verify network access and reload selected panels.
- If layout appears stale after resizing, scroll or resize the window to trigger a bounds sync.
- If a Global Controller action does nothing, confirm at least one panel is visible and launched.
- If Auto Click cannot find a target, run `Detect` again after the target page has fully loaded.
- If persisted UI state becomes invalid, clear Electron localStorage for this app.

## Release Notes

### v1.0.0

- Added production reset split for the Global Controller: coordinates, automation, and full controller reset.
- Hardened Global Controller stop behavior so Stop cancels automation instead of starting a repeated stop action.
- Preserved click target state during automation-only resets.
- Reset All GC now also restores the floating controller position and temporary UI state.
- Fixed manual row layout so disabling Auto Arrange uses the configured row count.
- Fixed Compact View toggling so turning it off disables Electron device emulation.
- Improved BrowserView cleanup for user-agent assignments, emulation state, scroll locks, and automation state.
- Replayed saved click targets by relative position to keep actions stable after scale or layout changes.
- Added a local `npm run check` syntax gate for release verification.
- Fixed workspace navigation rendering when no create-workspace insertion element is present.
- Removed production-noisy User-Agent assignment logging.
- Added error handling for failed Global Controller and element-detection IPC calls.
- Added this release checklist for developer onboarding and maintenance.

## Future Improvements

- Add automated renderer and IPC tests for reset behavior and panel lifecycle.
- Add a packaging workflow for signed production installers.
- Add CI checks for syntax, dependency health, and packaging smoke tests.
- Consider an export/import workflow for workspace state backups.
- Add structured logging with opt-in debug mode for release diagnostics.

## Maintenance Guidelines

- Keep IPC additions narrow and exposed only through `preload.js`.
- Avoid storing secrets or credentials in renderer localStorage.
- Keep browser profile data out of version control.
- Verify Global Controller changes against running, idle, and cancelled automation states.
- Prefer targeted fixes over architecture rewrites during v1.x stability releases.
