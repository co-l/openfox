---
id: test-ui
name: Test UI
---

Test the feature we've been working on in the browser using the `playwright-cli` skill.

1. Load the `playwright-cli` skill
2. Check if the dev server is already running; if not, start it
3. Open the app in the browser
4. Take a snapshot to see the current state
5. Interact with the UI to exercise the current feature
6. Verify it works as expected - check for visual correctness, functionality, and edge cases
7. Take screenshots throughout testing and use `read_file` on them so they appear inline in the conversation
8. Report back with what you found
