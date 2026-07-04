# The premium design and motion playbook (general)

A reusable method for building premium interfaces and animation, and for getting good
at it. It is project-agnostic: the principles, tokens, and checklists apply to any
product. Where a concrete example helps, one worked system (a light "glass over warm
paper" look) appears in a boxed EXAMPLE, never as the requirement.

Read part 1 to build the skill, parts 2 and 3 to build the work, part 4 to keep it
coherent, and part 5 to judge it. Then keep the project sheet at the end for each new
product.

The core diagnosis this playbook exists to fix: the "PowerPoint look" is not a lack of
effects. It is three missing layers. Flat (one plane, no depth stack), dry (no
atmosphere: no grain, no light, no soft shadow), and raw (no finishing pass). Premium
work stacks a slow ambient background, a hero object with real light, and a finishing
layer on top, then composes them with restraint. Every recipe below serves one of
those three layers.

---

## 1. How to get good at this (the method, not just the rules)

Premium is not more effects. It is restraint plus coherence plus finish. Three people
with the same component library ship wildly different quality because of taste and
discipline, not tools. Taste is learnable. Here is the method.

### 1.1 Build the eye (study on purpose, do not just scroll)

- Pick a small set of reference products and study them deliberately: Apple product
  pages, Stripe, Linear, Vercel, Family, Wealthsimple, and the craft writing of Rauno
  Freiberg and Emil Kowalski. Watch how little moves, and how precise the little that
  moves is.
- Do teardowns. Screen-record a page, step through it frame by frame, and write down:
  what entered, from where, how long it took, what easing, and what stayed still. You
  will find the same small numbers again and again (200 to 500ms, decelerate on enter,
  one thing moving at a time). That repetition is the craft.
- Steal the system, not the pixels. Do not copy a screen; extract its structure, the
  size of its palette, its type pairing, its spacing rhythm, its motion durations, and
  rebuild your own thing with an equally tight system.

### 1.2 A worked premium reference: Wealthsimple

One brand, dissected, so "premium" stays concrete. Wealthsimple's system (built with
studio BUCK and the in-house team under ECD Mike Giepert) rests on five moves that
transfer to any calm-trust brand:

1. **Warm, muted palette, never fintech blue.** Giepert (Skyword interview): financial
   brands default to electric blues and bad gradients; warmer tones and a subtle
   palette read more human. Transfer: warm off-whites, earth tones, one saturated
   accent. Ban electric blue fields and rainbow gradients.
2. **A 3D object system as visual metaphor.** Their 2022 app unification used an
   evolved 3D style where imaginative 3D illustrations translate complicated topics
   into relatable concepts: coins, cards, and abstract shapes in soft studio light.
   Transfer: one object vocabulary, rendered consistently, doing the explaining.
3. **One hero object travels the whole piece.** BUCK's Trade brand film starts from a
   zero and cycles through every sector as one continuous object journey. Transfer:
   the hero object IS the transition system; it enters, travels, transforms, and lands
   on the end card (see 3.35).
4. **Human-first, restrained cinematography.** The "Investing in Humans" campaign
   (Errol Morris) used four plain colored backgrounds and nothing else; the Super Bowl
   "Mad World" anthem (Martin De Thurah) is cinematic and calm. Transfer: one idea per
   shot, generous negative space, bold type.
5. **Restraint is the brand.** Playful but never cluttered. Transfer: if a frame has
   two competing ideas, cut one.

Caveat: Wealthsimple's exact hex values and typography are not published in a primary
source. Emulate the discipline (warm field, one accent, soft light, object metaphors),
never copy third-party palette captures as if they were spec.

### 1.3 Work system-first

- Define the system before you design a screen: palette, type, spacing and radii scale,
  one material, and motion tokens. Every screen then reads from that one source. A
  design is only as coherent as its token sheet.
- Compose from primitives. Build a small set of reusable surfaces and controls and reuse
  them; do not hand-roll a new card each time. Consistency is mostly reuse.

### 1.4 Restraint-first

- Start by removing. One accent color, one primary action per view, one hero moment, one
  thing moving at a time. If you can name every effect on the screen, remove one until
  you cannot.
- Give it space. Crowding kills the premium feel faster than any wrong color.
- The attention-science version of the same rule: a single unique element (one color,
  one motion, one size singleton) against a calm field is found by the eye in parallel,
  in under 200ms. Heterogeneity kills the effect: many competing pops read as busy and
  amateur. One preattentive pop per beat, calm field around it.

### 1.5 Finish, then critique

- Do a deliberate finishing pass last (part 3.6): grade, grain, light, depth. It is what
  separates expensive from clean-but-ordinary. Benchmark: the raw render and the
  finished render must look visibly different side by side; if they do not, the pass is
  too weak. If a viewer can name any single effect, it is too strong.
- Critique against a checklist (part 5), not against your mood. The best designers run
  the same failure-mode list every time. Taste plus a checklist beats taste alone.

### 1.6 The mindset

- The aesthetic is not in the tool's taste; it is in your system and your discipline.
- Ship the calm, coherent version over the busy, clever one. Confidence reads as
  restraint.

---

## 2. The design system (build this first)

A premium look is a small, strict system applied consistently. Nail these and it holds;
break them and it drifts into a generic dashboard.

### 2.1 The rules that hold any system together

1. **One accent.** Choose a single saturated color for everything interactive (links,
   the primary button, active and focus states). Nothing else uses it.
2. **Reserved punctuation.** Keep one or two colors as rare accents (a success stamp, a
   brand object), used once per screen, never as a generic status color.
3. **One field, committed.** Pick a base (a warm paper, a deep ink, a specific neutral)
   and commit. Never a flat accidental white, never an accidental dark. Pure white is
   only an opaque fallback under a material. For calm-trust registers, prefer a warm
   field over a cold one (the Wealthsimple move).
4. **A fixed type pairing.** One UI face, one precise face for numbers and code, with a
   weight ceiling (usually 600). No faux-bold, no random weights.
5. **Sentence case.** Titles and buttons are sentence case; uppercase only for tiny
   eyebrow labels and pills.
6. **One material.** Surfaces share one recipe (a glass, a card, a paper), so every panel
   reads as the same substance.
7. **Restraint.** A glance should show mostly neutral field, the material, and ink, with
   the accent as the only saturated color.

### 2.2 Tokenize everything

Lock a single token sheet and read every value from it. The categories:

- **Palette:** field or background, ink (primary text), muted ink, faint ink, one accent
  (plus a soft and a deep variant), one or two reserved accents, a destructive.
- **Type:** the two families, the size steps, the weight ceiling, eyebrow tracking, and
  tabular numbers for anything machine-precise.
- **Space and shape:** a radii scale (for example 8 / 11 / 14 / 18 from a 14 base), a
  spacing rhythm (a 4 or 8 base), consistent card padding, generous gaps.
- **Depth:** one shadow logic (one light direction, layered falloff, tinted rather than
  pure black) and one material recipe.
- **Motion:** the duration and easing tokens (part 3.2).

> **EXAMPLE (one worked material, not a requirement): a light "glass over warm paper"
> look.** The field is a warm cream radial; surfaces are translucent white glass built
> from five ingredients moving together (a white gradient about 0.82 to 0.56 alpha; a
> `backdrop-filter: blur(30px) saturate(1.85)`, where the saturate is what keeps it alive
> rather than dead grey; a 1px near-white top edge; a faint inner ring; a soft
> ink-tinted drop shadow). One blue accent; green reserved for a single verified stamp;
> oxblood reserved for one brand seal; a sans plus a mono face; weight 600 maximum. The
> glass only reads as glass over a busy backdrop (slow drifting blurred orbs plus a
> vignette), and is never stacked on itself. Swap the material and palette and the same
> discipline yields a completely different premium look.

### 2.3 Depth and material

- One light source for the whole product; every shadow agrees in direction, and softness
  tracks elevation (higher is softer and larger). Mixed light directions read unstable.
- One material recipe, reused. If it is translucent, it needs a busy backdrop to refract;
  a material over a flat field looks like plastic.
- Do not nest the same material on itself; it goes muddy.
- **The layered shadow stack (floating-card depth).** A single flat shadow reads as a
  blurry border. Stack three: ambient plus key plus contact, for example
  `0 24px 48px rgba(17,24,39,0.16), 0 12px 24px rgba(17,24,39,0.10), 0 2px 4px rgba(17,24,39,0.10)`.
  As elevation rises, increase offset and blur but DECREASE opacity (Josh W. Comeau's
  rule). Tint the shadow with a neutral dark from the palette, never pure black.

### 2.4 Layout

- A content max width, generous side padding, a grid, and one primary action per view
  (usually right-aligned or full-width at the bottom).
- Numbers right-aligned and monospaced; status in a consistent corner; a brand ornament
  used once, not sprinkled.

---

## 3. The animation system

Motion is where premium is most often won or lost. It is a system too.

### 3.1 The three laws (every animation obeys these)

1. **Animate transform and opacity only** (add `filter` and `clip-path` sparingly). These
   run on the GPU. Animating width, height, top, left, or margin is the most common
   amateur tell; it janks.
2. **Never ship a default easing.** `ease`, `ease-in-out`, and `linear` as-is read as
   unconsidered. Use custom curves or springs: decelerate on enter, accelerate on exit,
   in-out for on-screen moves, and linear only for continuous spin or a marquee. The
   flat crossfade with a default ease is the single loudest PowerPoint tell: replace
   every bare fade with fade plus a small transform (opacity 0 to 1 with y 8px to 0)
   on a real curve.
3. **Keep motion interruptible.** A premium motion can reverse or redirect mid-flight and
   keep its velocity (springs do this natively). Keyframes that restart from zero feel
   mechanical.

Plus: the UI duration ceiling is about 300ms (400ms only for large travel; 500ms starts
to feel slow); exits run about 20% faster than enters (enter 300ms pairs with exit
200ms); micro-interactions live at 150 to 250ms; complex orchestrations at 400 to
600ms; nothing decorative exceeds about 1s total; and reduced-motion is wired on every
animation.

### 3.2 The token sheet (durations and easings)

Pick one duration ladder and one easing family and use them everywhere; never a one-off
number.

Durations (a usable ladder): about 70 for micro states, 110 to 150 for small moves, 200
to 250 for standard transitions, 300 to 400 for large or hero moves, and beyond that only
a deliberate hero or a slow atmospheric layer.

A published alternative, if the project prefers a standard scale (Material 3, exact):
short 50 / 100 / 150 / 200ms, medium 250 / 300 / 350 / 400ms, long 450 / 500 / 550 /
600ms, extra-long 700ms and up. Either ladder works; pick one and stay on it.

Easings (one family; example curves):

- decelerate / enter: `cubic-bezier(0, 0, 0.2, 1)` or a quart-out
  `cubic-bezier(0.165, 0.84, 0.44, 1)`
- accelerate / exit: `cubic-bezier(0.4, 0, 1, 1)`
- standard / on-screen: `cubic-bezier(0.4, 0, 0.2, 1)`
- expressive reveal: `cubic-bezier(0.16, 1, 0.3, 1)` or emphasized
  `cubic-bezier(0.05, 0.7, 0.1, 1)`
- spring default: about duration 0.5s, bounce 0.1 to 0.3 (bounce 0 for anything that
  moves constantly)

The Material 3 family, if the project runs on it (exact): standard
`cubic-bezier(0.2, 0, 0, 1)`; emphasized-decelerate `cubic-bezier(0.05, 0.7, 0.1, 1)`;
emphasized-accelerate `cubic-bezier(0.3, 0, 0.8, 0.15)`; standard-decelerate
`cubic-bezier(0, 0, 0, 1)`; standard-accelerate `cubic-bezier(0.3, 0, 1, 1)`.

Spring parameters that read premium (Framer Motion / Motion One): press feedback at
stiffness 400, damping 25; a general token band of stiffness 300 to 520 with damping
28 to 36. Named bezier approximations of springs: bouncy
`cubic-bezier(0.34, 1.56, 0.64, 1)`, smooth `cubic-bezier(0.22, 1, 0.36, 1)`, snappy
`cubic-bezier(0.16, 1, 0.3, 1)`.

One stagger constant for every sequenced group: 30 to 80ms, with 30 to 60ms as the
premium band. At 100ms and up a reveal turns into a slideshow. One overshoot budget
(a few percent, one bounce), used only where a signature bounce belongs; press scale
lives at 0.97 to 0.98 and never below 0.95 (lower reads cartoonish).

### 3.3 The families (the vocabulary)

Know the full menu, then spend most of the budget on one moment.

1. **Entrance / reveal:** mask or clip reveal, blur-to-sharp, fade-rise (8 to 24px),
   stagger cascade, scale-in from 0.92 to 0.97 (never from 0), draw-on.
2. **Transition:** shared-element or FLIP, container transform, shared-axis, fade-through
   (incoming scale 0.92 to 1), crossfade, morph or matched cut.
3. **Scroll-driven:** scrub (with a small catch-up lag), pin or sticky, parallax (10 to
   30%), reveal-on-scroll, scroll-linked video.
4. **Text / kinetic:** per-line mask rise (the tasteful default), per-word or per-char
   split, variable-font weight or width transitions, RSVP, scramble, gradient-clip
   shimmer. For silent autoplay: one word, one animation, lots of whitespace, synced to
   the beat grid. Busy over-animated type is the anti-pattern.
5. **Micro-interaction:** hover lift (2 to 4px), spring press (scale 0.97), magnetic
   button, custom cursor, origin-aware tooltip. Do not animate high-frequency actions
   (the button clicked a hundred times a day should be instant).
6. **3D / depth:** layered parallax, tilt (6 to 12 degrees), WebGL, depth-of-field,
   camera dolly. Camera language, even faked in 2D layers, is what most separates
   cinematic from amateur: slow push-in for emphasis, orbit or arc around a hero
   object, rack focus (blur swap between layers) to move attention, pull-back for a
   reveal. One camera move per beat.
7. **Particle / ambient:** mesh or aurora gradient, noise field, dust motes, generative
   fields (near-subliminal, long cycles). Ambient gradient drift cycles run 8 to 20s
   (about 15s is the sweet spot; 2s reads frantic): animate background-position over an
   enlarged background-size (200 to 400%), and layer two or three gradients at
   different durations (for example 12s / 15s / 19s) so the drift feels organic.
8. **Data / number:** count-up (ease-out, 0.8 to 2s), odometer digit-roll, chart
   draw-on. One number animating at a time.
9. **Physics:** spring, inertia, drag, elastic, magnetic.
10. **Finishing / post:** grain, chromatic aberration, bloom, vignette, color grade,
    light sweep (full recipes in 3.6).

### 3.35 The hero object (mandatory for promo pieces)

The single strongest premium move, and the Wealthsimple signature: one 3D or
illustrated object (a coin, a card, a phone, an abstract shape) that enters in the
hook, travels and transforms through every beat, and lands resolved on the end card.

- The hero object IS the transition system: it carries the cut (a matched cut on its
  shape or position), so flat crossfades between disconnected scenes disappear.
- It gives the piece a spine (continuity), a climax (its final transformation), and
  the eye-catching element (its motion onset and looming scale-ups are the two
  strongest attention pulls).
- Render it with real light: one key light, soft studio shadows, a specular sweep at
  its held moment. In code, fake the 3D with layered parallax, tilt, and a shadow that
  tracks its elevation.
- Benchmark: if you cannot name the hero object of a promo piece, the piece is not
  ready.

### 3.4 Choreography (how they combine)

- One primary motion at any instant; everything else is subordinate (slower, dimmer, or
  delayed). Two things fighting for the eye reads cheap.
- Stagger groups by importance with the one stagger constant; nothing simultaneous.
- Follow-through (the Disney principle, applied): secondary elements trail the main
  transition by 100 to 200ms and settle late. Simultaneous motion reads mechanical;
  sequential reads organic.
- Build cause and effect, then rest. Deliberate stillness is what makes the next move
  land. Wall-to-wall motion is noise.

### 3.5 Numbers and data (a common tell)

- Tabular figures always, so digits do not jitter; right-align and reserve the width.
- Ease the value, not just the opacity: count up and decelerate into the final number.
- Use an odometer digit-roll (with a touch of motion blur) for a value changing to
  another value; a count-up for approaching a total from zero.
- To make one value beat another (a rival, a record), choreograph it: the incumbent
  flinches and dims, the challenger muscles in on a decelerate curve and briefly
  overlaps it, one accent flashes, and a thin connector or delta chip annotates the gap.

### 3.6 The finishing pass (apply last)

The optical top layer. Dialed low it reads expensive; slightly too much reads cheap. The
rule: if a viewer can name the effect, it is too strong. The counter-rule: raw versus
finished must differ visibly side by side, or the pass is too weak. Exact recipes, with
the threshold where each tips from premium to tacky:

- **Grade once:** one warm or brand tint over everything, about 4 to 8%, `soft-light`.
- **Vignette:** maximize feather, minimize darkness. A heavily feathered circular
  window, never a hard edge, never crushed to black. If you can point to where it
  starts, it is too strong.
- **Grain:** animated noise, never static. In UI and code work: 3 to 7% opacity, hopped
  in steps so it reads as film, not a dirty screen (a small tiling noise PNG translated
  frame to frame, or animated simplex noise in WebGL blended soft-light). In video
  post: a grain overlay at 20 to 40% layer opacity on Overlay or Soft Light reads
  subtle and filmic (50%+ is a stylized look, use only on explicit request), locked to
  24fps or posterized to 12fps ("on twos") for a filmic cadence. Static grain, or grain
  visible without an A/B check, is the fail.
- **Depth of field:** blur non-focal layers 4 to 12px; keep the focal layer sharp. A
  moderate virtual f-stop: the whole product stays sharp while the background
  separates. DoF so shallow it blurs part of the hero product is the fail. Rounder
  bokeh reads more premium than hexagonal.
- **Chromatic aberration:** 0.5 to 2px at the edges only in UI work; up to 5 to 10px
  offset concentrated at frame edges in heavy video grades. Never across the whole
  frame, never on faces or the product. Full-frame fringing reads as a broken monitor.
- **Bloom / glow:** soft light bleed from bright elements only. Reference defaults
  (Unreal): intensity 1.0, threshold 1.0; a premium starting point is intensity 0.8,
  threshold 1.0 (bloom is stacked descending-resolution Gaussian blurs). Keep the glow
  tight and the opacity low; whole-image brightening is the fail.
- **Motion blur on transitions:** a subtle `filter: blur(2px)` on the fast-moving
  element, removed on settle, keeps 150 to 400ms moves from strobing.
- **Ambient life:** the hero breathes (scale 1.02 to 1.04, 3 to 5s); a few dust motes
  drift; the background gradient drifts on its 8 to 20s cycle.
- **One specular sweep and one accent hit per scene,** at or under 1s, never two at
  once.
- Lock 60fps, wire reduced-motion, then remove the busiest effect. If performance drops
  below 60fps, remove blur and bloom passes first (they are the most expensive).

### 3.7 Attention (for any animated or promo piece)

The numbers below come from the research (abrupt-onset capture: Yantis and Jonides;
looming capture; preattentive processing: Treisman, Ware; peak-end: Kahneman and
Fredrickson, confirmed large in the 2022 meta-analysis; shot structure: Cutting's
Hollywood corpus; reading rates: Netflix timed-text standard and broadcast practice).
If the motion tells a story (an intro, a promo, an onboarding), steer the eye:

- Introduce a new focal change every 0.7 to 1.0s (faster in the first 3 seconds), but
  only one dominant change at a time; never leave more than about 1.5s of dead air. For
  longer narrative pieces, beat lengths of 2 to 4s match modern editing; vary them in a
  correlated, wave-like way (short-short-long), never metronomic equal cuts.
- Rank the levers: an abrupt onset (a new element appearing) and looming (scaling up
  toward the viewer) capture attention involuntarily within about 100 to 250ms and are
  the two strongest pulls; then a luminance flash; then a single color or size
  singleton. Preattentive features (hue, size, orientation, motion) are processed in
  under 200ms, but only one dimension of contrast per focal point. Spend abrupt onsets
  and looms only on the thing that matters; they fire whether the viewer wants them to
  or not.
- Meaning-bearing text needs its reading time on a near-empty frame: budget 12 to 15
  characters per second as the comfortable rate (about 300ms per word), with 20 CPS as
  the absolute ceiling (the Netflix technical cap). Practical holds: about 3s for one
  short line, about 6s for two. Read every card aloud at normal pace before it exits;
  if you cannot finish, extend it.
- Shape the whole thing by peak and end: a hard hook in the first 3 seconds, a single
  built-to climax at about 60 to 85% through, and a clean, still final beat held about
  1.2s (1.5 to 2s for social end cards). Memory keeps the peak and the end, not the
  length (duration neglect is real: the meta-analysis found the peak-end effect large,
  r = 0.581, and duration's effect essentially nil).

---

## 4. Coherence (the guardrail)

Premium is consistency. Every placement, direction, timing, and effect must agree. Run
these as MUST rules.

- **Tokens are law:** every duration and curve resolves to the token sheet; no ad-hoc
  value.
- **One spatial model:** one z-order; elements enter from and exit to motivated
  locations; offstage memory holds (what exits an edge returns from that edge); nothing
  teleports.
- **One direction per meaning:** forward and back, add and remove, deeper and shallower
  each map to one axis and never swap; every exit is the inverse of its entrance.
- **Timing asymmetry:** enters run a step longer than exits; duration scales with size
  the same way every time.
- **One physics:** one weight and one overshoot budget across the whole piece; no bouncy
  element next to a stiff one for equivalent actions.
- **One lead:** exactly one primary motion at a time; one stagger constant; deliberate
  rests.
- **One light:** one direction; all shadows agree and track elevation; no flat-versus-3D
  flip-flop.
- **One personality:** one easing feel, one texture, one glow, one grade; effects
  reinforce the motion, never contradict it.
- **One hero object** in narrative pieces; it owns the transitions and the climax.
- **On the grid:** everything aligns optically and rests on the grid; sizes and weights
  come from the scale.

---

## 5. The critique checklist (how to judge it)

### 5.1 The amateur tells (if you see one, fix it)

Animating layout properties; a default or linear easing on a move; a bare crossfade
with no transform; everything appearing at once; scale-from-0 or a 60px-plus fly-in;
two things competing for the eye; inconsistent or zero stagger, or a stagger of 100ms+
(a slideshow); a second accent color, or a reserved color used generically; title case
or a weight over the ceiling; a flat white or an accidental dark; a material with no
backdrop, or blur without saturate; text on a heavy blur; nested material; heavy grain
(over about 8% in UI, over about 40% overlay in video), static grain, visible
aberration (3px+ in UI, full-frame in video), or a vignette you can see; a single flat
shadow instead of a layered stack; bloom that brightens the whole frame; DoF blurring
the product; press scale below 0.95 or spring bounce above about 0.3 on professional
UI; wall-to-wall motion with no rest; motion with no communicative job. Dated looks to
refuse outright: heavy skeuomorphic bevels, sprayed lens flares, rainbow gradients,
VHS or glitch overlays (unless the brand is explicitly retro), simultaneous
non-staggered motion on every element.

### 5.2 The pass/fail contract (every line TRUE before you ship)

1. One accent; reserved colors used once per screen only.
2. One material; it has a backdrop to refract; never nested.
3. Type pairing fixed; weight at or under the ceiling; numbers tabular.
4. Every duration and curve is a token; enter decelerates, exit accelerates, one family.
5. Enter and exit are asymmetric and reversible; nothing teleports; offstage memory holds.
6. Exactly one primary motion at a time; one stagger constant (30 to 80ms); deliberate
   rests exist.
7. One light direction; shadows agree, layer in a stack, and track elevation; one
   personality, texture, and grade.
8. Everything aligns to the grid and rests on it; the layout is generous, not crowded.
9. Finishing dialed low (grain 3 to 7% in UI, aberration under 2px at edges, a vignette
   you cannot point to, bloom tight) yet visible in a raw-versus-finished A/B.
10. Narrative pieces have a nameable hero object, a hook by 3s, one peak, and a held
    end frame; text holds at 12 to 15 CPS.
11. Reduced-motion wired; 60fps held; every motion answers "what does this communicate?"

If a line is false, fix it before shipping. Taste plus this list is the whole craft.

---

## 6. Study list (go watch and read these)

- **Products:** Apple product pages, Stripe, Linear, Vercel, Family, Wealthsimple.
- **Films:** BUCK's Wealthsimple Trade brand film (hero object journey); Wealthsimple
  "Investing in Humans" (Errol Morris; four colored backdrops, nothing else);
  Wealthsimple "Mad World" Super Bowl anthem (Martin De Thurah; calm cinematic).
- **Writing:** Emil Kowalski (animations.dev, practical animation tips); Rauno Freiberg
  (invisible details of interaction design); Material Design motion (transitions, easing
  and duration tokens); Apple HIG motion; IBM Carbon motion; Disney's twelve principles;
  Josh W. Comeau and Tobias Ahlin on layered shadows.
- **Research:** Yantis and Jonides (abrupt-onset capture); looming and collision-course
  capture studies; Treisman and Colin Ware (preattentive processing); Kahneman and
  Fredrickson peak-end (with the 2022 Alaybek et al. meta-analysis); Cutting, DeLong,
  and Nothelfer 2010 (shot-length structure in 150 Hollywood films).
- **Method:** do frame-by-frame teardowns of the products above until the numbers become
  second nature.

---

## 7. The per-project sheet (fill this in for each product)

The playbook is the general method. To apply it, write a short sheet that fills in the
tokens and the one hero moment, then obey parts 4 and 5. The discipline transfers; only
the values change.

- Field and palette: base, ink, muted, faint, one accent (soft and deep), reserved
  accents, destructive.
- Material: the recipe (opaque card, glass, paper) and its backdrop.
- Type: UI face, precise face, size steps, weight ceiling.
- Space and shape: radii scale, spacing base, card padding, content width.
- Motion tokens: the duration ladder, the easing family, the stagger constant, the
  overshoot budget.
- The hero object (for promo work): the one object that travels the piece, and its
  material.
- The one hero moment: the single reveal or interaction that gets most of the budget.
- The one-line house style: how it should feel in a sentence.

Keep that sheet next to the code as the single source of truth, exactly as a strong
product design system does.

---

## Appendix A: the glass material recipe (copy-paste, parameterized)

A concrete, reusable glass. It reads as glass only when the five ingredients move
together over a busy backdrop; tune them apart and you get flat grey plastic. Swap the
two variables (the field and the shadow tint) for any brand.

```css
:root {
  /* choose per brand */
  --field: #f3f1ec;          /* the warm or neutral base the glass floats over */
  --ink-shadow: 40, 38, 52;  /* the shadow tint, rgb, never pure black */

  /* the glass recipe (works on any light field) */
  --glass-fill: linear-gradient(158deg, rgba(255,255,255,.82), rgba(255,255,255,.56));
  --glass-edge: rgba(255,255,255,.68);
  --glass-blur: blur(30px) saturate(1.85);
  --glass-shadow:
    inset 0 1px 0 rgba(255,255,255,.95),        /* bright top edge */
    inset 0 0 0 1px rgba(255,255,255,.22),      /* faint inner ring */
    0 1px 2px rgba(var(--ink-shadow), .05),     /* tight contact shadow */
    0 16px 38px rgba(var(--ink-shadow), .12);   /* soft wide drop */
}

.glass {
  background: var(--glass-fill);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-edge);
  box-shadow: var(--glass-shadow);
  border-radius: 14px;
}
```

The five ingredients, in the order of what breaks the illusion first if you drop it:

1. Translucent fill (a 158deg white gradient about 0.82 to 0.56 alpha), not a flat white.
2. Blur AND saturate. The saturate (about 1.85) is what makes it look alive rather than
   dead grey. Never blur without it. The commonly published band is
   `backdrop-filter: blur(10-12px)` (range 5 to 20px) with `saturate(180%)`, a
   `rgba(255,255,255,0.1-0.3)` fill, and a 1px `rgba(255,255,255,0.2-0.3)` border;
   this recipe simply pushes the blur higher because the fill is more opaque.
3. One bright top edge (a near-white 1px border plus the inset top highlight).
4. A faint inner ring (the second inset).
5. A soft, layered, ink-tinted drop shadow (a tight contact plus a wide soft one), never
   pure black.

Two non-negotiables around it: a busy backdrop behind the glass (a gradient field plus
slow blurred shapes) so there is something to refract, and never stack glass on glass (it
goes muddy). Never use `filter: blur` for glass (it blurs the content itself into a
blob); glass is always `backdrop-filter`. Keep the fill alpha in the 0.55 to 0.82 band:
higher and it turns opaque, lower and text fails. For a dark theme, invert it (a dark
translucent fill, a bright hairline, the backdrop supplies the glow); the
five-ingredient rule is unchanged.

## Appendix B: building a restrained palette (the method)

You need only seven roles. Fill them and stop.

1. **Field:** the base everything sits on (a warm paper, a cool grey, a deep ink). Commit.
2. **Ink:** primary text.
3. **Muted ink:** secondary text.
4. **Faint ink:** eyebrow labels, empty states, disabled.
5. **One accent:** the single interactive color, plus a soft variant (about 9% over
   white) and a deep variant (mixed with black).
6. **One or two reserved accents:** a success or a brand color, each used once per screen.
7. **Destructive:** errors and dangerous actions.

Rules: the accent is the only saturated color at rest; reserved accents are punctuation,
never a generic status color; the field is never a flat accidental white; and if you
reach for an eighth color, stop. For calm-trust registers, bias the field warm and skip
electric blue entirely (the Wealthsimple lesson).

A worked neutral example (swap the accent and field to reskin the whole product): field
`#f5f5f4`, ink `#1c1c1e`, muted `#6b6b70`, faint `#a6a6ab`, accent `#2b5fd9` (soft
`#eef2fd`, deep `#14315f`), reserved `#1f8a5b`, destructive `#b8472f`. Nine values, and
the product is skinned.

## Appendix C: the code-rendered animation kit (scroll and springs)

The implementation conventions for browser-rendered pieces, so the same choreography
ships at 60fps.

- **GSAP ScrollTrigger:** `scrub: true` for exact scroll sync, `scrub: 1` for a smooth
  one-second catch-up lag; `pin: true` for hero sections whose internal timeline plays
  in place; parallax via per-layer speeds (for example 0.8 / 1.2 / 2.0) or a yPercent
  tween with `ease: "none"` (scrub already supplies the easing); `gsap.matchMedia()`
  for responsive variants; kill triggers on cleanup; markers in dev only.
- **Performance floor:** transform and opacity only; one `will-change` per animated
  layer, applied sparingly; blur and bloom are the most expensive passes and are the
  first cut when 60fps slips.
- **Springs:** interruptible by construction; use the stiffness and damping bands from
  3.2 and keep bounce at 0 for anything that moves constantly.
- **Reduced motion:** every scroll choreography and ambient layer collapses to clean
  crossfades with an identical final composition under `prefers-reduced-motion`.
