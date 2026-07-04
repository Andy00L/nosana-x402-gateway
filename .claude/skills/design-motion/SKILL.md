---
name: design-motion
description: Use whenever the task creates or changes anything the user will see: building or restyling UI (components, pages, layouts, styling, a new frontend, a landing page, a dashboard), creating an animation or any motion piece (UI motion, hero reveal, product film, promo, demo insert, loading or ambient piece), preparing prompts for Claude Design or another generation tool to produce UI or motion, or reviewing an interface's design quality. Routes to the static-UI workflow, the animation workflow, or the generate-and-integrate loop, which share one playbook: token-first system, materials, motion families, finishing pass, coherence guardrail, and pass/fail gates. Do not load only for pure backend or logic changes with no visible surface.
---

# Design and motion (the router: loads the right workflow on demand)

This skill keeps the design standards out of context until a visual task shows
up, then loads exactly what that task needs. When it triggers, do all of the
following before producing anything:

1. Read `DESIGN_AND_MOTION_PLAYBOOK.md` in this folder, in full, always. It is
   the shared standard: the token sheet method, palette and material recipes,
   motion tokens and families, the finishing pass, the coherence guardrail,
   the amateur tells, and the pass/fail checklist.
2. Read the workflow that matches the task, in full:
   - Building or changing static UI (screens, components, pages, styling, a
     new frontend): `SKILL_UI.md`.
   - Creating an animation or a motion piece: `SKILL_ANIMATION.md`.
   - Compiling prompts for Claude Design (or a comparable generation tool)
     and integrating the UI that comes back: `SKILL_CLAUDE_DESIGN.md`. This
     is the preferred strategy for a major new surface when the human
     confirms it, and it requires the framing, grounding, and research steps
     of `SKILL_UI.md` first.
   - Mixed tasks read every workflow that applies. A new frontend with a hero
     animation reads all three.
3. Fill the per-project sheet at the end of the playbook for the product at
   hand. If the project already has a design system, that system supplies the
   exact token values and the playbook supplies the method.
4. Where any workflow refers to `docs/DESIGN_AND_MOTION_PLAYBOOK.md`, use the
   copy in this folder; a project-local copy under `docs/` wins if present.
5. Nothing ships before the matching gate passes: SKILL_UI section 10 for
   screens, SKILL_ANIMATION section 7 for motion, SKILL_CLAUDE_DESIGN
   section 5 for integrated generated UI.

The general coding standards (SKILL_GENERAL.md) and the security always-on
rules keep applying to any code this work produces; the stricter rule wins.
After reading this skill and its documents, extend the acknowledgement line
from CLAUDE.md to: Standards loaded: coding-standards + security-audit +
design-motion
