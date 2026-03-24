---
id: playwright-cli
name: Playwright CLI
description: Interactive browser control via playwright-cli commands (open, snapshot, click, fill, screenshot, etc.)
version: 1.0.0
---

# playwright-cli

You have access to `npx playwright-cli` for interactive browser automation via the terminal.
Use `run_command` to execute these commands.

## Core Workflow

The typical workflow is: open a page -> snapshot to get element refs -> interact using refs -> snapshot again.

```bash
# Open a URL
npx playwright-cli open https://example.com
# Take a snapshot to see the page and get element refs
npx playwright-cli snapshot
# Click an element by ref number from snapshot
npx playwright-cli click 42
# Fill a form field by ref
npx playwright-cli fill 15 "hello world"
# Take a screenshot
npx playwright-cli screenshot
```

## Screenshot workflow

After doing `npx playwright-cli screenshot`, always use the `read_file` tool on the path of the image returned by playwright-cli.
This allows you to see the image, and for the user to see it as well.

## All Commands

- `open [url]` -- open the browser (optionally to a URL)
- use `npx playwright-cli --help` to get all available commands
