---
id: commit-push
name: Commit & Push
agentMode: builder
---

Commit and push:

0. `npm test` -> make sure the project is green
1. `git status` -> verify what files are modified
2. `git add` -> never do `-A`, add your files and your files only
3. `git commit -m` -> add a clear message
4. `git push` -> if push fails, it's probably because of an existing commit coming from origin. If that's the case, you need to rebase your commit on top of it and fix the issues that arise. Make sure `npm test` is still green after your rebase.
