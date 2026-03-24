---
id: playwright-cli
name: Playwright CLI
description: Interactive browser control via playwright-cli commands (open, snapshot, click, fill, screenshot, etc.)
version: 1.0.0
---

# playwright-cli

You have access to `playwright-cli` for interactive browser automation via the terminal. Use `run_command` to execute these commands.

## Setup

```bash
# Install browser (first time only)
playwright-cli install-browser
```

## Core Workflow

The typical workflow is: open a page -> snapshot to get element refs -> interact using refs -> snapshot again.

```bash
# Open a URL
playwright-cli open https://example.com

# Take a snapshot to see the page and get element refs
playwright-cli snapshot

# Click an element by ref number from snapshot
playwright-cli click 42

# Fill a form field by ref
playwright-cli fill 15 "hello world"

# Take a screenshot
playwright-cli screenshot
```

## Sessions

playwright-cli supports multiple browser sessions. Use `-s=<name>` to target a specific session.

```bash
playwright-cli -s=myapp open https://myapp.com
playwright-cli -s=myapp snapshot
playwright-cli list          # list all sessions
playwright-cli close-all     # close all sessions
```

## All Commands

### Core
- `open [url]` -- open the browser (optionally to a URL)
- `close` -- close the browser
- `goto <url>` -- navigate to a URL
- `snapshot` -- capture page snapshot to obtain element refs
- `click <ref> [button]` -- click an element
- `dblclick <ref> [button]` -- double click
- `fill <ref> <text>` -- fill text into an input/textarea
- `type <text>` -- type text into the focused element
- `select <ref> <val>` -- select dropdown option
- `check <ref>` / `uncheck <ref>` -- toggle checkbox/radio
- `hover <ref>` -- hover over element
- `drag <startRef> <endRef>` -- drag and drop
- `upload <file>` -- upload file(s)
- `eval <func> [ref]` -- evaluate JS on page or element
- `dialog-accept [prompt]` / `dialog-dismiss` -- handle dialogs
- `resize <w> <h>` -- resize browser window
- `delete-data` -- delete session data

### Navigation
- `go-back` / `go-forward` / `reload`

### Keyboard
- `press <key>` -- press a key (e.g. `Enter`, `Tab`, `ArrowDown`)
- `keydown <key>` / `keyup <key>`

### Mouse
- `mousemove <x> <y>` / `mousedown` / `mouseup` / `mousewheel <dx> <dy>`

### Save as
- `screenshot [ref]` -- screenshot page or specific element
- `pdf` -- save page as PDF

### Tabs
- `tab-list` -- list all tabs
- `tab-new [url]` -- open new tab
- `tab-close [index]` -- close tab
- `tab-select <index>` -- switch to tab

### Storage & Cookies
- `state-save [filename]` / `state-load <filename>` -- save/load auth state
- `cookie-list` / `cookie-get <name>` / `cookie-set <name> <value>` / `cookie-delete <name>` / `cookie-clear`
- `localstorage-list` / `localstorage-get <key>` / `localstorage-set <key> <value>` / `localstorage-delete <key>` / `localstorage-clear`
- `sessionstorage-list` / `sessionstorage-get` / `sessionstorage-set` / `sessionstorage-delete` / `sessionstorage-clear`

### Network
- `route <pattern>` -- mock network requests matching a URL pattern
- `route-list` -- list active routes
- `unroute [pattern]` -- remove routes

### DevTools
- `console [min-level]` -- list console messages
- `network` -- list network requests
- `run-code <code>` -- run Playwright code snippet
- `tracing-start` / `tracing-stop` -- record traces
- `video-start` / `video-stop` -- record video
- `show` / `devtools-start` -- open browser devtools

## Tips

- Always `snapshot` after navigation or interaction to see current state and fresh refs
- Element refs are numbers from the snapshot output -- use them for click, fill, etc.
- Use `screenshot` to visually verify what the page looks like
- Use `state-save` / `state-load` to persist login sessions across runs
- Use `eval` for complex JS operations the other commands can't handle
- Use `route` to mock API responses for testing
