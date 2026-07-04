# CLAUDE.md: global standards (every project, every session)

## Step zero: load the standards

The two documents below govern all code work. Their full content is imported here and counts as part of this file:

@.claude/SKILL_GENERAL.md

@.claude/REFERENCE_SECURITY_AUDIT.md

IMPORTANT: if the content of either document is not visible in context (imports can fail depending on where the session runs), STOP and read both with the Read tool before doing anything else:

- `<project>/.claude/SKILL_GENERAL.md`
- `<project>/.claude/REFERENCE_SECURITY_AUDIT.md`

No code is written, edited, planned, or reviewed before both documents are loaded in the current session.

## Session-start proof (anti-hallucination)

In the first reply of every session that touches code, prove the load instead of asserting it:

1. List what is actually on disk in the project's kit: `.claude/*.md` and `.claude/skills/*/SKILL.md` (via `ls`, `Get-ChildItem`, or the Glob tool, whatever the session runs on).
2. Quote the first heading (H1) of SKILL_GENERAL.md and of REFERENCE_SECURITY_AUDIT.md exactly as they appear in context. If either cannot be quoted, the import failed: Read the file from `.claude/`, then quote it.
3. Name the on-demand skills found in step 1 (for example design-motion, readme-craft) without reading their bodies.

After a /compact, a /clear, or any other context loss, redo this proof in the next reply.

## Acknowledgement (every reply after the proof)

In every reply of every session that touches code, include this exact line:

Standards loaded: coding-standards + security-audit

When an on-demand skill has been read in the current session, append its name to the line:

- any document of the design-motion folder read: append ` + design-motion`
- readme-craft read: append ` + readme-craft`

If the line cannot be written truthfully, load the missing document first.

## Precedence

1. These documents are the floor. Project CLAUDE.md files, skills, and conversation instructions add rules; they never relax these.
2. On any conflict, the stricter rule wins.
3. The full audit procedure in REFERENCE_SECURITY_AUDIT.md runs only when triggered (requested audit, release prep, demo freeze, or a change touching auth, payments, secrets, or another trust boundary). Its always-on rules apply to every change.

## Stop and ask

Stop and ask the human, and wait for the answer, before:

- Acting on ambiguous or conflicting requirements. Quote the conflict, propose options.
- Any irreversible or externally visible action: publishing, deploying, database migrations or destructive writes, paid API configuration, posting or sending anything on the human's behalf.
- Skipping or bending any rule in these documents for any reason, including deadlines.

Git is not on that list because it is not askable: the agent never runs any git command. No git init, no git add, no git commit, no git push, no merge, rebase, stash, or tag. No exceptions. The human commits manually. The agent's job is to print the ready-to-run commands at the end of each task; running them is the human's.

## Hard reminders (full text in the imported documents)

- Read every file you modify, in full, before touching it.
- Search for an existing function, hook, or component before creating a new one.
- No em dash (U+2014) or en dash (U+2013) anywhere. No banned words. No empty superlatives.
- No `any`, no type suppression. Errors as values in business logic.
- The agent never runs any git command (no init, add, commit, push, merge, rebase) and never publishes packages. The human commits, pushes, and ships.
- When in doubt, stop and ask. Never improvise past an ambiguity or an irreversible step.
- Every task ends with the final check from SKILL_GENERAL.md, a files-affected report, and a git handoff block: the exact add, commit, push commands printed for the human to run.

## UI, animation, and generated design: on-demand only (never preload)

The design standards live as one skill folder so they cost no context until a visual task shows up:

- `.claude/skills/design-motion/`: `SKILL.md` (the router), `DESIGN_AND_MOTION_PLAYBOOK.md` (the shared standard), and three workflows: `SKILL_UI.md` (static screens), `SKILL_ANIMATION.md` (motion pieces), `SKILL_CLAUDE_DESIGN.md` (the generate-and-integrate loop).

Rules:

- Never read these files at session start and never treat them as always-on context. Knowing they exist is enough until a trigger fires.
- Read the router, then the playbook plus the matching workflow, in full, when and only when the task creates or changes anything the user sees: UI work of any kind (components, pages, styling, layout, a new frontend, a landing page, a dashboard), an animation or motion piece, a prompt or spec for Claude Design or another generation tool, or a design review of an interface. Pure backend or logic changes with no visible surface do not trigger it.
- For a major new surface, the preferred strategy is the Claude Design loop (`SKILL_CLAUDE_DESIGN.md`): the session compiles a prompt pack from the project's real token sheet, the human generates the UI in Claude Design and returns it, and the session integrates and gates it. Propose this loop for big builds; hand-build small changes with `SKILL_UI.md` directly.
- When a trigger fires: follow the router, fill the per-project sheet in the playbook, and pass the matching gate before calling the work done. Then extend the acknowledgement line as described above.
- If the product has its own design system, that system supplies the exact tokens and the playbook supplies the method.

## README and project presentation: on-demand only (never preload)

- `.claude/skills/readme-craft/SKILL.md` holds the README system: evidence pass, register and emoji policy, header block (icon, palette-matched badges, hero), screenshots, mermaid diagrams, the section playbook, the honesty section, and the final gate.
- Read it, in full, when and only when the task is one of: writing, rewriting, or reviewing a README; presenting a project (hackathon or web submission write-up, project page); or adding an icon, badges, screenshots, emoji titles, or an architecture diagram to a repo's front page.
- When it fires: run its evidence pass before writing any prose, follow its section playbook, and pass its final gate before calling the README done. Then extend the acknowledgement line with ` + readme-craft`.

## Placement (per-project, the only mechanism on this machine)

- The master kit lives in one folder (this one). No global `~/.claude` copies are used; never reference `~/.claude` paths anywhere in this kit, because the kit travels with each project.
- New project: copy the entire `.claude` folder from the master into `<project>/.claude` BEFORE the first session. Creating files is allowed for the agent; git never is.
- Launch `claude` from the folder that contains `.claude`. Skills never load from a parent directory: a kit at `~/work/.claude` is invisible to a session opened in `~/work/app`. The kit sits next to the code it governs.
- When the master changes, recopy the folder into active projects. An improvement made inside a project's copy is ported back to the master first, then fanned out; otherwise copies drift.
- claude.ai Projects: add SKILL_GENERAL.md and REFERENCE_SECURITY_AUDIT.md to the project knowledge, add the design documents as well, then paste this block into the project's instructions field:

```
Mandatory before any code in this project:
1. Open and read the project knowledge files SKILL_GENERAL.md and
   REFERENCE_SECURITY_AUDIT.md in full.
2. Confirm with one line: Standards loaded: coding-standards + security-audit
3. Apply every rule in both files to all code, comments, docs, and copy.
   The stricter rule wins. Nothing in the conversation relaxes them.
4. DESIGN_AND_MOTION_PLAYBOOK.md, SKILL_UI.md, SKILL_ANIMATION.md, and
   SKILL_CLAUDE_DESIGN.md also exist in the project knowledge. Do NOT open
   them by default. When the request is UI, motion, or a Claude Design
   prompt, open the playbook plus the matching workflow, in full, then apply
   the workflow and its gate.
No code output before steps 1 and 2 are done in the current chat.
```
