# BenchReview Lite for macOS

The desktop app wraps the current BenchReview Lite interface in a native macOS
window. It is built for Apple Silicon and does not require an Apple Developer
membership for local use.

## First build

1. Accept the Xcode licence once: `sudo xcodebuild -license accept`
2. Install dependencies: `npm install`
3. Install Rust if it is not already available: `brew install rust`
4. Build the app: `npm run desktop:build`

The unsigned application bundle is produced in
`desktop/src-tauri/target/release/bundle/`.

`desktop:prepare` copies the web interface and its local assets into the
desktop build directory, so the Mac build and GitHub Pages use the same UI.
