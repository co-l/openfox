# Slash Command Arguments

## Goal

Make command arguments usable for the two things people actually type: a value that contains spaces, and a free-form instruction.

Commands already accepted positional arguments — `{{name}}` placeholders filled by order of appearance — but the invocation was split on `/\s+/` with no notion of quoting, and there was no way to capture a whole sentence. Both gaps push users back to editing the command every time they want to vary it.

```
/revue src/a.ts "gestion des erreurs"     → {{angle}} got `"gestion`, the rest was dropped
/note rerun the flaky proxy test          → no placeholder could hold this
```

## User Experience

Two additions, both in the command's Message template.

**Quoted values.** Wrap an argument in `"…"` or `'…'` and it fills one placeholder whole.

```markdown
Relis {{file}} en te concentrant sur {{angle}}.
```

`/revue src/a.ts "gestion des erreurs"` → _Relis src/a.ts en te concentrant sur gestion des erreurs._

**`{{ARGUMENTS}}`.** Receives everything typed after the command id, verbatim.

```markdown
Add a note to the plan: {{ARGUMENTS}}
```

`/note rerun the flaky proxy test` → _Add a note to the plan: rerun the flaky proxy test_

Both forms coexist with what already worked: unfilled placeholders still open the params modal, so `/revue` alone asks for `file` and `angle` in a dialog. The command editor now carries a one-line description of all of this, which nothing documented before.

## Technical Design

### One module, both callers

Parsing lived in two places that had drifted into near-duplicates: `web/src/lib/parse-slash-command.ts` for the chat composer and `src/server/tasks/slash.ts` for slash commands seeded into task sessions. Each had its own `extractTemplateParams` and its own `split(/\s+/)`.

`src/shared/slash-args.ts` is now the single implementation, reachable from web through the existing `@shared` alias. Both callers delegate to it, so a command typed in chat and the same command seeded into a task expand identically — which was the point of `src/server/tasks/slash.ts` existing in the first place.

```ts
tokenizeArgs(line): string[] // quote-aware split
parseSlashInput(prompt): { id, args, rest } | null
extractTemplateParams(template): string[] // every {{name}}, in order, deduplicated
positionalTemplateParams(template): string[] // …except {{ARGUMENTS}}
templateParamHints(template): string[] // positional first, {{ARGUMENTS}} last
resolveTemplateParams(template, args, rest): { params, unfilledParams }
applyTemplateParams(template, params): string
expandCommandPrompt(template, args, rest): { prompt, unfilledParams }
```

### Tokenizer

A `"…"` or `'…'` run is one token and the quotes are stripped. Inside double quotes a backslash escapes the next character; single quotes are literal, as in POSIX shells. Quoted and unquoted fragments that touch join into one token, so `src/"my file".ts` is a single path.

An unterminated quote takes the rest of the line rather than erroring. Someone mid-keystroke has an unterminated quote most of the time, and the inline hint reads the same buffer.

### `{{ARGUMENTS}}`

Exact, uppercase, case-sensitive — a placeholder named `arguments` stays an ordinary positional slot. It is excluded from positional numbering, so it never consumes a token another placeholder was waiting for. It takes `rest`: the raw text after the id, trimmed, quotes included.

Raw rather than re-joined tokens because `{{ARGUMENTS}}` means "what I typed". A template that mixes both forms sees each argument twice — once in its positional slot, once inside `{{ARGUMENTS}}` — which matches `$1` and `$ARGUMENTS` elsewhere and is what someone writing that template is asking for.

Nothing typed after the id leaves `{{ARGUMENTS}}` unfilled, and it flows through the existing unfilled-placeholder path: the modal asks, or `resolveSlashLaunch` declines and the task falls back to the raw prompt.

### Inline hints

The composer's `param=?` hint counted arguments with `split(/\s+/)`, so a quoted value made it skip ahead. It now counts with `tokenizeArgs`.

`templateParamHints` orders `{{ARGUMENTS}}` last regardless of where it appears in the template, so the hint walks the positional slots first and only then offers `ARGUMENTS=?` — the order in which they have to be typed. The server computes it in `routes/commands.ts`, so the composer and the task editor get the same hints from one place.

## Edge Cases

- **Backward compatibility.** With no `{{ARGUMENTS}}` in the template, positional resolution is what it was; with no quotes in the invocation, tokenization is what it was. Every pre-existing test passes with only the two new fields added to the parse result.
- **Empty quoted argument.** `/cmd "" b` yields `['', 'b']`; the placeholder is filled with an empty string rather than reported unfilled — the user said "nothing" explicitly.
- **Workflows.** They share the tokenizer, so quoted values now work for workflow parameters too. `{{ARGUMENTS}}` does not apply: workflows declare typed parameters instead of a template.
- **Repeated placeholder.** `{{a}} … {{a}}` counts as one slot and every occurrence is replaced.
- **Unfilled placeholder.** Left literally in the prompt and reported, never substituted with an empty string — that is what lets the caller ask instead of silently sending `{{file}}` to the model.

## Out of Scope

- Named arguments (`--file=x`)
- Default values and required markers for command placeholders — workflows have declared `parameters` with `required` and `position`; commands infer their names from the template
- Shell execution or file inclusion inside a command template
