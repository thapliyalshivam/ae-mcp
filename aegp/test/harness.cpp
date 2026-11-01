/**
 * Runs the real AEMCPBridge.cpp outside After Effects, against fake AEGP suites, so the socket
 * server, JSON handling and main-thread hand-off can be tested without restarting AE.
 *
 * Fake AEGP_ExecuteScript: returns "echo:<script>", except a script of "throw" (sets the error
 * string) and "sleep" (blocks the "main thread" for 300 ms).
 */
#include "../AEMCPBridge.cpp"

#include <cstring>

static AEGP_IdleHook S_fakeIdle = NULL;
static AEGP_DeathHook S_fakeDeath = NULL;
static std::atomic<int> S_wakes(0);

struct FakeMem { char *data; };

static AEGP_MemHandle NewMem(const std::string &s)
{
	FakeMem *m = new FakeMem;
	m->data = strdup(s.c_str());
	return (AEGP_MemHandle)m;
}

static A_Err FakeLock(AEGP_MemHandle h, void **p) { *p = ((FakeMem *)h)->data; return A_Err_NONE; }
static A_Err FakeUnlock(AEGP_MemHandle) { return A_Err_NONE; }
static A_Err FakeFree(AEGP_MemHandle h) { free(((FakeMem *)h)->data); delete (FakeMem *)h; return A_Err_NONE; }

static A_Err FakeExecute(AEGP_PluginID, const A_char *script, const A_Boolean, AEGP_MemHandle *resultPH, AEGP_MemHandle *errorPH)
{
	std::string s(script);
	if (s == "throw") {
		*resultPH = NewMem("");
		*errorPH = NewMem("Error: thrown on purpose");
		return 1;
	}
	if (s == "sleep") usleep(300 * 1000);
	*resultPH = NewMem("echo:" + s);
	*errorPH = NULL;
	return A_Err_NONE;
}

static A_Err FakeWake(void) { S_wakes++; return A_Err_NONE; }

static A_Err FakeRegisterIdle(AEGP_PluginID, AEGP_IdleHook f, AEGP_IdleRefcon) { S_fakeIdle = f; return A_Err_NONE; }
static A_Err FakeRegisterDeath(AEGP_PluginID, AEGP_DeathHook f, AEGP_DeathRefcon) { S_fakeDeath = f; return A_Err_NONE; }

static AEGP_UtilitySuite6 S_fakeUtil;
static AEGP_MemorySuite1 S_fakeMem;
static AEGP_RegisterSuite5 S_fakeReg;

static SPErr FakeAcquire(const char *name, int32, const void **suite)
{
	if (!strcmp(name, kAEGPUtilitySuite)) *suite = &S_fakeUtil;
	else if (!strcmp(name, kAEGPMemorySuite)) *suite = &S_fakeMem;
	else if (!strcmp(name, kAEGPRegisterSuite)) *suite = &S_fakeReg;
	else { *suite = NULL; return 1; }
	return 0;
}
static SPErr FakeRelease(const char *, int32) { return 0; }

int main()
{
	memset(&S_fakeUtil, 0, sizeof S_fakeUtil);
	memset(&S_fakeMem, 0, sizeof S_fakeMem);
	memset(&S_fakeReg, 0, sizeof S_fakeReg);
	S_fakeUtil.AEGP_ExecuteScript = FakeExecute;
	S_fakeUtil.AEGP_CauseIdleRoutinesToBeCalled = FakeWake;
	S_fakeMem.AEGP_LockMemHandle = FakeLock;
	S_fakeMem.AEGP_UnlockMemHandle = FakeUnlock;
	S_fakeMem.AEGP_FreeMemHandle = FakeFree;
	S_fakeReg.AEGP_RegisterIdleHook = FakeRegisterIdle;
	S_fakeReg.AEGP_RegisterDeathHook = FakeRegisterDeath;

	SPBasicSuite basic;
	memset(&basic, 0, sizeof basic);
	basic.AcquireSuite = FakeAcquire;
	basic.ReleaseSuite = FakeRelease;

	AEGP_GlobalRefcon refcon = NULL;
	if (EntryPointFunc(&basic, 0, 0, 1, &refcon) || !S_fakeIdle) {
		fprintf(stderr, "EntryPointFunc failed\n");
		return 1;
	}
	printf("ready\n");
	fflush(stdout);

	// The "main thread": run idle hooks until stdin closes, like AE's event loop would.
	fcntl(0, F_SETFL, fcntl(0, F_GETFL) | O_NONBLOCK);
	for (;;) {
		A_long sleep = 50;
		S_fakeIdle(NULL, NULL, &sleep);
		char c;
		ssize_t n = read(0, &c, 1);
		if (n == 0) break;
		usleep(sleep ? 5000 : 0);
	}
	S_fakeDeath(NULL, NULL);
	printf("wakes:%d\n", (int)S_wakes);
	return 0;
}
