# SKILL_UI.md: building premium static interfaces (any project)

This is the workflow for building screens: a new frontend, a page, a flow, a
component set, or a restyle. It is the static counterpart of
`SKILL_ANIMATION.md` and shares its companion document,
`DESIGN_AND_MOTION_PLAYBOOK.md`, which holds the standards this workflow
applies (the token system, materials, the finishing pass, the coherence
guardrail, the checklists). Read both; this file is the process.

The quality bar, in one line: screens that could sit next to Stripe, Linear,
or Wealthsimple work without embarrassment, and that a returning user could
recognize with the logo hidden. One committed field, one material, one accent,
one signature element, every value a token, every state designed.

The diagnosis this workflow exists to fix: the "template look". It is not a
lack of components; it is scaffolding shipped as identity. The tells: an
untouched default palette (framework greys, one default blue), flat white
cards with a single flat shadow, no committed field, default type at default
weights, empty states and errors left as afterthoughts, and no finishing
pass. A reference product (SealedStellar's glass over warm paper) is the
floor for the level of intent, never a set of pixels to reuse: each project
gets its own system at that level, derived from its own domain.

---

## 1. The workflow at a glance

1. **Frame** the surface: what is being built, the register, the density, the
   interface's hero moment.
2. **Ground**: extract or define the token sheet; it is a deliverable, not a
   step.
3. **Research** the craft for this register and this surface type; hunt the
   signature element. Never skipped.
4. **Primitives** before screens: the base component set, every state at
   birth.
5. **Compose** screens from primitives and tokens only, with realistic
   content.
6. **Signature**: design the one element this product owns.
7. **States and edge cases**: the full matrix, in the same change.
8. **Finishing pass**: the optical top layer, applied last, dialed low.
9. **Gate**: screenshot every screen and state, look at the images, fix,
   re-shoot.

The failure mode this order prevents: designing screens first and retrofitting
a system onto them. Screens built before tokens exist are rebuilt twice.

## 2. Frame the surface

One line each, before anything else:

- **Scope:** a whole product, one page or flow, a component set, or a restyle
  of existing screens.
- **Register:** the emotional category (calm trust, precision tools, consumer
  warmth, luxury and editorial, energy and play; the same five as
  SKILL_ANIMATION section 8). The register picks the two or three reference
  brands, the palette temperature, the type personality, and the density.
- **Density profile:** marketing surface (airy, narrative, large type),
  workspace or dashboard (dense, scannable, small type, tables), transactional
  or form (focused, single column, one action), data-heavy (tables and charts
  rule the layout).
- **The interface's hero moment:** the one screen or state the product exists
  for (an auction room, a balance, a chart, an editor). It gets the largest
  share of the design budget; every other screen is quieter so it lands.
- **Theme scope:** light, dark, or both. Decided now and tokenized from the
  start; retrofitting dark onto hardcoded colors is a rewrite.
- **Stack reality:** which framework, which styling system, which component
  library already exists in the repo. The workflow adapts to what is there
  (SKILL_GENERAL: never introduce a second one).

If the human's ask is ambiguous on scope or register, ask before building.
Everything else proceeds without another question.

## 3. Ground: the token sheet is the first deliverable

The look is extracted or defined, never improvised. Produce the filled
per-project sheet (playbook part 7) before any screen work:

- **Source order:** an existing design system or tokens file wins; then a
  brand document (a `brand.md`, a logo, marketing assets); then define fresh
  from the register using the playbook's methods (appendix B for the palette,
  2.2 and 2.3 for material and depth, appendix A if the material is glass).
- **The sheet is complete when it holds:** the seven palette roles with hex
  values, the type pairing with size steps and the weight ceiling, the radii
  scale and spacing base, the material recipe, the layered shadow stack, the
  motion tokens (the duration ladder and easing family for hover, press, and
  reveal transitions), the signature element (section 7), and the one-line
  house style.
- **Write it into the project** as `docs/UI_DESIGN_SYSTEM.md` (or the
  project's equivalent), so it outlives the session and every future session
  reads the same truth. Wire the values as CSS variables or the framework's
  token mechanism; components read tokens, never literals.
- **Pre-check contrast at token time:** body text against its field at 4.5:1
  minimum, large text at 3:1, in every theme in scope. A palette that fails
  here fails everywhere; fix it before it spreads.

Hard rules: never ship framework defaults as identity (the default grey scale
with the default blue is the loudest template tell); the field is committed
(playbook 2.1), never an accidental flat white; one accent; reserved colors
stay reserved. Never reuse another project's palette or material because it
is at hand: extract or define, then build.

## 4. The research sweep (mandatory, scaled to the task)

Smaller than the animation sweep but never skipped: vocabulary ages and the
premium bar moves. Run two or three lookups (parallel where the environment
allows):

- **A. Register craft, static:** for the two or three reference brands, how
  they build still screens: field and material, spacing rhythm, type scale
  and weights, how they handle density, what their tables and forms look
  like. Return numbers (a type scale, a spacing base, shadow values), named
  pages to study, and explicit anti-patterns. Adjectives get the query rerun.
- **B. Surface patterns:** the current best structure for this specific
  surface type: pricing page anatomy, dashboard layout patterns, settings
  pages, auth flows, data-table UX (sticky headers, density toggles, column
  alignment, row actions), checkout and form conventions. Named products, not
  theory.
- **C. The signature hunt:** what visual element this product could own,
  grounded in its domain: a material treatment, a recurring motif or
  ornament, a border or corner language, a background texture, a chart or
  data identity, an empty-state illustration family. Return three candidates
  with, for each, how it would be built from the token sheet and where it
  would appear.

## 5. Primitives before screens

Build or re-skin the base set first; screens then compose primitives only.

- **The set:** surface or card, the button set (primary, secondary, ghost,
  destructive), inputs with labels and error slots, select and menu, table,
  badge or pill, tabs and navigation, dialog or sheet, toast, skeleton, and
  the empty-state block. Each passes the material recipe and reads every
  value from the sheet.
- **Component libraries are skeletons, not skins.** Using an existing library
  (shadcn, Radix, the repo's own) is fine and often right (reuse-first); the
  work is re-mapping every visible value to the tokens so the library
  disappears visually. Never two component libraries in one repo.
- **Every state at birth:** a primitive ships with default, hover,
  focus-visible, active, disabled, and loading where it applies. A primitive
  without states is not done; retrofitting states screen by screen is how
  inconsistency enters.
- **Focus is designed, not default:** one focus treatment, visible on the
  field and on the material, consistent everywhere.
- **Icons:** one set, one stroke width, one size grid. Mixed icon sets read
  as neglect at a glance.
- Before creating any new component, search for an existing one
  (SKILL_GENERAL section 1). Extend, do not duplicate.

## 6. Compose screens

- **Layout:** playbook 2.4: a content max width, generous side padding, a
  real grid, one primary action per view. Numbers right-aligned and tabular;
  status in a consistent corner.
- **Hierarchy:** one pattern for eyebrow, title, and support text, reused on
  every screen. The eye should land in the same places on every page.
- **Realistic content only, from the first draft.** Design against the long
  name, the 12-digit amount, the empty middle state, the 40-item list. Lorem
  ipsum and "John Doe / $10" hide every layout bug that matters and make
  screenshots lie.
- **Density per the profile** chosen in step 2. Crowding kills premium faster
  than any wrong color (playbook 1.4); whitespace is a feature, not leftover
  space.
- **No one-off styles.** A screen that needs a style the system does not have
  is a decision point: extend the sheet deliberately (and record it) or
  reject the style. Silent one-offs are how systems rot.

## 7. The signature element (originality by method, not accident)

Every project gets one element (two at most) that no template ships, so its
screens are recognizable with the logo hidden. From the three research
candidates, pick the one that:

- **comes from the domain** (an auction seal, a ledger line, a wave motif, a
  terminal cursor), not from a trend board;
- **is buildable from the token sheet** (its colors, radii, and material are
  the system's own);
- **has one consistent placement logic** (once per screen, always in the same
  role: a stamp on confirmations, a motif on empty states, a treatment on the
  hero card);
- **survives the coherence guardrail** (playbook part 4): it never introduces
  a second light source, a second physics, or a competing accent.

The types that work, with the discipline each needs: a material treatment
(glass, paper, film) applied to the one surface class it belongs to; an
ornament or seal used exactly once per screen; a border or corner language
(hairline double borders, a clipped corner) applied system-wide; a background
field motif (a slow gradient, a faint grid or topography) that stays under
conscious notice; a chart identity (own stroke weights, own tooltip, own
empty axis treatment); an empty-state illustration family drawn from the
palette. Document the choice in the sheet with its placement rule.

The floor and the bar: the reference system (SealedStellar) shows the minimum
level of intent: committed field, one material, reserved accents, one
signature. The bar for a new project is its own equivalent at that level,
adapted to its register. Copying the reference's glass into an unrelated
product fails both tests at once.

## 8. States and edge cases (hard requirements, same change)

Every cell of this matrix is designed, not defaulted, and lands in the same
change as the happy path (SKILL_GENERAL section 5 applies to pixels too):

- **Interactive states:** default, hover, focus-visible, active, disabled,
  loading. Hover has a touch equivalent or is non-essential. Press feedback
  follows the playbook (scale 0.97 to 0.98, never below 0.95).
- **Async surfaces:** loading is a skeleton that mirrors the final layout (no
  layout shift on resolve, no spinner farms); empty is designed (one motif or
  illustration, one sentence, one action; never a bare "No data"); error is
  visually distinct from empty and carries a retry path; partial (some data
  arrived) renders what exists.
- **Data extremes:** zero, one, many, thousands (a deliberate pagination or
  virtualization decision); long strings truncate with a full-value
  affordance; large numbers group digits and stay tabular; missing optional
  fields collapse cleanly; stale data is marked when the data is live.
- **Forms:** inline validation on blur, an error summary reachable by
  keyboard, disabled-with-progress while submitting, a designed success
  state.
- **Responsive:** the project's real breakpoints, each looked at, not
  assumed. Tables get a deliberate small-screen strategy (priority columns,
  horizontal scroll, or stacked rows: chosen, not defaulted). Touch targets
  at 44px minimum.
- **Theming:** dark mode, when in scope, is a second token column, never a
  color inversion. Shadow logic is rethought for dark (edges and glows carry
  elevation where shadows cannot); both themes pass the contrast check.
- **Motion in UI:** hover, press, and reveal transitions use the sheet's
  motion tokens (playbook 3.1 and 3.2); `prefers-reduced-motion` collapses
  them to instant or opacity-only with an identical final layout.
- **Accessibility floor:** contrast verified (4.5:1 body, 3:1 large),
  focus visible on every interactive element, semantic landmarks and heading
  order, a label on every input, a complete keyboard path through every
  flow, async results announced (aria-live) where they matter.
- **Text headroom:** layouts survive labels 30% longer than the English
  strings (translation reality); dates and numbers use locale-aware
  formatting, not hardcoded patterns.

## 9. The finishing pass (static)

Playbook 3.6, adapted to still screens. Applied last, dialed low; the raw
and finished versions must differ side by side while no single effect is
nameable in isolation:

- The field is never flat accidental white; the layered shadow stack
  (playbook 2.3) is used everywhere with one light direction; hairline
  borders versus shadows is one decision per elevation level, not per
  component.
- One grade or tint unifying the whole surface; grain only where the register
  allows it (3 to 7% and animated if present at all); at most one specular or
  gradient accent per screen; ambient background life (a slow drift) only on
  marketing surfaces, never inside dense work screens.
- Optical corrections: icon and text baselines aligned by eye, the 1px
  nudges done, nested radii computed (inner radius = outer radius minus
  padding), no double edge where a border meets a shadow.
- Then the restraint rule: name every effect on the screen; if the list comes
  easily, remove the busiest one and look again.

## 10. The gate (screenshot-verified, never from memory)

Process, then checklist. Render every screen and its key states; screenshot
at 2x (use the project's screenshot tooling if it has one, otherwise a
headless browser; a screenshot script worth keeping gets a home under
`scripts/`); look at the images against the sheet and this list; fix;
re-shoot until every line is true:

1. The per-project sheet exists in `docs/`, and every rendered value traces
   to it; no literal colors, spacing, radii, or shadows in the components.
2. The playbook pass/fail contract (5.2) holds on every screen.
3. The amateur-tells sweep (playbook 5.1) is clean on every screen.
4. The signature element is present, consistent with its placement rule, and
   nameable.
5. Every state in the section 8 matrix exists and was triggered for real
   (loading, empty, error, disabled, focus), not assumed from code.
6. Screenshots show realistic data at realistic lengths and volumes.
7. Contrast measured in every theme in scope; focus visible; the keyboard
   path walked end to end.
8. Both themes shot when dark is in scope; every breakpoint shot; tables
   checked at the smallest one.
9. The logo-hidden test passes: a returning user would know whose screen
   this is.
10. The SKILL_GENERAL final check passes on all touched files (dashes,
    banned words, suppressions, logging prefixes), and the project's build
    or type check is green.

Then the files-affected report and the git handoff block, as always.
