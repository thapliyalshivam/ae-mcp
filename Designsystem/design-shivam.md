# Design system: Shivam

For After Effects comps. Black ink on soft white paper. The illustrations carry the colour, and the frame stays quiet.

**Rule zero: use a token from this file. If what you need isn't here, stop and ask. Never invent a value.**

---

## 1. Colour tokens

AE colours are `[r, g, b]` from 0 to 1. Use the AE column as written.

### Neutrals: the frame

| Token | Hex | AE | Use |
|---|---|---|---|
| `paper` | `#FFFFFF` | `[1, 1, 1]` | raised cards |
| `paper-soft` | `#F9F9F9` | `[0.976, 0.976, 0.976]` | **default background** |
| `surface-sunken` | `#F3F3F3` | `[0.953, 0.953, 0.953]` | chips, placeholders |
| `line` | `#E8E8E8` | `[0.910, 0.910, 0.910]` | hairlines |
| `ink` | `#000000` | `[0, 0, 0]` | headlines, outlines, solid shapes |
| `ink-strong` | `#232323` | `[0.137, 0.137, 0.137]` | emphasised text |
| `ink-muted` | `#505050` | `[0.314, 0.314, 0.314]` | body text |
| `ink-faint` | `#969696` | `[0.588, 0.588, 0.588]` | labels, captions |
| `ink-ghost` | `#C1C1C1` | `[0.757, 0.757, 0.757]` | big grey line under a headline |

Dark version: background `#101010` `[0.063, 0.063, 0.063]`, ink `#FFFFFF`, ghost `#5A5A5A` `[0.353, 0.353, 0.353]`.

### Accent: one only

| Token | Hex | AE | Use |
|---|---|---|---|
| `accent` | `#D4FF2B` | `[0.831, 1, 0.169]` | dots, underlines, tiny markers |

### Illustration palette: artwork only

| Token | Hex | AE |
|---|---|---|
| `illo-magenta` | `#E51F6F` | `[0.898, 0.122, 0.435]` |
| `illo-pink` | `#F482A5` | `[0.957, 0.510, 0.647]` |
| `illo-hot-pink` | `#FD46A4` | `[0.992, 0.275, 0.643]` |
| `illo-orange` | `#F7592E` | `[0.969, 0.349, 0.180]` |
| `illo-green` | `#8DE02D` | `[0.553, 0.878, 0.176]` |
| `illo-mint` | `#7DF4BE` | `[0.490, 0.957, 0.745]` |
| `illo-forest` | `#074935` | `[0.027, 0.286, 0.208]` |
| `illo-wine` | `#7F0034` | `[0.498, 0, 0.204]` |
| `illo-plum` | `#821450` | `[0.510, 0.078, 0.314]` |

### Scene backgrounds: full-frame colour

| Token | Hex | AE | Text on it |
|---|---|---|---|
| `scene-party` | `#FF90C3` | `[1, 0.565, 0.765]` | white |
| `scene-sun` | `#FFF140` | `[1, 0.945, 0.251]` | black |
| `scene-shelf` | `#22572A` | `[0.133, 0.341, 0.165]` | white |
| `scene-night` | `#000000` | `[0, 0, 0]` | white |

### Colour rules

- ❌ **NEVER use a colour that isn't in these tables.**
- ❌ **NEVER put lime on text or large fills.** It's for markers smaller than a word.
- ❌ **NEVER use illustration colours for text or UI.** They're for artwork only.
- ✅ **One scene colour per shot.** Text on it uses the ink in the table.
- ✅ **Grey, black and white do the work.** Colour comes from the illustration.

---

## 2. Motion tokens

Frames are given at 30 fps. At other rates, frames = seconds × fps.

### Durations

| Token | Seconds | @30 fps | Use |
|---|---|---|---|
| `instant` | 0.1 | 3f | a press, a flash |
| `fast` | 0.2 | 6f | small UI, exits |
| `base` | 0.4 | 12f | **default entrance** |
| `slow` | 0.7 | 21f | section and scene reveals |
| `slower` | 1.0 | 30f | hero moments, masks |
| `ambient` | 6.0+ | 180f+ | idle loops |

### Easing

Set these in the Graph Editor (speed graph). Avg speed = change ÷ duration.

| Token | Bezier | First key, outgoing | Last key, incoming | Use |
|---|---|---|---|---|
| `ease-out` | `0.16, 1, 0.3, 1` | influence 16%, speed 6.25 × avg | influence 70%, speed 0 | **entrances** |
| `ease-in-out` | `0.65, 0, 0.35, 1` | influence 65%, speed 0 | influence 65%, speed 0 | exits, swaps, moves |
| `ease-standard` | `0.2, 0, 0, 1` | influence 20%, speed 0 | influence 100%, speed 0 | state changes |

### Stagger and travel

| Token | Value | @30 fps | Use |
|---|---|---|---|
| `stagger-tight` | 40 ms | 1f | chips, small lists |
| `stagger-base` | 80 ms | 2f | **default sibling delay** |
| `stagger-loose` | 140 ms | 4f | headline lines |
| `travel-sm` | 16 px | | small UI |
| `travel-md` | 48 px | | **default entrance travel** |
| `travel-lg` | 96 px | | hero elements |

(Travel is for a 1920×1080 frame. Scale it with the comp height.)

### Motion rules

- ❌ **NEVER leave AE's default Easy Ease (33%).** Every key uses a token above.
- ❌ **NEVER use linear keys**, except for constant motion such as a scrolling marquee.
- ❌ **NEVER bounce text or UI.** Content settles. Overshoot belongs to illustrations only, at 8% or less.
- ✅ **Entrances use `ease-out`. Exits use `ease-in-out` and run faster than the entrance.**
- ✅ **Animate position, scale, opacity, rotation and masks only.**
- ✅ **One hero motion per shot.** If two things want attention, stagger them or calm one down.
- ✅ **Ambient loops: 6 s or longer, 10 px or less, 2° or less, one per shot.**

---

## 3. Typography tokens

Sizes are for a 1920×1080 comp. Scale them with the comp height. AE tracking is in 1/1000 em.

| Token | Font | Weight | Size | Leading | Tracking | Use |
|---|---|---|---|---|---|---|
| `display` | Plus Jakarta Sans | Bold | 128 px | 137 px | −22 | one per shot: the title |
| `h1` | Plus Jakarta Sans | Bold | 96 px | 115 px | −14 | big statements |
| `h2` | Plus Jakarta Sans | Bold | 72 px | 86 px | −14 | section titles |
| `h3` | Plus Jakarta Sans | Bold | 48 px | 58 px | −14 | card titles, subtitles |
| `statement` | Plus Jakarta Sans | Light | 64 px | 88 px | −14 | quiet standalone lines |
| `body` | Plus Jakarta Sans | Regular | 36 px | 55 px | +20 | supporting copy |
| `caption` | Plus Jakarta Sans | Regular | 28 px | 42 px | 0 | captions, credits |
| `label` | DM Sans | Medium | 28 px | 34 px | +10 | labels, numbers, dates, UI |

### Type rules

- ❌ **NEVER use any font other than Plus Jakarta Sans and DM Sans.**
- ❌ **NEVER set text smaller than 28 px at 1080p.**
- ❌ **NEVER use uppercase with wide tracking.** Labels are sentence case.
- ❌ **NEVER mix Light (`statement`) and Bold (`display`/`h*`) in one shot.** Pick a voice.
- ✅ **The signature: a black headline over a grey (`ink-ghost`) line at the same size.**
- ✅ **Readable on screen: at least 1 s plus 0.3 s per word.**
- ✅ **Animate lines, not letters.** Lines stagger in with `stagger-loose`.

---

## 4. Layout

- **Safe margin: 96 px** (5%) on every side at 1080p. Nothing important goes outside it.
- **Grid: 12 columns, 32 px gutters**, inside the safe margin. Text and images start and end on column lines.
- **Even padding.** Top equals bottom and left equals right, inside any box or card.
- **Radius:** 20 px for images and cards, full pills for buttons and tags. Nothing sharp.
- **Lines** are 1 px `ink` at 7% opacity, and only between sections. Never draw the grid.

---

## 5. Hard rules

1. ❌ **No value outside this file.** No new colours, fonts, sizes, durations or curves.
2. ❌ **No drop shadows, glows, bevels or gradients on UI or text.** The frame is flat.
3. ❌ **No lime on text. No colour on the frame. Colour lives in the illustration.**
4. ❌ **No default Easy Ease. No linear keys. No bouncing text.**
5. ✅ **One hero motion, one accent and one scene colour per shot.**
6. ✅ **Every shot breathes.** When in doubt, add space and remove an element.
7. ✅ **Every change is one undo group.** Preview before you apply.
