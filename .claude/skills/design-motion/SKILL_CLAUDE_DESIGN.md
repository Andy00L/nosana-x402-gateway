# SKILL_CLAUDE_DESIGN.md: the generate-and-integrate loop (Claude Design)

This is the workflow for producing UI through a generation tool instead of
hand-building it. The loop has three legs: (1) the session compiles the
project's design system into a prompt pack, (2) the human runs the prompts in
Claude Design (high) and returns the generated UI, (3) the session integrates
it into the codebase (the wiring: data, states, routes) and gates it. It is
the preferred strategy for a major new surface (a whole frontend, a big page
set) when the human confirms it; small changes are faster hand-built with
`SKILL_UI.md`.

Companion documents: `DESIGN_AND_MOTION_PLAYBOOK.md` (the standards) and
`SKILL_UI.md` (whose framing, grounding, research, states matrix, and gate
this workflow reuses). Read both with this file.

The division of labor that makes the loop work: the generator owns visual
exploration and first drafts; the session owns the system (tokens), the
states, the wiring, and the gate. Generated output is a draft, never merged
as-is. The single biggest failure of naive generation is prompting without a
token sheet: the tool returns competent generic UI, the exact template look
this system exists to kill. The sheet is the compression that makes prompts
short AND specific.

---

## 1. Preconditions (before writing any prompt)

- **The per-project sheet exists.** Run SKILL_UI steps 2 to 4 first (frame,
  ground, research, signature candidates). No sheet, no prompts.
- **Inventory the real product:** routes and screens list, the data shapes
  each screen renders (real field names, real magnitudes), the actions each
  screen offers, existing components worth keeping. Prompts describe real
  screens; a generator fed vague scope invents features that then get cut.
- **Order the screen list hero-first.** The interface's hero moment is
  generated first because it locks the style; every later screen references
  it. Generating screens in random order produces five styles.
- **Collect the attachments:** logo and glyphs, font names or files, one to
  three existing screenshots if any, and a palette card. Render the palette
  card yourself: one plain HTML frame showing the field, the surfaces, the
  seven palette roles with hex labels, the type pairing, and a sample
  primitive or two, screenshotted at 2x (the SKILL_ANIMATION reference-frame
  discipline). Generation tools match attached images far better than prose.

## 2. The prompt pack (the deliverable of this leg)

One copy-paste document, in this order:

1. **The system prompt**, sent with every screen. It contains: the product in
   one line; the register; the full token sheet inline (palette roles with
   hex, type pairing and weight ceiling, radii and spacing scale, the
   material recipe as literal CSS, the shadow stack, the signature element
   and its placement rule); the hard rules (one accent; the field, never
   flat white; every state designed; realistic data only; the playbook's
   amateur tells written as explicit "never do" lines); the accessibility
   floor (contrast, focus visibility, touch targets); and the output
   expectations (the project's framework and styling system, component
   naming, files per screen).
2. **One prompt per screen**, each holding: the screen's purpose in one
   sentence; the layout skeleton in words (regions and what sits where,
   density profile); the exact components present with the real field names
   and real sample data to render (inline, realistic lengths and
   magnitudes); which states to design for this screen (loading, empty,
   error, disabled where relevant); the responsive intent (what collapses,
   what hides); and what not to invent (no extra features, no placeholder
   nav items).
3. **The attachment list**, item by item, with one line on what each pins
   (the palette card pins color and material; the screenshot pins layout
   density; the logo pins the mark).
4. **The iteration guide for the human:** generate the hero screen first and
   lock it; for every later screen, attach the accepted hero export and ask
   the tool to match the established style; change one variable per
   regeneration ("same screen, tighter density", never three changes at
   once); generate 3 to 5 variants per screen and pick; export code per
   accepted screen and note which variant won.

Prompt writing rules: values, not adjectives (hex, px, family names; a
benchmarkable claim or nothing); name anti-patterns explicitly (the tells
travel well as "never" lines); demand the states in the prompt (generators
skip empty and error unless told); keep each screen prompt self-contained
(the tool has no memory of the pack, only what is pasted).

## 3. Intake (what comes back from the human)

- Receive the exported code (or code plus screenshots) and the note of which
  variant won per screen. Read everything before touching anything
  (SKILL_GENERAL section 1 applies to generated code too).
- **Inventory it:** files, the dependencies it assumes, every hardcoded
  value, every invented component, every state it skipped.
- **Triage, one decision each:**
  - The generator used its own utility classes or component library: decide
    once, for the whole batch, between transplanting the generated styles
    onto the project's existing primitives, or adopting the generated
    structure and re-tokenizing it. The rule: fewest new dependencies wins,
    and never two component systems in one repo.
  - Off-sheet colors, fonts, or radii appear throughout: if it is a handful,
    conform them during integration; if it is systemic, re-prompt that screen
    with the palette card attached rather than hand-repainting every node.
    One re-prompt is cheaper than fifty edits.
  - Invented features or fields: cut to the real data shape from the
    inventory in section 1. The generator's imagination is not a spec.

## 4. Integration (the wiring)

The ordered pass that turns a draft into product code:

1. **Placement:** components into the root components tree by domain,
   routing files into the framework's routing tree (SKILL_GENERAL section
   3); nothing lands in a route-local components folder.
2. **Re-tokenize:** every literal color, spacing, radius, shadow, and font in
   the generated code re-mapped to the sheet's tokens. The diff should read
   as "values became tokens". A literal that survives is a future
   inconsistency.
3. **Wire data and actions:** replace sample data with real state, server
   data, or props; hook actions to real handlers; type everything fully (no
   `any`, errors as values, per SKILL_GENERAL).
4. **Build the missing states:** generators reliably skip loading, empty,
   error, and disabled. Add them from the project's primitives following the
   SKILL_UI section 8 matrix, in this same change.
5. **Accessibility and responsive completion:** focus order and visibility,
   labels, semantic landmarks, contrast re-checked after any color
   conforming, every breakpoint looked at, touch targets verified.
6. **Motion:** apply the sheet's motion tokens to hover, press, and reveals;
   wire `prefers-reduced-motion`.
7. **Dead code sweep:** unused generated variants, unused classes and
   imports, commented-out blocks: deleted in this change (SKILL_GENERAL
   section 7).

## 5. The gate

Run the SKILL_UI section 10 gate on the integrated result inside the real
app, not on the generator's preview: screenshots at 2x of every screen and
triggered state, checked against the sheet, the playbook contract (5.2), and
the amateur tells (5.1). Plus the loop-specific checks:

1. No off-token literal survived (search the touched files for hex values
   and pixel literals outside the tokens file; expect zero unexplained
   hits).
2. No second component library or styling system entered the project
   manifest.
3. The style lock held: the hero screen and every later screen read as one
   product in a side-by-side of the screenshots.
4. Everything the generator invented off-sheet was either conformed, cut, or
   deliberately adopted into the sheet (see section 6), with no silent
   drift.

If a screen fails on style, prefer one re-prompt with a tightened system
prompt over deep hand-repainting; hand-fix only local issues. Note what was
re-prompted and why, so the pack improves for the next screen.

## 6. Edge cases of the loop

- **No brand, no sheet possible yet:** run the SKILL_UI grounding step to
  define one from the register. Never prompt without a sheet; that is the
  template-look path.
- **The generated output beats the sheet somewhere** (a better surface
  treatment, a smarter density): update the sheet deliberately, as one
  recorded decision (in `docs/DECISIONS.md` when the project keeps one), then
  conform everything else to the updated sheet. Improvement enters through
  the sheet or not at all.
- **Partial acceptance:** integrate the approved screens now; keep the prompt
  pack in the project (`docs/` or the design folder) so regenerating screen
  four later does not restyle screen one. The system prompt is the anchor;
  regenerations always resend it.
- **The human returns screenshots only, no code:** treat them as validated
  reference frames and hand-build with SKILL_UI, matching the frames.
- **Multi-session reality:** the sheet and the prompt pack live in the
  project, never only in chat. The integration session may not be the
  session that wrote the pack; the files are the contract between them.
- **The generation tool is unavailable:** fall back to SKILL_UI end to end;
  the sheet and research already done transfer as-is.

The general coding standards and the security always-on rules apply to every
line of integrated code; the stricter rule wins. The task ends, as always,
with the SKILL_GENERAL final check, the files-affected report, and the git
handoff block.
