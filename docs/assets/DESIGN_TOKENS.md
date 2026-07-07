# Diagram design tokens

The single source of truth for the SVGs in this folder (`flow.svg`, `icon.svg`,
`payment-schema.svg`). Warm editorial register: one committed paper field, one
material, one accent per meaning, restraint. Every value in the SVGs traces here.

## Palette (seven roles)

| Role | Hex | Use |
| --- | --- | --- |
| Field | `#f4f1e9` | the warm paper everything sits on |
| Card | `#fbfaf5` | the one surface material |
| Ink | `#1c1917` | primary text, JSON keys |
| Muted ink | `#57534e` | captions, secondary text |
| Faint ink | `#736e64` | eyebrows, punctuation, notes |
| Accent (this repo) | `#6b4fa6` | the gateway, the x402 protocol chips |
| Reserved: Nosana | `#25704f` | Nosana's existing infrastructure |
| Reserved: Solana | neutral `#efece3` on ink | settlement layer |
| String values (JSON) | `#9a5b13` | amber, for quoted values only |

One accent (violet) marks the one new thing, the gateway. Green is reserved for
Nosana's existing rails, used once per zone. Amber is reserved for JSON string
values so keys and values separate without a rainbow.

## Type

- Title: Georgia / Iowan Old Style serif, weight 600.
- Labels and captions: ui-sans-serif / system-ui.
- Code, fields, JSON, addresses: ui-monospace.
- Eyebrows: mono, uppercase, letter-spacing 2.4px, faint ink.
- Weight ceiling 600. Sentence case everywhere except eyebrows and chips.

## Depth and material

- One light direction (top). Cards use a layered shadow stack, not one flat blur:
  a wide ambient drop plus a tight contact shadow, tinted with ink, never pure
  black.
- Field carries a faint warm radial glow (top-left) and a soft vignette, both
  under conscious notice. No grain (it aliases when GitHub scales the SVG).

## Shape and space

- Radii: 16 for zones and cards, 7 for chips, 4 for legend swatches.
- Generous padding inside cards; the composition rests on a visible baseline grid
  even though the grid itself is not drawn.

## House style, one line

Warm, editorial, precise: a printed reference card, not a dashboard. If a frame
has two competing ideas, cut one.
