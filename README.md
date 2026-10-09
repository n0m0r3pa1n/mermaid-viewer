# Mermaid Viewer

A desktop app for macOS, Windows and Linux that previews and edits [Mermaid](https://mermaid.js.org) diagrams.
Copy any text that contains a diagram, such as an LLM chat answer, a terminal session, a log file or a Markdown doc, and the diagram opens automatically.

## Download

Get the latest installer from the [Releases page](https://github.com/n0m0r3pa1n/mermaid-viewer/releases/latest):

| Platform | File |
| --- | --- |
| macOS, Apple Silicon | `mermaid-viewer-<version>-mac-arm64.dmg` |
| macOS, Intel | `mermaid-viewer-<version>-mac-x64.dmg` |
| Windows | `mermaid-viewer-<version>-windows-setup-x64.exe` (or the `portable` exe) |
| Linux | `mermaid-viewer-<version>-linux-x86_64.AppImage` or `…-linux-amd64.deb` |

The builds are not signed with an Apple or Microsoft certificate. On **macOS**, right-click the app and choose **Open** the first time. If macOS says the app is damaged, run `xattr -cr "/Applications/Mermaid Viewer.app"`. On **Windows**, choose **More info → Run anyway**.

## Features

- **Copy-paste import.** Paste with ⌘/Ctrl+V (anywhere outside the editor), click **Paste**, or drop text onto the window. A single diagram opens in its own tab; several open together as a board (below). Diagrams that are already open are focused, not duplicated.
- **Boards: several diagrams stacked one above another.** When the pasted text contains more than one diagram, they open together in a single *board* tab (numbered, one under the other). Pasting while a board is open **adds** to it, so you can build one up from several copies. You can also start an empty one with **New board** (⌘/Ctrl+Shift+N), or merge everything open with Edit menu → Combine All Tabs into a Board. The **Multiple →** dropdown switches back to one tab per diagram.
- **Present mode** (F5 or **Present**): full screen, one diagram per slide, scaled to fit. Use ←/→, Space or PgUp/PgDn to move, Home/End to jump and Esc to exit. A board presents its own diagrams; otherwise every open tab becomes a slide.
- **Auto-import from clipboard** (on by default). Copy a diagram in any other app and it shows up here. You can toggle it in the toolbar or under Edit menu → Auto-import.
- **Finds diagrams in messy text:**
  - ` ```mermaid ` / `~~~mermaid` fences, including indented ones
  - Terminal/chat output with `│` box borders, `⏺` bullets or `>` quotes
  - Log lines with timestamps, levels or `[component]` prefixes (indentation is kept)
  - JSON-escaped strings in structured logs (`"graph TD\n  A-->B"`)
  - `<pre class="mermaid">` HTML
  - Bare diagram text (`flowchart LR …`, `sequenceDiagram …`)
- **Live editor** with line numbers. On a syntax error, the error line is highlighted and the last good render stays on screen, dimmed.
- **Zoom & pan:** ⌘/Ctrl+scroll or trackpad pinch to zoom, scroll or drag to pan, double-click to fit. The diagram is re-rendered at each zoom level, so it stays sharp.
- **Files:**
  - `.mmd` / `.mermaid` are the standard Mermaid file extensions. Each file opens as a tab.
  - `.md` opens as a board showing every ` ```mermaid ` block, and the editor shows the whole Markdown file. If you choose *separate tabs*, each block gets its own tab instead, and saving writes your edits back into the matching block. Either way, the rest of the document is left untouched.
  - A board saves as `.md`. An SVG/PNG export of a board contains all of its diagrams stacked.
  - `.txt` / logs: diagrams are extracted the same way as from the clipboard.
  - When installed, the app registers itself for `.mmd` and `.mermaid` files (double-click to open) and as an alternate app for `.md`.
- **Export** to SVG or PNG (2×), or **copy the diagram as an image** to the clipboard.
- **Themes:** Auto (follows the OS light/dark setting), Default, Neutral, Dark, Forest and Base.
- **Layout:** editor side-by-side or stacked, a resizable splitter, and an option to hide the editor.
- **Session restore.** Open tabs and pasted diagrams are restored on the next launch.

## Develop

```bash
npm install
npm start
```

```bash
npm test
```

`npm test` runs the extraction tests in `test/extract.test.js`.

## Releasing

Bump `version` in `package.json`, then push a matching tag:

```bash
git tag v1.0.1 && git push origin v1.0.1
```

GitHub Actions (`.github/workflows/release.yml`) then builds the installers on macOS, Windows and Linux and attaches them to a new release.

## Build installers locally

```bash
npm run dist:mac
```

```bash
npm run dist:win
```

```bash
npm run dist:linux
```

| Command | Output in `dist/` |
| --- | --- |
| `dist:mac` | `.dmg` + `.zip` |
| `dist:win` | NSIS installer + portable `.exe` |
| `dist:linux` | `.AppImage` + `.deb` |

Build each platform on its own OS; the release workflow does exactly that.

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Import from clipboard | ⌘/Ctrl+Shift+V (or ⌘/Ctrl+V outside the editor) |
| New / Open / Save / Save As | ⌘/Ctrl+N / O / S / Shift+S |
| Export SVG / PNG | ⌘/Ctrl+E / Shift+E |
| Copy diagram as image | ⌘/Ctrl+Shift+C |
| Zoom in / out / 100% / fit | ⌘/Ctrl + `=` / `-` / `0` / `9` |
| Toggle editor / layout | ⌘/Ctrl+B / L |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Close tab | ⌘/Ctrl+W |
| New board | ⌘/Ctrl+Shift+N |
| Present / exit | F5 / Esc |

## Project layout

```
src/main.js              Electron main process: windows, menus, files, clipboard watching
src/preload.js           Safe bridge between the UI and the main process
src/renderer/extract.js  Finds Mermaid diagrams in arbitrary text (pure JS, unit tested)
src/renderer/app.js      UI: tabs, editor, rendering, zoom/pan, import/export
scripts/vendor.js        Copies mermaid.min.js into the app (runs on install and build)
examples/                Sample .mmd, .md and log files
```
