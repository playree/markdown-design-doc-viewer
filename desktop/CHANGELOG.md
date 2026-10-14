# Changelog of the desktop app

The desktop app has its own version, apart from the extension and the command line (their changes are in [CHANGELOG.md](../CHANGELOG.md)). Its installers are attached to the [releases of the desktop app](https://github.com/playree/markdown-design-doc-viewer/releases?q=desktop&expanded=true) (tagged `desktop-vX.Y.Z`).

## 0.1.0

- The preview is also a desktop app for Windows, macOS and Linux, to read design documents without VS Code. It opens a Markdown file from its menu, by drag and drop or from the command line, shows it like the extension's preview, and updates it when the file is saved. Links to other Markdown files open in the app, and web links in the browser. The installers are not signed yet; see [the desktop app's guide](../docs/desktop.md) for the warnings of the system on the first launch.
- The installers include the licenses and copyright notices of the npm packages bundled into the app (ThirdPartyNotices.txt) and of its Rust crates (ThirdPartyLicenses.txt).
