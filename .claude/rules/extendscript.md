---
paths:
  - "**/*.jsx"
---

# ExtendScript (After Effects)

ExtendScript is **ES3**.

- **No `JSON`.** Build replies by hand. In `engine/engine.jsx` use `respond` / `respondWithData` / `escStr`; `panel/panel.jsx` has its own `esc`.
- **No ES5+.** No `forEach`, `map`, `filter`, `indexOf`, `trim`, arrow functions, `const`, `let`, template literals or destructuring. Use `for` loops and `var`.
- **Undo groups are opened by the entry point, not by ops.** `claudeApplyOps` and the `ae_run_script` wrapper in `mcp/tools.js` each wrap the whole call in one group. Don't open one inside `applyOne`. A new entry point that changes the project must wrap itself in exactly one.
- **Guard the active comp:** `var comp = app.project.activeItem; if (!comp || !(comp instanceof CompItem)) return respond(false, 'No active composition.');`
- **Address layers by `layer.id`**, not by index. Indices are 1-based and shift when layers move.
- **Position can be 2D or 3D.** Check `.length` before `setValue`, and keep `z` when it is there.
- **Set properties by name:** `layer.property('Position')`, not `layer.position`.
- **Colors are `[r, g, b]` floats from 0 to 1**, not 0–255.
