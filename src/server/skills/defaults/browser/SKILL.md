---
name: browser
description: Interactive browser control via playwright-cli commands (open, snapshot, click, fill, screenshot, etc.)
metadata:
  version: 1.2.0
  openfox:
    displayName: Browser
---

# @playwright/cli

Interactive browser automation via the official Microsoft [`@playwright/cli`](https://github.com/microsoft/playwright-cli) package.
Use `run_command` to execute these commands.

Invoke it through npx — works on any machine with Node, no global or project-local install required:

```bash
npx -y @playwright/cli <command>
```

> `-y` auto-confirms npx's one-time package download (cached afterwards). If you already installed it globally (`npm install -g @playwright/cli@latest`), the plain `playwright-cli` command works the same.

## Core Workflow

open a page -> snapshot to get element refs -> interact using refs -> snapshot again. Every command echoes the latest snapshot.

```bash
# Open a URL (headless by default; add --headed to show a window)
npx -y @playwright/cli open https://example.com
# Interact using refs from the snapshot
npx -y @playwright/cli click e42
npx -y @playwright/cli fill e15 "hello world"
# Re-snapshot to see the result
npx -y @playwright/cli snapshot
# Screenshot (only when a visual is needed — snapshots are the norm)
npx -y @playwright/cli screenshot
# Close the browser when done — leaving it open leaks CPU
npx -y @playwright/cli close
```

## Local files

`@playwright/cli` cannot open `file://` URLs — `open file:///path/to/index.html` will not work. To inspect a local HTML file, serve it over HTTP from a background process, then open the URL:

```bash
# Serve the current directory (default port 3000)
npx -y serve
# Serve a specific folder on a custom port
npx -y serve ./dist -p 8080
```

Launch it with the `background_process` tool (not `run_command`, which would block until the server exits), then open the address in the browser:

```bash
npx -y @playwright/cli open http://localhost:3000
```

Stop the background process when you're done with it.

## Cleaning up

Closing the browser is part of the workflow, not an afterthought: Chromium can leave orphaned processes behind (a known upstream quirk) that keep burning CPU. If you suspect a leftover browser, reclaim it:

```bash
# See what's still running
npx -y @playwright/cli list
# Close every browser session
npx -y @playwright/cli close-all
# Force-kill stale/zombie browser processes
npx -y @playwright/cli kill-all
```

## Screenshot workflow

After `npx -y @playwright/cli screenshot`, always use the `read_file` tool on the path of the image returned by playwright-cli — so you can see it, and the user can see it too.

## All Commands

- `open [url]` -- open the browser (optionally to a URL)
- use `npx -y @playwright/cli --help` to get all available commands
