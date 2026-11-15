---
paths:
  - "aegp/**"
---

# AE MCP Bridge (AEGP plugin)

- **Only the main thread calls AE.** AE APIs run in the idle hook. The network thread may call only `AEGP_CauseIdleRoutinesToBeCalled`, using the suite pointer acquired on the main thread at load.
- **Test before installing.** After changing bridge code, run `npm run test-bridge` (fake AEGP suites, ASan/UBSan) before `npm run install-aegp`.
