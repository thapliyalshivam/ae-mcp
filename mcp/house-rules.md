# House rules

How to work in every comp, whatever design system the user chose. The design system says what things look like; these rules say how to build them.

## 1. Working

- **Read before you edit.** Call `ae_get_context` first, and again after a change if you need fresh state.
- **Preview, show, then apply.** Run `ae_preview_ops`, show the user the rows, and apply only what they approved.
- **Ops first.** Use `ae_run_script` only for what the ops cannot express, and tell the user what the script will do before running it.
- **Don't build over the user's work.** For a rebuild, duplicate the comp as the next version (`Intro v2`, `Intro v3`) and edit the copy.

## 2. Rig, don't key every layer

- **Animate controllers, not children.** Each section or scene gets a null named `CTRL_<Section>`. Parent its layers to it and key the null. Key a child only for motion of its own.
- **Move the camera in one place.** Push-ins, pans and zooms go on one `CTRL_Camera` null (or a camera parented to it), never by keying every layer.
- **Shared values live once.** Put a `CTRL_Global` null at the top of the comp with Slider Controls for values many layers share: BPM, stagger, travel distance. Layers read them with expressions, so changing a value means editing one slider.
- **Parent before you key.** Set a layer's parent while the parent is at rest (scale 100, rotation 0, at the time the parent's keys start). Otherwise After Effects bakes the parent's current transform into the child.
- **Keep rigs shallow.** Three levels of parenting at most: global, section, layer.

## 3. Naming

- **Controllers start with `CTRL_`** and sit at the top of the layer stack.
- **Name every layer for what it is** (`Title`, `Swatch illo 3`), never After Effects' defaults (`Shape Layer 4`).
- **Never rename a layer that expressions reference.** Expressions find layers by name, so renaming one breaks them.

## 4. Post (4:5) to story or reel (9:16)

Turning a 1080x1350 post or carousel into a 1080x1920 story or reel.

- **Copy, don't convert.** Duplicate the main comp and every comp it uses, add ` 9x16` to each name, and put them in a `Final 9x16` folder. In the main copy, point each layer at its ` 9x16` copy with `replaceSource`. The 4:5 originals stay untouched.
- **Grow the canvas from the centre.** Set the height to 1920 and move every unparented layer down by (1920 - 1350) / 2 = 285 px. Move the keyframes as well as the static value. Children follow their parents, so leave them alone. Stretch background solids to fill the frame instead of moving them.
- **Re-centre nested comps.** In the main copy, set each nested layer's position and anchor point to (540, 960). Expressions that add to `value` keep working.
- **Headings go to the top.** Put the top of each heading's glyphs at y = 200, below the Reels header. Scale headings by 1.5x, but cap the scale so every heading keeps its original line breaks and stays inside its text box. All captions on one slide share one size.
- **Things tied to a heading follow it.** Body text sits 40 px under its heading, and UI that belongs to it, such as sliders, about 70 px under.
- **Bottom things go lower.** Anything that sat at or bled off the bottom moves down until its bottom edge is 220 px above the frame bottom, clear of the Reels caption. Move decorations, such as confetti, with the element they belong to.
- **Some things stay put.** A composed cover keeps its layout. A standalone centred statement scales 1.5x and stays centred.
- **Measure text after it has entered.** Read a text layer's bounds with `sourceRectAtTime` at its entrance delay + 1.3 s, not at frame 0, because entrance animators move the glyphs before then.
- **Mattes.** Track matte layers stay hidden. If you rescale a layer that has a matte parented to it, rebuild the matte's size and position in that layer's own coordinates.
- **Check.** Render one frame of every slide, and check that headings sit at the top, nothing at the bottom is cut off, no matte is visible and no expression errors.
