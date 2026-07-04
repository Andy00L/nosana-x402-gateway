# SKILL_ANIMATION.md: creating premium animation (any project)

This is the general for animation creation. It is the process a session follows every
time the task is to create an animation: a product film, a promo, a hero reveal, UI
motion, a demo piece, an ambient background. It is project-agnostic on purpose. The
look always comes from the current project's design system and from fresh research,
never from the last project's effects and never from the model's default taste.

Companion document: `docs/DESIGN_AND_MOTION_PLAYBOOK.md` holds the standards (the
token-first design system, the ten motion families with parameters, the hero object
technique, the finishing pass recipes, the coherence guardrail, the critique
checklist). This file holds the workflow: how to frame the ask, how to research the
craft, how to write the spec, how to prototype, and how to judge the result. When both
are present, read both. When the playbook is missing from a project, copy it in before
starting.

The quality bar, in one line: a piece that could sit next to Wealthsimple, Apple,
Stripe, or Linear work without embarrassment. Calm confidence, one hero object, one
held moment, several visual-effect layers composed with restraint, every value a
token, nothing arbitrary.

The diagnosis behind the bar: the "PowerPoint look" is flat (one plane), dry (no
atmosphere), and raw (no finishing). Every piece this workflow produces stacks three
layers instead: a slow ambient background, a lit hero object or subject in the middle,
and a finishing pass on top.

---

## 1. The workflow at a glance

1. **Frame** the ask: what kind of piece, how long, where it plays, its one emotional job.
2. **Ground** in the project's truth: its real tokens, screenshots, and hero moment.
3. **Research** the craft for this specific piece: parallel deep-research runs that
   return terms, numbers, and named references. Never skipped.
4. **Spec**: write one long, complete specification (no length limit) with beats,
   tokens, the hero object, choreography, finishing, and a binding coherence guardrail.
5. **Prototype**: render real reference frames with the real tokens; look at them.
6. **Gate**: run the pass/fail contract; fix and re-render until every line is true.

The failure mode this workflow prevents: a first-idea animation, assembled from memory,
with default easings, one fade for everything, no depth, no atmosphere, and a look
borrowed from whatever the model built last. Premium is a process output, not a first
draft.

---

## 2. Frame the ask

Answer these before anything else. One line each.

- **Type:** product film, launch promo, hero reveal, UI motion set, onboarding, demo
  video insert, loading or ambient piece.
- **Length and medium:** seconds, aspect, where it renders (a generation tool such as
  Claude Design, hand-written CSS or JS, a video editor), autoplay or scroll-driven,
  with or without sound and voice-over. Platform conventions when they apply: Reels 15
  to 30s, TikTok up to 60s but shorter usually wins, YouTube Shorts 15 to 60s, bumper
  ads 6s, skippable ads 15 to 30s, landing-page autoplay hero a short silent loop.
- **Sound assumption:** design silent-first. Most feeds autoplay muted, so the piece
  must land with captions or kinetic type alone; sound, when present, syncs the peak to
  the music.
- **The one emotional job:** the single sentence the viewer should feel. Every premium
  piece is designed around one arc and one climax, not a list of features.
- **The hero object:** the one 3D or illustrated object (a coin, a card, a phone, an
  abstract shape, the product itself) that enters in the hook, travels and transforms
  through every beat, and lands on the end card. It IS the transition system and
  usually the climax. If no hero object can be named for a narrative piece, the
  framing is not done.
- **The one held moment:** which single reveal or interaction gets most of the motion
  budget. Everything else is quieter so this lands.
- **The register:** the emotional category the piece lives in (section 8), which picks
  the two or three reference brands to study. Do not default to the previous project's
  register.

If the human's ask is ambiguous on type, length, or the one moment, ask before
building. Everything else in this file can proceed without another question.

## 3. Ground in the project's truth

The look is not invented; it is extracted.

- Read the project's design system and token source in full: the design doc, the CSS
  or theme file where tokens live, the component primitives, and the real screenshots.
- Extract the exact token sheet: palette (field, ink scale, the one accent, reserved
  accents), type pairing and weight ceiling, radii and spacing, the material recipe,
  and any existing motion tokens (durations, easings) already validated in the product.
- Identify the product's own arc and motifs: what the interface already celebrates
  (a reveal, a confirmation, a stamp, a chart) becomes the film's climax. The best
  promo motion is the product's own hero moment, enlarged.
- Choose or design the hero object from the product's world: its card, its coin, its
  chart, its device. An imported object with no product meaning reads as decoration.
- If the project has no design system yet, stop and fill the per-project sheet at the
  end of `docs/DESIGN_AND_MOTION_PLAYBOOK.md` first: field, palette, material, type,
  space, motion tokens, the hero object, the hero moment, the one-line house style.
  Then continue.
- Collect the attachable assets now: two or three real screenshots, fonts, logo and
  glyphs, any brand doc. A generation tool matches attachments far better than prose.

Hard rule: never approximate brand values from memory and never reuse another
project's palette, material, or signature moves because they are at hand. Extract or
define, then build.

## 4. The research sweep (mandatory)

Vocabulary ages and the premium bar moves. Every animation project runs its own
research sweep before the spec is written. The goal is to learn the current terms,
techniques, and numbers for this specific piece, and to study the chosen reference
brands until their sensibility is concrete enough to execute.

Run three to six deep-research tasks in parallel, chosen from this menu:

- **A. Attention science:** how often a focal change must land, which levers pull the
  eye (abrupt onset, looming scale, luminance, a singleton), reading-time budgets for
  on-screen text, and peak-end shaping for the arc. The established baseline (verify,
  do not re-derive): abrupt onsets and looming motion capture attention involuntarily
  within about 100 to 250ms and are the two strongest levers; preattentive features
  (hue, size, orientation, motion) process in under 200ms but only one contrast
  dimension per focal point; a new focal onset about every 0.7 to 1.0 second in dense
  passages, beats of 2 to 4s in narrative passages, varied wave-like rather than
  metronomic; text at 12 to 15 characters per second (about 300ms per word, 20 CPS
  absolute ceiling); a climax at about 60 to 85 percent of runtime; a still end held
  about 1.2s (1.5 to 2s on social); peak and end dominate memory, duration barely
  counts.
- **B. Premium motion craft:** current easing practice (named cubic-bezier curves and
  spring parameters), duration bands, choreography (stagger values, overlapping
  action, follow-through), and the current list of amateur tells.
- **C. Brand sensibility studies:** for each of the two or three reference brands
  chosen in section 2, study their signature moves, pacing, kinetic type, color and
  light, how they show product UI in motion, and their emotional arc. Return a
  distilled "emulate this" list of concrete moves, not adjectives.
- **D. Narrative structure for the target length:** beat counts, seconds per beat,
  accelerando into a held reveal, text budgets per card, the outro hold. Expect a
  timestamped beat-sheet template. The baseline skeleton for short promos: hook in the
  first 0 to 3 seconds (most drop-off is at the 3s mark; lead with the payoff, a bold
  visual, or an immediate change on screen), promise or value by 3 to 5s, the middle
  carries one idea built through the hero object, climax at 60 to 85%, CTA and end
  card last, held. For 30 to 60s pieces, roughly 1 to 5 real transitions with at least
  one inside the hook.
- **E. The specialty of this piece:** whatever the piece is actually about. Numbers
  and counters for fintech, device and 3D motion for hardware, kinetic type for
  editorial, charts for data products, particles and fields for ambient work. Get
  exact recipes with durations and curves.
- **F. The finishing layer:** current parameter ranges for grain, glow and bloom,
  depth of field, chromatic aberration, light sweeps, vignettes, color grading, and
  the discipline that keeps them below conscious notice. The playbook (part 3.6)
  carries the standing recipes; research refreshes them for the specific medium.
- **G. Motion-system coherence:** when building a new motion language from scratch,
  study the published systems (Material, Carbon, Apple HIG, Fluent, Disney's
  principles) for the rules that keep a piece consistent.

What each research task must return: named terms, exact parameters (milliseconds,
cubic-bezier values, pixel and percent ranges), named real examples to go watch, and
explicit anti-patterns. Numbers, not vibes. If a result comes back as adjectives,
rerun it with a demand for parameters.

A reusable prompt skeleton for the brand study (adapt per brand and register):

> Research the promotional animation and design language of BRAND so I can emulate its
> sensibility for a LENGTH PIECE-TYPE in REGISTER. Report concretely: signature motion
> moves and scene transitions; pacing and rhythm (how often the focal element changes);
> typography in motion; color and light; how real product UI is shown moving; the
> emotional arc. Then return a distilled emulate-this list of 8 to 12 concrete moves
> that transfer, and named campaigns or pages to go watch. Concrete and specific.

And for the specialty study:

> Research how the best PRODUCT-CATEGORY work animates SPECIALTY so the figures or
> objects feel premium and intentional. For each technique give the exact duration,
> easing as cubic-bezier, amplitudes, and why it reads premium. Ground in real, named
> examples. End with two or three ready-to-implement recipes.

## 5. Write the spec

One document, as long as it needs to be. Generation tools and future sessions execute
long specs better than short ones; there is no length limit. The spec contains, in
order:

1. **Purpose and emotional job**, in two sentences, plus the one held moment.
2. **The visual system**, extracted from the project: palette with hex values, type,
   material recipe, backdrop, and the color usage map with its reserved-accent rules.
3. **The hero object:** what it is, its material and light, where it enters, every
   transformation it performs, which cuts it carries as matched cuts, and how it lands
   on the end card.
4. **Attention rules:** the cadence (a new focal onset every 0.7 to 1.0 second in
   dense passages, 2 to 4s beats in narrative ones, varied not metronomic; one
   dominant change at a time), text dwell times (12 to 15 CPS, 20 ceiling), dead-air
   ceiling (about 1.5s), and the peak-end shape of the whole piece.
5. **Motion tokens:** the duration ladder and named easing curves for this piece, one
   stagger constant (30 to 80ms), one overshoot budget, and which single move is
   allowed to exceed the standard ceiling as the documented hero.
6. **The vocabulary shortlist:** from the ten families in the playbook, the USE list
   tuned to this register and an explicit AVOID list of off-brand effects. A premium
   piece composes several families (entrances, one transition grammar, a type
   treatment, an ambient layer, the specialty, the finishing pass), never one trick.
7. **Story structure:** the beats with timestamps, an intensity curve, the accelerando,
   the hook inside the first 3 seconds, and where the held reveal sits (60 to 85%).
8. **A shot-by-shot storyboard:** for every beat, its purpose, exact on-screen text
   with its reading hold, the motion with lever, easing, and duration, the camera move
   (one per beat: push-in, orbit, rack focus, pull-back, or static), and one named
   premium detail so the finish is spread across the whole piece.
9. **Specialty choreography** in full detail (for example, number choreography:
   tabular figures, count-ups that ease the value, odometer rolls, undercut and reveal
   recipes).
10. **The finishing pass**, as an ordered list applied last, dialed low, with the
    exact parameters from the playbook (3.6) and the raw-versus-finished A/B check.
11. **The coherence guardrail and a pass/fail consistency contract**, stated as
    binding: one spatial model, one direction per meaning, timing asymmetry, one
    physics, one lead at a time, one light source, one hero object, one personality,
    everything on the token sheet. The renderer is told to verify the contract before
    output.
12. **Assets to attach:** the screenshots, fonts, glyphs, and any rendered reference
    frames, each with one line on what it proves.

## 5.5 Prompting a generation tool (Claude Design and comparable)

When the medium is an AI video or motion generation tool, the spec from section 5
compiles into per-shot prompts. The craft:

- **Prompt as a shot list, not a synopsis.** One prompt per shot. Each shot prompt
  names, explicitly: the subject, the single action, the setting, the single camera
  move, the duration, the aspect ratio, the lighting (key, fill, rim), the palette
  anchors (the project's hex values and material words), and the continuity rule
  (what carries over from the previous shot, usually the hero object's position and
  state).
- **One camera move plus one subject action per shot.** Stacked moves confuse the
  model and read as chaos. If a beat needs two moves, it is two shots.
- **Keep generated shots short, 4 to 5 seconds, and stitch in edit.** Models follow
  instructions more reliably in short clips; long single generations drift.
- **Lock style early.** Use image references (a rendered reference frame from section
  6, a product screenshot, the brand palette card) to pin character, product, and
  palette in the first shot, then reuse the same references on every shot.
- **Iterate with single-variable changes.** "Same shot, switch to a slow push-in" or
  "same shot, warmer key light", never three changes at once, or the cause of an
  improvement is unknowable.
- **Generate 3 to 5 variants per shot** and pick, rather than regenerating one prompt
  hoping.
- **Exclude legible on-screen text from generation.** Generated type is unreliable;
  add text, captions, and UI overlays in post where the type tokens are exact.
- **Plan the finishing pass in post,** not in the prompt: grain, grade, vignette, and
  blur are applied after generation with the playbook parameters, so the whole piece
  shares one finish regardless of shot-to-shot generation variance.
- Specificity trades control for variation: detailed per-shot prompts give brand
  consistency (the default for this work); a looser prompt is only for exploring
  before the spec exists.

A per-shot prompt skeleton:

> Shot N of TOTAL, DURATION seconds, ASPECT. Subject: HERO-OBJECT in STATE. Action:
> the one thing it does. Camera: the one move. Setting: FIELD-DESCRIPTION with
> MATERIAL words. Lighting: soft key from DIRECTION, gentle rim, no harsh contrast.
> Palette: HEX values, warm and muted, one ACCENT accent. Continuity: carries over
> from shot N-1 STATE. Style reference: attached frame. No on-screen text.

## 6. Prototype and verify

Never hand off a spec sight unseen when a frame can be rendered.

- Build one to three reference frames of the most important beats in plain HTML using
  the project's exact tokens (the real field, material, type, and accent), including
  the finishing layers (grade, grain, vignette, depth of field).
- Screenshot them at 2x with a headless browser and look at the images. Check them
  against the design system and the contract, not against memory. Fix what reads
  wrong (an over-blurred focal element, a competing accent, a dead corner) and
  re-shoot until the frame is right.
- Run the raw-versus-finished A/B on one frame: the finishing pass must be visible in
  the comparison and invisible in isolation.
- Show the human the frames, not descriptions of frames.
- Attach the validated frames to the spec as ground truth for the renderer, and as the
  style reference images for every generation-tool shot.
- When the piece is implemented in code rather than generated: transform and opacity
  only, one will-change per animated layer, 60fps verified (blur and bloom are the
  first cut if it slips), the GSAP or spring conventions from the playbook's Appendix
  C, and the reduced-motion fallback wired.

## 7. The critique gate

Before calling any animation done, every line must be true:

1. Every duration and curve resolves to the spec's token sheet; nothing ad-hoc.
2. Enters decelerate, exits accelerate and run shorter; on-screen moves use the
   standard curve; linear appears only on continuous spin or a marquee; no bare
   crossfade anywhere (every fade carries a small transform).
3. Exactly one primary motion at any instant, one stagger constant (30 to 80ms, never
   100ms+), and deliberate rests; the piece is not wall-to-wall motion.
4. One physics: one weight, one overshoot budget, spent only where the spec says;
   press scale never below 0.95.
5. One light source; shadows agree, stack in layers, and track elevation; one texture,
   one grade, one personality across the whole piece.
6. Direction is semantic and reversible; nothing teleports; offstage memory holds.
7. The palette holds: one accent, reserved colors used only in their reserved places,
   no electric-blue default field in a calm-trust register.
8. Type holds: the pairing, the weight ceiling, tabular figures on every number.
9. Meaning text gets its reading time (12 to 15 CPS, 20 ceiling) on a near-empty
   frame; every card can be read aloud before it exits.
10. The finishing layer sits below conscious notice (grain 3 to 7% in UI work,
    aberration under about 2px at edges, a vignette you cannot point to, bloom tight)
    yet the raw-versus-finished A/B shows a visible difference.
11. Narrative pieces have a nameable hero object that carries the transitions; the
    hook lands inside 3 seconds; there is one climax at 60 to 85%, built to, held, and
    resolved; the end frame is the cleanest frame and holds about 1.2s (1.5 to 2s on
    social).
12. Silent-first holds: the piece communicates fully with the sound off.
13. Reduced motion degrades to clean crossfades with an identical final composition.

Then the last rule: name every effect on screen; if you can list them all without
pausing, remove the busiest one and look again.

## 8. Reference brands by register

Pick the register first, then study two or three of its brands in the research sweep.
Steal systems and discipline, never pixels.

- **Calm trust (fintech, savings, insurance, health):** Wealthsimple (one hero object
  travels the whole piece; BUCK-built 3D object metaphors in soft studio light; warm
  muted palette, never electric blue; editorial type; calm pacing; restraint as the
  brand), Apple (one reverent held reveal; restraint; light as the hero), Stripe
  (precision; gradient fields; numbers treated beautifully).
- **Precision tools (developer, pro, infra):** Linear (crisp micro-motion; dark
  precision; nothing decorative), Vercel (typographic confidence; grid discipline),
  Stripe again for data.
- **Consumer warmth (social, family, lifestyle):** Family (fluid, interruptible,
  spring-driven), Airbnb (soft, photographic, human), high-end mobile apps with
  physical gesture feel.
- **Luxury and editorial (fashion, print-like, cultural):** Apple brand films, Aesop
  (stillness, typography, almost no motion), premium fashion houses (large serif
  type, slow dissolves, film grain).
- **Energy and play (gaming, sports, youth):** kinetic type-heavy work, faster
  cadence, harder cuts; the same coherence rules apply, only the tokens change.

The register decides pacing, palette temperature, type personality, and how much
motion is appropriate. The workflow and the gate never change.

## 9. Working glossary

The language of the craft, so asks and specs are precise. One line each.

- **Beat:** one story unit of a piece, a few seconds carrying one idea.
- **Hook:** the first 0 to 3 seconds; the payoff-first open that stops the scroll.
- **Accelerando:** beats getting shorter and cuts more frequent to build tension.
- **Held reveal:** the climax where motion stops and one element resolves; the payoff.
- **End card:** the final still (logo, CTA); held 1.2s minimum, 1.5 to 2s on social.
- **Hero object:** the one object that travels, transforms, and carries the cuts.
- **Motion onset:** the start of movement or appearance; the strongest attention pull.
- **Looming:** scaling up toward the viewer; the second-strongest pull.
- **Singleton:** the one element that differs on one dimension (color, size, motion);
  the eye locks to it.
- **Peak-end:** memory keeps the most intense moment and the final moment, not length.
- **Dwell time:** how long text or a figure must hold to be read (about 300ms a word,
  12 to 15 characters per second).
- **CPS:** characters per second, the reading-rate unit for on-screen text.
- **Fade-rise:** opacity plus a small upward translate; the workhorse entrance.
- **Blur-to-sharp:** entering from a blur to focus; reads as coming into focus.
- **Mask (clip) reveal:** content unveiled behind a moving mask instead of fading.
- **Draw-on:** a stroke or underline drawing itself in.
- **Stagger:** a fixed small delay between siblings so a group reads as choreography.
- **Shared element (FLIP):** one element morphs continuously into its counterpart
  across a state change.
- **Container transform:** a card expands into the surface it opens.
- **Shared axis:** paired slide-plus-fade along one axis for related states.
- **Fade-through:** outgoing fades, incoming fades in while scaling from about 0.92.
- **Matched cut:** composing two shots so a shape or position carries across the cut;
  the hero object's native transition.
- **Push-in (dolly):** the camera easing toward the subject; emphasis and intimacy.
- **Orbit (arc):** the camera circling a hero object; the premium product-shot move.
- **Rack focus:** focus swapping between depth layers to move attention.
- **Pull-back:** the camera retreating to reveal context; the reveal move.
- **Scrub:** an animation timeline driven by scroll position.
- **Pin (sticky):** an element holds in place while its internal timeline plays.
- **Parallax:** layers moving at different rates to imply depth.
- **Kinetic type:** typography that itself performs (line, word, or character level).
- **RSVP:** words shown one at a time in the same position.
- **Scramble (decode):** glyphs resolve from randomness to the real string.
- **Count-up:** a number easing through values to its target.
- **Odometer roll:** digits rolling on vertical strips to a new value.
- **Tabular figures:** equal-width digits so numbers never jitter.
- **Easing:** the acceleration profile of a move (decelerate in, accelerate out).
- **Spring:** motion from stiffness, damping, and mass instead of a fixed duration.
- **Bounce (overshoot):** passing the target and settling back; a budgeted accent.
- **Interruptible:** a motion that can reverse mid-flight keeping its velocity.
- **Anticipation:** a small counter-move before the main move.
- **Follow-through:** parts trailing the parent by 100 to 200ms and settling late.
- **Secondary action:** a subordinate motion supporting the primary one.
- **Specular sweep:** a light band crossing a surface once.
- **Bloom (glow):** soft light bleed from a bright element.
- **Vignette:** darkened edges holding the eye at center; maximum feather, minimum
  darkness.
- **Grain:** animated noise unifying layers; premium at single-digit opacity in UI,
  20 to 40% overlay in video post, always animated.
- **On twos:** grain or animation stepped at 12fps for a filmic cadence.
- **Chromatic aberration:** slight RGB edge split; filmic under 2px, broken above.
- **Depth of field:** blur on non-focal planes to force focus.
- **Mesh gradient:** slow multi-stop gradient blobs drifting as a field (8 to 20s
  cycles).
- **Dust motes:** sparse drifting particles adding ambient life.
- **Color grade:** one tint unifying the whole frame.
- **Shot list:** the per-shot prompt sequence a generation tool executes (one move,
  one action, 4 to 5s per shot).
- **Reduced motion:** the accessibility fallback where animation collapses to fades.

## 10. The floor (never changes, any register)

- Transform and opacity only; no layout-property animation; 60fps.
- No default or linear easing on spatial moves; decelerate in, accelerate out; no bare
  crossfades.
- One accent; reserved colors stay reserved; the field is committed, never accidental.
- One material, one light, one personality, one physics, one lead at a time.
- One hero object per narrative piece; if it cannot be named, the piece is not ready.
- Text at reading speed: 12 to 15 CPS, 20 absolute ceiling, on a near-empty frame.
- Restraint: one preattentive pop per beat; if every effect can be named at a glance,
  remove one.
- Silent-first on anything that autoplays.
- Reduced-motion always wired; the final composition identical.
- The full standards, families, parameters, and recipes live in
  `docs/DESIGN_AND_MOTION_PLAYBOOK.md`; this file is the process that applies them.
