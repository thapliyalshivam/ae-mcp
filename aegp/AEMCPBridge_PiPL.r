/*
 * AE MCP - https://shivamthapliyal.com
 * Copyright (C) 2026 Shivam Thapliyal
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

#include "AEConfig.h"

#ifndef AE_OS_WIN
	#include "AE_General.r"
#endif

resource 'PiPL' (16000) {
	{
		Kind {
			AEGP
		},
		Name {
			"AE MCP Bridge"
		},
		Category {
			"General Plugin"
		},
		Version {
			65536
		},
#ifdef AE_OS_WIN
		CodeWin64X86 {"EntryPointFunc"},
#elif defined(AE_OS_MAC)
		CodeMacIntel64 {"EntryPointFunc"},
		CodeMacARM64 {"EntryPointFunc"},
#endif
	}
};
