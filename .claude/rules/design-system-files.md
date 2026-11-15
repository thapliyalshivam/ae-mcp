---
paths:
  - "Designsystem/**"
---

# Writing a design system file for After Effects

A design system file tells Claude how a brand looks and moves in After Effects. One brand per file: `Designsystem/design-<name>.md` (lowercase, hyphens). Use `Designsystem/design-shivam.md` as the reference.

## Structure: always this order

```
# Design system: <Name>
<one line: the look in plain words>
**Rule zero: use a token from this file. If what you need isn't here, stop and ask. Never invent a value.**
---
## 1. Colour tokens       tables, then "### Colour rules"
## 2. Motion tokens       tables, then "### Motion rules"
## 3. Typography tokens   table, then "### Type rules"
## 4. Layout              short bullets
## 5. Hard rules          numbered, 5–8 of the most important rules again
```

- ❌ **NEVER reorder, rename or skip sections 1–5.** Tools find them by these headings. Mark an unused one "None."
- ❌ **NEVER drop rule zero.**
- ✅ **Tokens first, then the rules for those tokens**, inside each section.
- ✅ Add extra sections (logo, sound, transitions) **after 5**, as `## 6. …`.

## Tokens

- ✅ **Every token is a row in a table**, with a `kebab-case` name in backticks. Never put a value only in prose.
- ✅ **Every token has a "Use" column**, saying when to use it in 2–6 words.
- ❌ **NEVER have two tokens with the same value and the same use.** Merge them.
- ❌ **NEVER mention a token in a rule that isn't defined in a table.**

### Colour tables

Columns: `Token | Hex | AE | Use`.

- Hex is uppercase `#RRGGBB`.
- AE is `[r, g, b]` from 0 to 1: each channel ÷ 255, rounded to 3 decimals. Write `1` and `0`, not `1.000` and `0.000`.
- Group colours into: neutrals (the frame), accent, illustration or brand palette, scene backgrounds. Scene tables add a `Text on it` column.
- Give a dark version only if the brand has one.

### Motion tables

- **Durations:** `Token | Seconds | @<fps> fps | Use`. Say the fps above the table and give frames = seconds × fps, rounded.
- **Easing:** `Token | Bezier | First key, outgoing | Last key, incoming | Use`. Convert cubic-bezier `(x1, y1, x2, y2)` to Graph Editor values:
  - outgoing influence = x1 × 100%. Outgoing speed = (y1 ÷ x1) × avg speed, or 0 when y1 = 0.
  - incoming influence = (1 − x2) × 100%. Incoming speed = ((1 − y2) ÷ (1 − x2)) × avg speed, or 0 when y2 = 1.
  - Define avg speed = change ÷ duration once, above the table.
- **Stagger and travel:** ms with frames, and px for a named comp size.

### Typography table

Columns: `Token | Font | Weight | Size | Leading | Tracking | Use`.

- Sizes and leading are in px **for a named comp size** (default 1920×1080). Say "scale with the comp height".
- Leading is px, not a ratio: size × ratio, rounded.
- Tracking is AE units (1/1000 em): em × 1000, so −0.0225 em becomes −22.
- Weight is the font's style name as AE shows it (Regular, Medium, Bold, Light).
- Name the smallest allowed size in a rule.

## Writing rules

Rules exist to be impossible to miss.

- ✅ **One rule = one line**, a bold sentence starting with ❌ **NEVER** or ✅.
- ✅ **Imperative and concrete.** "NEVER set text smaller than 28 px at 1080p." Not "Keep text readable."
- ✅ **A number wherever there can be one** (px, %, seconds, frames, count per shot).
- ✅ **At most one short follow-up sentence**, after the bold part, giving the reason or the exception.
- ✅ **❌ rules first, then ✅ rules**, in each rules list.
- ❌ **NEVER write "try to", "consider", "where possible" or "ideally".** If it's optional, leave it out.
- ❌ **NEVER write more than 8 rules per section.** Merge or cut.
- ❌ **NEVER contradict a token.** If a rule needs a new value, add a token.

## Always cover these After Effects traps

Every file needs a rule for each:

- Default Easy Ease (33%): forbidden, or replaced by a named token
- Linear keyframes: when they are allowed
- Overshoot and bounce: who may use them and how much
- Minimum text size and minimum time on screen
- Safe margin in px for the named comp size
- What may have colour and what may not
- Effects (shadows, glows, gradients): allowed or not
- How many hero motions per shot

## Before you call a file done

1. Every hex has its AE value, and both agree (recompute them).
2. Every frame count = seconds × fps. Every leading = size × ratio.
3. Every token mentioned in a rule exists in a table.
4. Sections 1–5 are present, in order, with their exact headings.
5. No rule is longer than two lines.
6. Section 5 repeats the rules that would do the most damage if missed.
