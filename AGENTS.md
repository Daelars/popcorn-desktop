# Popcorn Time Desktop

## Main process architecture

Rules for anything under `src/main/` or `src/shared/`:

- Services are Effect `Layer`s, composed from a single root in the main process.
- `Effect.runPromise` lives at the IPC handler boundary and nowhere else.
- Failures are tagged errors from `src/shared/errors.ts`; never throw strings.
- Scoped resources use `Scope` + `acquireRelease`, never manual cleanup flags.
- The renderer imports only from `src/shared/`, never from `src/main/`.

## Agent skills

### Issue tracker

Issues live as GitHub issues on `Daelars/popcorn-desktop`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

## Glossary

We need to be on the same page with terminology. When communicating, use this language:

- you means the agent reading this file and changing stuff.
- we, us, and maintainers mean Dale, the agent and the people building this. These are who you are talking to now.
- user means the person using this to direct coding agents.
- agent means the coding agent a user runs inside this. Depending on context, that may also include you.
- provider means the agent runtime or harness this talks to, such as Codex, Claude, Cursor, or OpenCode.
- client means the web, desktop, or mobile UI.
- environment means one running this and the machine, filesystem, provider credentials, and state it owns.
- project means an environment-local workspace record rooted at a directory.
- thread means the durable conversation and work history for a project.
- turn means one user-to-agent cycle, including follow-up work such as checkpointing.
- home means the base data directory. Runtime state normally lives below its userdata directory.

## Commands

- Avoid staarting long-running dev servers by default; assume the user may already have one running unless task requires other.
- prefer targeted verification first, such as 'typecheck', 'link', and focused tests.
- rurn full builds only when they are necessary to verify the change, the suer asks for them, or there is no cheaper relable check.

## Coding preferences - general

- Keep things simple. Channel "yagni" energy unless told otherwise.
- Typesafety is useful, take advantage of it.
- Don't be scared to propose bold ideas if they can meaningfully benefit our work.
- Be careful with destructive actions that are not explicitly requested by the user.
- Tests are good! Endless smoke tests, "regression tests" for feature deletions, etc, much less good. Tests should be focused, not slop.
- Comments are a great way to clarify functionality and how code is used. Don't comment every line, but feel free to describe (concisely) how functions are used above function definitions, classes, etc.
- Keep comments up to date! When making changes, it's important to keep things in sync.

## Coding preferences (Typescript focused)

- `any` is the enemy. Inferred types are our friend. Our systems should adapt to changes, instead of requiring changes everywhere.
- If your TS code looks like a Python dev wrote it, it is bad TS code.
- Avoid one-line functions that are just casting wrappers.
- Write TypeScript in ways that Matt Pocock and Theo would be proud of.

## Questions are read-only

- A question is a request for an answer, not for changes. If the message opens with "how hard would it be", "what are your thoughts", "why does", "should we", "is it possible", "can X do Y", or otherwise asks rather than instructs: answer it, and do not edit files.
- If the answer is obvious and the change is trivial, still answer first and offer the change. Ask before making it.

## Tests

- New test files are opt-in. Do not create unit, integration, end-to-end, or spec files, or new test-only helpers/fixtures, unless the user explicitly requests their creation or approves it first.

- A request to implement, fix, test, or verify something does not by itself authorize new test files. Assume no by default; ask only when creating them has a concrete benefit, not as a routine step.
- Prefer running existing tests and direct browser/runtime checks without adding test files. Where test changes are in scope, exercise observable behavior rather than asserting source-code strings, implementation shapes, or that tests exist.
