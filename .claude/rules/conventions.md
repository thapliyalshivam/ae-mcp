# Conventions

- **New capability is an op, not a panel.** Add it to `engine/vocabulary.js`, then `describeOp` and `applyOne` in `engine/engine.jsx`. `ARCHITECTURE.md` walks through adding an op.
- **`shared/bridge-client.js` stays plain CommonJS / ES5-ish.** Both `mcp/server.js` and the CEP panel load it, and the panel runs it in CEP's Node.
- **Every source file starts with the license header**, after any shebang, `<?xml ?>` or doctype line, in the file's comment style. Keep it ASCII, because `engine.jsx` is sent to After Effects as-is:

  ```
  // AE MCP - https://shivamthapliyal.com
  // Copyright (C) 2026 Shivam Thapliyal
  // SPDX-License-Identifier: GPL-3.0-or-later
  ```

  JSON and Markdown files have no header. Don't remove the credit from the panel footer.
