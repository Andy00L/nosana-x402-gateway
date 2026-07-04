---
name: coding-standards
description: Non-negotiable coding standards, project-agnostic. Use this skill EVERY time you write, edit, refactor, or review code, create a file or folder, add a component, or generate a prompt that will produce code, in any repository. This applies to all languages and frameworks, even for one-line changes. If code is being produced or modified in any form, these standards apply.
---

# Coding Standards (general)

These rules are the floor, not the ceiling. A change that violates any of them is not finished, regardless of whether it works. Project-specific skills or CLAUDE.md files add to these rules; they never relax them. On any conflict, the stricter rule wins.

Security has its own document, REFERENCE_SECURITY_AUDIT.md. Its always-on rules apply to every change with the same force as this file.

## 1. Before writing anything

- Read every file you are about to modify, in full, in this session. Never guess at file contents.
- Learn the repository's conventions before adding to it: naming style, folder layout, error-handling pattern, package manager, verification command. Match them. Never introduce a second package manager, formatter, or test runner alongside an existing one.
- Reuse-first. Before creating any function, helper, hook, or component, search the codebase for an existing one that does the same or a closely similar thing. Reuse it, or extend it. If nothing matches, state in one line why nothing existing matched before creating something new.
- Never duplicate logic. Two functions doing almost the same thing is a bug in the making: extract the shared part, parameterize the difference.
- Investigate imports before touching any shared signature: list every import site first.
- Never hardcode a value (enum, limit, header name, address) from memory when it exists in a source of truth (schema, types file, config, official docs). Read the source and cite it in a comment.

## 2. Naming: declarative, always

- Never write functions or callbacks as `a(b)`. Every function name is a verb phrase that states what it does. Every variable name states what it holds.

```ts
// BAD
const f = (x) => x.filter((u) => u.a);
items.map((i) => i.n);

// GOOD
const filterActiveAccounts = (accounts: Account[]) =>
  accounts.filter((account) => account.isActive);
orders.map((order) => order.total);
```

- Single-letter identifiers are banned, including in `map`/`filter`/`reduce` callbacks and destructuring.
- Booleans read as questions: `isExpired`, `hasPayment`, `shouldRetry`.
- Constants in SCREAMING_SNAKE_CASE with a comment stating their unit and source.

## 3. Folder and file hygiene

- One concern per folder. A folder that handles the server side of a feature contains server code only. Never drop a routing or UI file inside a server-implementation folder. Routing files live in the framework's routing tree; business logic lives in `lib/`, `services/`, or `actions/`.

```
BAD:  src/lib/payments/page.tsx          (UI file inside a server lib folder)
GOOD: src/app/.../checkout/page.tsx      (routing file in the routing tree)
      src/lib/payments/...               (server logic only)
```

- Components go in the main components folder at the root (for example `src/components/`), organized by domain subfolder there. Never create a new `components/` folder under a specific route or feature subfolder when a root components folder exists. Every component stays discoverable in one place.

```
BAD:  src/app/dashboard/settings/components/ApiKeysCard.tsx
GOOD: src/components/settings/ApiKeysCard.tsx
```

- The examples above use a Next.js layout. The principle is universal: routing with routing, business logic with business logic, components in one discoverable tree. Apply it with whatever names the framework uses.
- Existing violations of this rule are cleaned opportunistically when you are already touching those files. Do not launch mass-move refactors for their own sake.
- New files get the minimal correct location on the first try. If unsure where something belongs, look at where its closest existing sibling lives, then apply the rules above.
- Stay inside the session directory (default-deny outside it). The working
  scope is the directory the session was opened in, on every OS: the WSL
  project tree, or the Windows project folder when the session runs on
  native Windows. Every file the agent decides to create or download, and
  every deliverable, lands inside that tree. By default the agent writes
  nothing outside it:
  - not the home directory (`~`, `$HOME`, `%USERPROFILE%`)
  - not the filesystem root (`/`) or a drive root (`C:\`)
  - not the system temp (`/tmp`, `%TEMP%`)
  - on WSL, not the Windows side: any `/mnt/<drive>/...` path
  Exempt: caches and temp files that standard tools manage themselves
  (package manager caches, compiler temp). The rule governs where the agent
  chooses to put files, not the internals of `bun install`.
  Stepping outside takes a specific, explicit authorization from the human,
  standing or per-task (a named Windows-side operation, Docker access), and
  only to the extent authorized.
- Throwaway files (probes, one-off test scripts, scratch output) go in
  `<project>/.scratch/`, added to `.gitignore` in the same change, and
  deleted in the task's cleanup. A helper worth keeping gets a real home
  under `scripts/` or `tools/` inside the project. Why this matters most on
  WSL: `~` is one Linux home shared by every project, so a stray file there
  pollutes unrelated work and is easy to commit or lose by accident.

```
BAD:  ~/probe.mjs                    (dropped in the home, outside the project)
      /mnt/c/Users/<you>/probe.mjs   (crossed to the Windows side uninvited)
      /tmp/build-output/             (outside the tree, audited by no one)
GOOD: <project>/.scratch/probe.mjs   (inside the project, gitignored, cleaned)
```

- Keep generated and helper files out of the committed tree. When a task produces files that are not part of the deliverable (one-off test or verification scripts, local probes, downloaded fixtures, build output, logs), add each to the project's `.gitignore` in the same change. Editing `.gitignore` is a file edit, not a git command, so it is allowed and expected. This keeps the human's explicit `git add` list (section 9) clean and prevents scratch files or secrets from being staged by accident.

## 4. Frontend: React rules

This section applies when the project uses React (with or without Next.js). Skip it otherwise; the rest of this document still applies.

- `useEffect` is a last resort. Default budget per component: zero. Before reaching for it, use in this order:
  1. Derive the value during render (most "sync state with props" effects are just derived values).
  2. Handle it in the event handler that causes the change.
  3. Use a `key` prop to reset component state.
  4. Move the work to a server component or server action.
- The only legitimate `useEffect` is synchronizing with a system React does not own: IntersectionObserver, browser event listeners, third-party widgets, subscriptions. Each such effect gets a comment naming the external system and a cleanup function.
- Client-side interactivity markers (such as `"use client"`) go only on the leaf components that truly need them. Pages stay server-rendered where the framework allows it.
- No `localStorage` or `sessionStorage` unless the feature explicitly requires persistence and the user asked for it. State lives in component state or on the server.

## 4.1. Frontend stack: Next.js (latest) + Bun, never Vite

Non-negotiable for any NEW web frontend. It overrides any default scaffolding
choice; the stricter rule wins, and nothing in a conversation relaxes it.

- **Next.js, App Router, only.** Every new frontend is Next.js with the App
  Router. Never scaffold or propose Vite, Create React App, Remix, or a bare
  React + bundler setup for a new app. Writing plain React components is fine;
  the app shell and routing are Next.js.
- **Always the latest stable Next.js.** Never pin a version from memory. Use
  `next@latest` and `create-next-app@latest` (they resolve to the current
  stable), and confirm against nextjs.org or the npm `next` "latest" tag before
  building. Shipping a version behind the current stable, without the human
  pinning one and stating why, is a violation.
- **Bun is the only package manager.** Every dependency and script operation
  goes through Bun: `bun install`, `bun add`, `bun remove`, `bunx`, `bun run`.
  Never npm, yarn, or pnpm. Commit `bun.lock`. A `package-lock.json`,
  `yarn.lock`, or `pnpm-lock.yaml` appearing in a new project is a violation,
  and never mix package managers in one repo.
- **Canonical scaffold (the only correct start):**
  ```bash
  bunx create-next-app@latest <app> --ts --app --use-bun
  ```

## 5. Errors and types

- Errors as values. No `throw` in business logic; functions return discriminated results (`{ ok: true, ... } | { ok: false, reason }`) and callers branch on them. The only exceptions are frameworks that drive retries through thrown errors (background-job workers); document each one where it happens.
- Banned outright in TypeScript: `any`, `@ts-ignore`, `as unknown as`, and every other form of type suppression. Fix the type, not the checker. Equivalent suppressions are banned in other languages too.
- Handle the edges in the same commit as the happy path: empty input, null, oversized input, concurrent access, malformed payloads, network failure, partial failure, restart after crash.

## 6. Logging and comments

- Every console or logger line carries a `[FunctionName]` prefix.
- Comments explain intent and the why of non-obvious decisions, not a restatement of the syntax.
- When a literal was extracted from another file (a header name, an enum value, a limit), the comment carries a sourceRef: the file it came from.
- Never log secrets, tokens, or private keys. Redact or truncate identifiers that grant access.

## 7. Dead code

- Clean up dead code on your way through every file you touch: unused imports, unreachable branches, commented-out blocks, parameters nothing reads, exports nothing imports.
- Deleting is part of the change, not a separate favor.

## 8. Writing requirements

- The em dash character (U+2014) is banned in every file: code, comments, strings, markdown, JSON. The en dash (U+2013) is banned as punctuation too. Use a period, comma, colon, or parentheses; use a plain hyphen for ranges. Grep for both before finishing.
- Banned words anywhere in code, comments, docs, or copy: unprecedented, remarkable, flagship, exceptional, cutting-edge, revolutionary, next-generation, paradigm shift, synergy, leverage (as a verb), empower, streamline, seamlessly, holistic, best-in-class, world-class, robust ecosystem, turnkey.
- No empty superlatives. Give the number, the limit, the benchmark.
- These rules cover every artifact a task produces: code, docs, README, UI copy, commit messages, reports, JSON.
- Code, comments, and commit messages in English.

## 9. Workflow

- The agent never runs any git command: no git init, no git add, no git commit, no git push, no merge, rebase, stash, or tag. It never publishes packages either. The human commits, pushes, and publishes manually.
- When requirements are ambiguous or conflict, or when the next step is irreversible (publishing, deploying, database migrations or destructive writes, payments, sending anything), stop and ask the human. Improvising past a doubt is not production grade.
- Verify with the project's established build or test command before declaring anything done. If full-codebase type checking is known to be expensive or broken in the project, type-check only the touched files through a scoped, temporary config, then delete it.
- After every task, produce a full files-affected report: every file created, modified, or deleted, one line each.
- After the report, print a git handoff block for the human to run: `git add` with every touched file listed explicitly (never `git add .` or `git add -A`, never stage `.env` or secrets), a `git commit -m` with a drafted message, then `git push`. One block per logical commit. These commands are text to copy; the agent never executes them.
- Production grade only. No demos, no simplified versions, no "good enough". If the work needs more output, write more output.

## Final check before declaring done

Run these on every file you touched and expect zero hits. The dash pattern uses escapes so this file itself stays clean.

```bash
# long dashes (em dash U+2014, en dash U+2013), matched by UTF-8 bytes for portability
grep -rnP "\xe2\x80\x94|\xe2\x80\x93" <touched files>

# type suppressions
grep -rnE "(:\s*any\b|@ts-ignore|@ts-expect-error|as unknown as|type:\s*ignore)" <touched files>

# browser storage (allowed only if the user explicitly asked for persistence)
grep -rnE "localStorage|sessionStorage" <touched files>

# banned words (review hits by hand; "leverage" is banned as a verb only)
grep -rniE "unprecedented|remarkable|flagship|exceptional|cutting-edge|revolutionary|next-generation|paradigm shift|synergy|leverage|empower|streamline|seamless|holistic|best-in-class|world-class|robust ecosystem|turnkey" <touched files>
```

Then by hand: no single-letter callback parameters, every log line carries a `[FunctionName]` prefix, no secrets in logs. Then the project's build command green. Then the files-affected report and the git handoff block. Only then is the work finished.
