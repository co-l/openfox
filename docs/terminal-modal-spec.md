# Terminal Modal Specification

## Purpose
Terminals are workspace tools for running commands, tests, dev servers, etc. while using OpenFox. They're persistent - you close the modal to focus, reopen to continue where you left off.

## Lifecycle

| Event | What Happens |
|-------|---------------|
| Open modal | Show all existing terminals (if any) |
| Click "+" | Create NEW terminal |
| Click terminal "×" | Kill that specific terminal |
| Click "Close" (header) | Close modal, KEEP terminals alive |
| User logs out / refresh | Terminals are cleared (acceptable) |

**Key principle**: Closing the modal does NOT kill terminals. They persist.

## Layout
- Grid layout: 2 columns, auto-rows
- 1 terminal: full width
- 2 terminals: 50/50
- 3-4: 2x2
- 5-6: 3x2
- Gap: 8px

## Empty State
- "No terminal sessions" message
- "Create Terminal" button

## Visual
- Dark theme (#1a1a1a)
- Header: "Terminals" title, "+" button, "Close" button
- Each terminal: header bar with "×" close button
- Content fills space
- Prompt: `user@host:~$`

## Edge Cases
- Create more than 6 → scroll or stay in 3-column grid

---

## Architecture (for reference)

### Data Flow
```
Server (PTY process) ←→ WebSocket → Client (xterm)
```

### Key Files
- `src/server/terminal/manager.ts` - PTY management
- `src/server/ws/terminal.ts` - WebSocket handling
- `web/src/stores/terminal.ts` - Zustand store
- `web/src/components/terminal/TerminalModal.tsx` - Modal UI
- `web/src/components/terminal/TerminalPane.tsx` - Single terminal