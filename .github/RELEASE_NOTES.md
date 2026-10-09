Mermaid Viewer is a desktop app for previewing and editing Mermaid diagrams. Paste any text that contains a diagram (a chat answer, a terminal log, a Markdown file) and it renders right away.

## Download

| Platform | File |
| --- | --- |
| macOS, Apple Silicon (M1 and later) | `mermaid-viewer-*-mac-arm64.dmg` |
| macOS, Intel | `mermaid-viewer-*-mac-x64.dmg` |
| Windows installer | `mermaid-viewer-*-windows-setup-x64.exe` |
| Windows, no install | `mermaid-viewer-*-windows-portable-x64.exe` |
| Linux, any distro | `mermaid-viewer-*-linux-x86_64.AppImage` |
| Debian / Ubuntu | `mermaid-viewer-*-linux-amd64.deb` |

The `.zip` files are the same macOS app without the disk image.

## First launch

The builds are not signed with an Apple or Microsoft certificate, so the OS warns you the first time:

- **macOS:** drag the app to Applications, then right-click it, choose **Open**, and confirm. If macOS says the app is damaged, run `xattr -cr "/Applications/Mermaid Viewer.app"` once.
- **Windows:** in the SmartScreen dialog, click **More info**, then **Run anyway**.
- **Linux (AppImage):** run `chmod +x mermaid-viewer-*.AppImage`, then run the file.

## What's in it

- Paste or auto-import from the clipboard. Diagrams are found in Markdown fences, terminal output, timestamped logs, JSON log lines and HTML.
- Several diagrams open as one board, stacked one above another. Pasting while a board is open adds to it.
- Present mode (F5): full screen, one diagram per slide.
- Live editor with error line highlighting. Zoom and pan stay sharp at any size.
- Opens `.mmd`, `.mermaid` and `.md` files. Edits to Markdown files are written back in place.
- Export to SVG or PNG, or copy the diagram as an image.
