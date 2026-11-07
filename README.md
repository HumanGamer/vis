# Vis

A browser-based UI for OpenCode V2, with floating tool windows, session management, code and diff viewers, and an embedded terminal. Connects directly to your OpenCode service.

![Demo](docs/demo.gif)

## How to Use

Open **<https://xenodrive.github.io/vis/>**, then configure and start your OpenCode service:

```bash
opencode service set cors https://xenodrive.github.io
opencode pair
```

Paste the full pairing URL shown by `pair` into vis and select **Connect**. Do not open the link first: it is single-use and expires after a short time. Vis exchanges it for a session token and saves that token for reconnection. If the link expires or was already used, run `opencode pair` again.

For self-hosting, serve `dist/` with a static HTTP server and use your vis origin in the CORS command above.

## Desktop App

Vis also ships as a native desktop app built with [Tauri 2](https://v2.tauri.app/) (Rust shell in `src-tauri/`, same Vue UI bundled into the binary). External links open in your default browser and session notifications use the OS notification center.

The app serves its interface from a loopback-only address, `http://127.0.0.1:41730`, on every platform. That is the origin to allow in CORS, on whichever machine runs the OpenCode service (it can be another machine on your network):

```bash
opencode service set cors http://127.0.0.1:41730
```

CORS takes a comma-separated list, so to keep using the hosted web UI as well, use `https://xenodrive.github.io,http://127.0.0.1:41730`. Then pair as above; the pairing URL carries the service's address. The Connect screen shows the exact origin to allow.

Port 41730 must be free on the machine running the desktop app; if it isn't, the app says so on launch.

### Building

Requires [Rust](https://rustup.rs/), pnpm, and the [Tauri system prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
pnpm install
pnpm app:dev    # run with hot reload
pnpm app:build  # bundle into src-tauri/target/release/bundle/
```

## License

MIT
