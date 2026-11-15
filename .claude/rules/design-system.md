---
paths:
  - "panel/**"
---

# Design system (the AE MCP panel)

Source of truth: `panel/tokens.css`. Components use its variables only. If a value you need isn't there, add a token. Don't inline it. Layout and controls live in `panel/panel.css`.

## Personality

- **Quiet UI.** Black ink on soft white paper, or white ink on near-black in dark mode. Black, white and grey do the work.
- **Soft geometry.** Every button, chip and tag is a pill. Nothing sharp.
- **Flat.** No shadows, no boxed cards. Space separates things, and a rule only marks a section break.
- **One accent.** Lime `--color-accent` is for tiny markers only: the active status dot and `::selection`. Never use it for fills, buttons or text.
- **Big black type over big grey type.** The status headline is the signature: state in `--color-ink`, detail in `--color-ink-ghost`.

## Runtime

CEP in After Effects 2025 is **Chromium 99**. Don't use `color-mix()`, `:has()`, container queries or anything newer. Write tints per theme as `rgba()`. Panel JS is ES5, the same as `bridge-client.js`.

Fonts are bundled in `panel/fonts/` (SIL OFL 1.1, licences beside them). The panel works offline, so never link a web font.

## Colour

| Token | Use |
|---|---|
| `--color-paper-soft` | panel background |
| `--color-paper` | a raised surface, if one is ever needed |
| `--color-surface-sunken` | chips, code, `pre` |
| `--color-ink` | headline, outlines, solid buttons |
| `--color-ink-strong` | values, list items, emphasis |
| `--color-ink-muted` | body copy, keys, hints |
| `--color-ink-faint` | section labels, timestamps, meta |
| `--color-ink-ghost` | the grey headline line, the neutral dot |
| `--color-rule` | section rules (ink at 7%) |
| `--color-danger` | errors only: error text and the offline dot |

- `ink-faint` and `ink-ghost` are for labels, meta or display-size text. Anything the user must read uses `ink-muted` or darker.
- Status uses shape before colour: active is a lime dot, paused or idle is a hollow ring, offline is a danger dot. The words say the state too.
- **Theme:** `app.js → applyTheme()` sets `data-theme` on `<html>` from After Effects' interface brightness and follows it live. `:root[data-theme="dark"]` swaps neutrals only. A hard-coded colour is a dark-mode bug.

## Type

- **Plus Jakarta Sans** (`--font-body`) for text and the headline. **DM Sans** (`--font-ui`) for controls, labels and numbers. `--font-mono` for code.
- Sizes are fixed (`--text-h3` 24, `--text-body` 16, `--text-sm` 14, `--text-xs` 12). Default text is `--text-sm`.
- Numbers that update (counts, durations, timestamps) use `font-variant-numeric: tabular-nums` so they don't jitter.
- Labels are sentence case. No uppercase with letter-spacing.

## Space and layout

- 4px scale `--space-1 … --space-6`. Only use tokens.
- The panel edge is `--gutter`. Don't add padding per section.
- **Even padding.** Top equals bottom and left equals right, from one variable. The section rule sits midway in `--section-gap`.
- **Rules only where they mean something:** one `--border-rule` above each section. No rules between rows or list items.
- The panel must work from its minimum width (260px in `CSXS/manifest.xml`). Long values truncate with an ellipsis and a `title`.

## Controls

| Class | Look | Use |
|---|---|---|
| (none) | 1px ink outline, inverts on hover | every secondary action |
| `solid` | ink fill | the one primary action in view (Resume, Install bridge) |
| `block` | full width | a section's single action |
| `.tag` | sunken soft pill | non-interactive chips (pid) |

- Interactive things are `<button>` or `<a>`, never a clickable `<div>`.
- Disabled is `opacity: 0.4`, not hidden, so the layout doesn't jump.
- A visible `:focus-visible` ring (2px ink, `--radius-sm`) is global. Don't remove it.

## Motion

- CSS transitions only, from `--duration-*` and `--ease-*`. No raw durations or curves.
- Hover is `--duration-fast` / `--ease-standard`. Press scales to `--press-scale` over `--duration-instant` / `--ease-out`.
- Animate `transform`, `opacity` and colours only. No loops, pulses or blinking status dots.
- `prefers-reduced-motion` zeroes the durations and the press scale in `tokens.css`. Keep it that way.

## Writing

- Short, plain sentences. Say what happened and what to do next ("Bridge installed. Restart After Effects to load it.").
- Toasts end with a full stop. The headline has none.
