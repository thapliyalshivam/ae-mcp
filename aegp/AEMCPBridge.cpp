// AE MCP - https://shivamthapliyal.com
// Copyright (C) 2026 Shivam Thapliyal
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * AE MCP Bridge — an AEGP plugin that lets local processes run ExtendScript inside After Effects.
 *
 *   mcp/server.js ──tcp 127.0.0.1:7391──▶ network thread ──queue──▶ idle hook (main thread)
 *   panel (CEP)   ──────────┘                    ▲                       │ AEGP_ExecuteScript
 *                                                └────── reply ◀─────────┘
 *
 * Replaces the osascript DoScript round trip: no Automation prompt, no temp files, and the
 * script's result comes back directly instead of through a file.
 *
 * Protocol: one JSON object per line, both ways. Requests carry an `id` that the reply echoes.
 *
 *   {"id":1,"type":"hello","client":"mcp","pid":123,"info":"..."}   name this connection
 *   {"id":2,"type":"eval","script":"...","label":"ae_get_context"}   run on the main thread
 *   {"id":3,"type":"status"}                                          bridge + client snapshot
 *   {"id":4,"type":"setEnabled","enabled":false}                      pause / resume evals
 *   {"id":5,"type":"broadcast","event":"reload"}                      relay an event to the others
 *
 * Events pushed to clients: {"type":"event","event":"...","from":"panel"}.
 *
 * Only AEGP_CauseIdleRoutinesToBeCalled is touched off the main thread — the SDK documents it as
 * the one thread-safe call. Everything else AE-side happens in IdleHook.
 */
#include "AEConfig.h"
#include "entry.h"
#include "AE_GeneralPlug.h"
#include "AE_Macros.h"
#include "AEGP_SuiteHandler.h"

#include <arpa/inet.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <atomic>
#include <cerrno>
#include <cstring>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <deque>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

extern "C" DllExport AEGP_PluginInitFuncPrototype EntryPointFunc;

#define BRIDGE_VERSION "1.0.0"
#define DEFAULT_PORT 7391
#define MAX_LINE (64 * 1024 * 1024)
#define ACTIVITY_MAX 40

static AEGP_PluginID S_my_id = 0L;
static SPBasicSuite *sP = NULL;
static AEGP_UtilitySuite6 *S_util = NULL; // held for the plugin's life, for the thread-safe wake call

/* ---------------------------------------------------------------- json */

typedef std::map<std::string, std::string> Fields; // key -> decoded string, or raw text for non-strings

static std::string JsonEscape(const std::string &s)
{
	std::string out;
	out.reserve(s.size() + 8);
	for (size_t i = 0; i < s.size(); i++) {
		unsigned char c = (unsigned char)s[i];
		switch (c) {
			case '"': out += "\\\""; break;
			case '\\': out += "\\\\"; break;
			case '\n': out += "\\n"; break;
			case '\r': out += "\\r"; break;
			case '\t': out += "\\t"; break;
			default:
				if (c < 0x20) {
					char buf[8];
					snprintf(buf, sizeof buf, "\\u%04x", c);
					out += buf;
				} else {
					out += (char)c;
				}
		}
	}
	return out;
}

static std::string Q(const std::string &s) { return "\"" + JsonEscape(s) + "\""; }

static void AppendUtf8(std::string &out, unsigned long cp)
{
	if (cp < 0x80) {
		out += (char)cp;
	} else if (cp < 0x800) {
		out += (char)(0xC0 | (cp >> 6));
		out += (char)(0x80 | (cp & 0x3F));
	} else if (cp < 0x10000) {
		out += (char)(0xE0 | (cp >> 12));
		out += (char)(0x80 | ((cp >> 6) & 0x3F));
		out += (char)(0x80 | (cp & 0x3F));
	} else {
		out += (char)(0xF0 | (cp >> 18));
		out += (char)(0x80 | ((cp >> 12) & 0x3F));
		out += (char)(0x80 | ((cp >> 6) & 0x3F));
		out += (char)(0x80 | (cp & 0x3F));
	}
}

static void SkipWs(const std::string &s, size_t &i)
{
	while (i < s.size() && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++;
}

static bool ParseString(const std::string &s, size_t &i, std::string &out)
{
	if (i >= s.size() || s[i] != '"') return false;
	i++;
	while (i < s.size()) {
		char c = s[i++];
		if (c == '"') return true;
		if (c != '\\') { out += c; continue; }
		if (i >= s.size()) return false;
		char e = s[i++];
		switch (e) {
			case 'n': out += '\n'; break;
			case 'r': out += '\r'; break;
			case 't': out += '\t'; break;
			case 'b': out += '\b'; break;
			case 'f': out += '\f'; break;
			case 'u': {
				if (i + 4 > s.size()) return false;
				unsigned long cp = strtoul(s.substr(i, 4).c_str(), NULL, 16);
				i += 4;
				if (cp >= 0xD800 && cp < 0xDC00 && i + 6 <= s.size() && s[i] == '\\' && s[i + 1] == 'u') {
					unsigned long lo = strtoul(s.substr(i + 2, 4).c_str(), NULL, 16);
					if (lo >= 0xDC00 && lo < 0xE000) {
						cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
						i += 6;
					}
				}
				AppendUtf8(out, cp);
				break;
			}
			default: out += e; // \" \\ \/
		}
	}
	return false;
}

/** Skip one non-string value (number, literal, nested object/array) and return its raw text. */
static bool SkipValue(const std::string &s, size_t &i, std::string &raw)
{
	size_t start = i;
	int depth = 0;
	while (i < s.size()) {
		char c = s[i];
		if (c == '"') {
			std::string ignored;
			if (!ParseString(s, i, ignored)) return false;
			continue;
		}
		if (c == '{' || c == '[') depth++;
		else if (c == '}' || c == ']') {
			if (depth == 0) break;
			depth--;
		} else if (c == ',' && depth == 0) break;
		i++;
	}
	raw = s.substr(start, i - start);
	while (!raw.empty() && (raw.back() == ' ' || raw.back() == '\t' || raw.back() == '\r' || raw.back() == '\n')) raw.pop_back();
	return depth == 0;
}

/** Parses a flat JSON object. `rawKeys` lists the keys kept as raw JSON (e.g. the request id). */
static bool ParseObject(const std::string &s, Fields &fields, Fields &raw)
{
	size_t i = 0;
	SkipWs(s, i);
	if (i >= s.size() || s[i] != '{') return false;
	i++;
	for (;;) {
		SkipWs(s, i);
		if (i < s.size() && s[i] == '}') return true;
		std::string key;
		if (!ParseString(s, i, key)) return false;
		SkipWs(s, i);
		if (i >= s.size() || s[i] != ':') return false;
		i++;
		SkipWs(s, i);
		if (i < s.size() && s[i] == '"') {
			size_t start = i;
			std::string value;
			if (!ParseString(s, i, value)) return false;
			fields[key] = value;
			raw[key] = s.substr(start, i - start);
		} else {
			std::string value;
			if (!SkipValue(s, i, value)) return false;
			fields[key] = value;
			raw[key] = value;
		}
		SkipWs(s, i);
		if (i < s.size() && s[i] == ',') { i++; continue; }
		if (i < s.size() && s[i] == '}') return true;
		return false;
	}
}

/* ---------------------------------------------------------------- state */

static double NowMs()
{
	using namespace std::chrono;
	return (double)duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}

struct Client {
	int fd;
	int id;
	std::string inbuf, outbuf;
	std::string name, info;
	long pid;
	double connectedAt, lastSeen;
	long evals;
};

struct Job {
	int clientId;
	std::string reqId; // raw JSON
	std::string script, label, clientName;
	double queuedAt;
};

struct Reply {
	int clientId; // 0 = every client
	std::string line;
};

struct Activity {
	double at, ms;
	std::string client, label, error;
	bool ok;
};

static std::mutex S_lock; // guards everything below
static std::map<int, Client> S_clients;
static std::deque<Job> S_jobs;
static std::deque<Reply> S_replies;
static std::deque<Activity> S_activity;
static std::string S_listenError;
static std::string S_runningJob;
static long S_evalCount = 0, S_errorCount = 0;
static double S_startedAt = 0, S_lastEvalAt = 0;

static std::atomic<bool> S_enabled(true);
static std::atomic<bool> S_running(false);
static int S_port = DEFAULT_PORT;
static int S_wake[2] = {-1, -1};
static std::thread S_thread;

static void Wake()
{
	if (S_wake[1] >= 0) {
		char b = 1;
		ssize_t n = write(S_wake[1], &b, 1);
		(void)n;
	}
}

static void PushReply(int clientId, const std::string &line)
{
	{
		std::lock_guard<std::mutex> g(S_lock);
		S_replies.push_back(Reply{clientId, line});
	}
	Wake();
}

/* ---------------------------------------------------------------- main thread */

static std::string TakeMemHandle(AEGP_SuiteHandler &suites, AEGP_MemHandle h)
{
	std::string out;
	if (!h) return out;
	void *p = NULL;
	if (!suites.MemorySuite1()->AEGP_LockMemHandle(h, &p) && p) out = (const char *)p;
	suites.MemorySuite1()->AEGP_UnlockMemHandle(h);
	suites.MemorySuite1()->AEGP_FreeMemHandle(h);
	return out;
}

static void RunJob(const Job &job)
{
	AEGP_SuiteHandler suites(sP);
	AEGP_MemHandle resultH = NULL, errorH = NULL;
	double started = NowMs();

	{
		std::lock_guard<std::mutex> g(S_lock);
		S_runningJob = job.label.empty() ? "eval" : job.label;
	}
	A_Err err = suites.UtilitySuite6()->AEGP_ExecuteScript(S_my_id, job.script.c_str(), FALSE, &resultH, &errorH);
	std::string result = TakeMemHandle(suites, resultH);
	std::string error = TakeMemHandle(suites, errorH);
	if (err && error.empty()) error = "AEGP_ExecuteScript failed (error " + std::to_string((long)err) + ")";
	bool ok = error.empty();
	double ms = NowMs() - started;

	{
		std::lock_guard<std::mutex> g(S_lock);
		S_runningJob.clear();
		S_evalCount++;
		if (!ok) S_errorCount++;
		S_lastEvalAt = NowMs();
		std::map<int, Client>::iterator c = S_clients.find(job.clientId);
		if (c != S_clients.end()) c->second.evals++;
		S_activity.push_back(Activity{S_lastEvalAt, ms, job.clientName, job.label.empty() ? "eval" : job.label,
			error.substr(0, 300), ok});
		while (S_activity.size() > ACTIVITY_MAX) S_activity.pop_front();
	}

	char msBuf[32];
	snprintf(msBuf, sizeof msBuf, "%.0f", ms);
	PushReply(job.clientId, "{\"id\":" + job.reqId + ",\"ok\":" + (ok ? "true" : "false") +
		",\"result\":" + Q(result) + ",\"error\":" + Q(error) + ",\"ms\":" + msBuf + "}");
}

static A_Err IdleHook(AEGP_GlobalRefcon, AEGP_IdleRefcon, A_long *max_sleepPL)
{
	// One job per idle call keeps AE responsive between scripts; ask to be called back soon
	// while more are waiting.
	Job job;
	bool have = false, more = false;
	{
		std::lock_guard<std::mutex> g(S_lock);
		if (!S_jobs.empty()) {
			job = S_jobs.front();
			S_jobs.pop_front();
			have = true;
			more = !S_jobs.empty();
		}
	}
	if (have) {
		try {
			RunJob(job);
		} catch (...) {
			PushReply(job.clientId, "{\"id\":" + job.reqId + ",\"ok\":false,\"result\":\"\",\"error\":\"Bridge exception while running the script\"}");
		}
	}
	if (more && max_sleepPL) *max_sleepPL = 0;
	return A_Err_NONE;
}

/* ---------------------------------------------------------------- network thread */

/** Caller holds S_lock. */
static std::string StatusJson(int forClient)
{
	char num[64];
	std::string s = "{\"type\":\"status\",\"version\":\"" BRIDGE_VERSION "\"";
	snprintf(num, sizeof num, ",\"port\":%d,\"pid\":%d", S_port, (int)getpid());
	s += num;
	s += std::string(",\"enabled\":") + (S_enabled ? "true" : "false");
	snprintf(num, sizeof num, ",\"startedAt\":%.0f,\"now\":%.0f,\"lastEvalAt\":%.0f", S_startedAt, NowMs(), S_lastEvalAt);
	s += num;
	snprintf(num, sizeof num, ",\"evals\":%ld,\"errors\":%ld,\"queued\":%d", S_evalCount, S_errorCount, (int)S_jobs.size());
	s += num;
	s += ",\"running\":" + Q(S_runningJob);
	s += ",\"listenError\":" + Q(S_listenError);
	s += ",\"clients\":[";
	bool first = true;
	for (std::map<int, Client>::iterator it = S_clients.begin(); it != S_clients.end(); ++it) {
		const Client &c = it->second;
		if (!first) s += ",";
		first = false;
		snprintf(num, sizeof num, "{\"id\":%d,\"pid\":%ld,\"evals\":%ld,", c.id, c.pid, c.evals);
		s += num;
		snprintf(num, sizeof num, "\"connectedAt\":%.0f,\"lastSeen\":%.0f,", c.connectedAt, c.lastSeen);
		s += num;
		s += "\"name\":" + Q(c.name.empty() ? "unknown" : c.name) + ",\"info\":" + Q(c.info) +
			",\"self\":" + (c.id == forClient ? "true" : "false") + "}";
	}
	s += "],\"activity\":[";
	for (size_t i = 0; i < S_activity.size(); i++) {
		const Activity &a = S_activity[i];
		if (i) s += ",";
		snprintf(num, sizeof num, "{\"at\":%.0f,\"ms\":%.0f,", a.at, a.ms);
		s += num;
		s += "\"client\":" + Q(a.client) + ",\"label\":" + Q(a.label) + ",\"ok\":" + (a.ok ? "true" : "false") +
			",\"error\":" + Q(a.error) + "}";
	}
	s += "]}";
	return s;
}

static void QueueTo(Client &c, const std::string &line)
{
	c.outbuf += line;
	c.outbuf += "\n";
}

static void HandleLine(Client &client, const std::string &line)
{
	Fields f, raw;
	if (!ParseObject(line, f, raw)) {
		QueueTo(client, "{\"id\":null,\"ok\":false,\"error\":\"Unparseable request\"}");
		return;
	}
	std::string id = raw.count("id") ? raw["id"] : "null";
	const std::string type = f["type"];
	client.lastSeen = NowMs();

	if (type == "hello") {
		client.name = f["client"];
		client.info = f["info"];
		client.pid = atol(f["pid"].c_str());
		QueueTo(client, "{\"id\":" + id + ",\"ok\":true,\"version\":\"" BRIDGE_VERSION "\",\"enabled\":" +
			(S_enabled ? "true" : "false") + "}");
	} else if (type == "ping") {
		QueueTo(client, "{\"id\":" + id + ",\"ok\":true}");
	} else if (type == "status") {
		QueueTo(client, "{\"id\":" + id + ",\"ok\":true,\"status\":" + StatusJson(client.id) + "}");
	} else if (type == "eval") {
		if (!S_enabled) {
			QueueTo(client, "{\"id\":" + id + ",\"ok\":false,\"paused\":true,\"error\":\"The AE MCP bridge is paused. Resume it from Window > Extensions > AE MCP.\"}");
			return;
		}
		S_jobs.push_back(Job{client.id, id, f["script"], f["label"], client.name, NowMs()});
		if (S_util) S_util->AEGP_CauseIdleRoutinesToBeCalled();
	} else if (type == "setEnabled") {
		bool on = f["enabled"] == "true";
		S_enabled = on;
		QueueTo(client, "{\"id\":" + id + ",\"ok\":true,\"enabled\":" + (on ? "true" : "false") + "}");
		std::string ev = std::string("{\"type\":\"event\",\"event\":\"") + (on ? "resumed" : "paused") +
			"\",\"from\":" + Q(client.name) + "}";
		for (std::map<int, Client>::iterator it = S_clients.begin(); it != S_clients.end(); ++it) {
			if (it->first != client.id) QueueTo(it->second, ev);
		}
	} else if (type == "broadcast") {
		int delivered = 0;
		std::string ev = "{\"type\":\"event\",\"event\":" + Q(f["event"]) + ",\"from\":" + Q(client.name) + "}";
		for (std::map<int, Client>::iterator it = S_clients.begin(); it != S_clients.end(); ++it) {
			if (it->first == client.id) continue;
			if (!f["to"].empty() && it->second.name != f["to"]) continue;
			QueueTo(it->second, ev);
			delivered++;
		}
		QueueTo(client, "{\"id\":" + id + ",\"ok\":true,\"delivered\":" + std::to_string(delivered) + "}");
	} else {
		QueueTo(client, "{\"id\":" + id + ",\"ok\":false,\"error\":" + Q("Unknown request type: " + type) + "}");
	}
}

static void Serve(int listenFd)
{
	int nextId = 1;
	while (S_running) {
		std::vector<struct pollfd> fds;
		std::vector<int> ids;
		{
			std::lock_guard<std::mutex> g(S_lock);
			while (!S_replies.empty()) {
				Reply r = S_replies.front();
				S_replies.pop_front();
				for (std::map<int, Client>::iterator it = S_clients.begin(); it != S_clients.end(); ++it) {
					if (r.clientId == 0 || it->first == r.clientId) QueueTo(it->second, r.line);
				}
			}
			fds.push_back(pollfd{listenFd, POLLIN, 0});
			fds.push_back(pollfd{S_wake[0], POLLIN, 0});
			for (std::map<int, Client>::iterator it = S_clients.begin(); it != S_clients.end(); ++it) {
				short ev = POLLIN;
				if (!it->second.outbuf.empty()) ev |= POLLOUT;
				fds.push_back(pollfd{it->second.fd, ev, 0});
				ids.push_back(it->first);
			}
		}

		if (poll(&fds[0], (nfds_t)fds.size(), 1000) < 0) continue;
		if (!S_running) break;

		if (fds[1].revents & POLLIN) {
			char drain[64];
			while (read(S_wake[0], drain, sizeof drain) > 0) {}
		}

		if (fds[0].revents & POLLIN) {
			int fd = accept(listenFd, NULL, NULL);
			if (fd >= 0) {
				fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK);
				int one = 1;
				setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
				setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof one);
				std::lock_guard<std::mutex> g(S_lock);
				Client c;
				c.fd = fd;
				c.id = nextId++;
				c.pid = 0;
				c.evals = 0;
				c.connectedAt = c.lastSeen = NowMs();
				S_clients[c.id] = c;
			}
		}

		for (size_t k = 0; k < ids.size(); k++) {
			struct pollfd &p = fds[k + 2];
			int cid = ids[k];
			bool drop = false;

			if (p.revents & (POLLIN | POLLHUP | POLLERR)) {
				char buf[65536];
				for (;;) {
					ssize_t n = read(p.fd, buf, sizeof buf);
					if (n > 0) {
						std::lock_guard<std::mutex> g(S_lock);
						Client &c = S_clients[cid];
						c.inbuf.append(buf, (size_t)n);
						if (c.inbuf.size() > MAX_LINE) { drop = true; break; }
						continue;
					}
					if (n == 0 || (errno != EAGAIN && errno != EWOULDBLOCK)) drop = true;
					break;
				}
				{
					std::lock_guard<std::mutex> g(S_lock);
					Client &c = S_clients[cid];
					size_t nl;
					while ((nl = c.inbuf.find('\n')) != std::string::npos) {
						std::string line = c.inbuf.substr(0, nl);
						c.inbuf.erase(0, nl + 1);
						if (!line.empty()) HandleLine(c, line);
					}
				}
			}

			if (!drop) {
				std::lock_guard<std::mutex> g(S_lock);
				Client &c = S_clients[cid];
				while (!c.outbuf.empty()) {
					ssize_t n = write(c.fd, c.outbuf.data(), c.outbuf.size());
					if (n > 0) { c.outbuf.erase(0, (size_t)n); continue; }
					if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) break;
					drop = true;
					break;
				}
			}

			if (drop) {
				std::lock_guard<std::mutex> g(S_lock);
				close(S_clients[cid].fd);
				S_clients.erase(cid);
			}
		}
	}

	std::lock_guard<std::mutex> g(S_lock);
	for (std::map<int, Client>::iterator it = S_clients.begin(); it != S_clients.end(); ++it) close(it->second.fd);
	S_clients.clear();
}

static void NetworkThread()
{
	int fd = socket(AF_INET, SOCK_STREAM, 0);
	int one = 1;
	setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
	struct sockaddr_in addr;
	memset(&addr, 0, sizeof addr);
	addr.sin_family = AF_INET;
	addr.sin_port = htons((uint16_t)S_port);
	addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK); // never reachable off this machine

	if (fd < 0 || bind(fd, (struct sockaddr *)&addr, sizeof addr) != 0 || listen(fd, 16) != 0) {
		std::lock_guard<std::mutex> g(S_lock);
		S_listenError = "Could not listen on 127.0.0.1:" + std::to_string(S_port) + " (" + strerror(errno) +
			"). Another After Effects instance may hold the port.";
		if (fd >= 0) close(fd);
		return;
	}
	fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK);
	Serve(fd);
	close(fd);
}

/* ---------------------------------------------------------------- lifecycle */

static A_Err DeathHook(AEGP_GlobalRefcon, AEGP_DeathRefcon)
{
	S_running = false;
	Wake();
	if (S_thread.joinable()) S_thread.join();
	if (S_wake[0] >= 0) close(S_wake[0]);
	if (S_wake[1] >= 0) close(S_wake[1]);
	S_wake[0] = S_wake[1] = -1;
	if (S_util && sP) {
		sP->ReleaseSuite(kAEGPUtilitySuite, kAEGPUtilitySuiteVersion6);
		S_util = NULL;
	}
	return A_Err_NONE;
}

A_Err EntryPointFunc(
	struct SPBasicSuite *pica_basicP,
	A_long major_versionL,
	A_long minor_versionL,
	AEGP_PluginID aegp_plugin_id,
	AEGP_GlobalRefcon *global_refconP)
{
	A_Err err = A_Err_NONE;
	S_my_id = aegp_plugin_id;
	sP = pica_basicP;

	AEGP_SuiteHandler suites(pica_basicP);

	const char *port = getenv("AE_MCP_PORT");
	if (port && atoi(port) > 0) S_port = atoi(port);
	S_startedAt = NowMs();

	ERR(sP->AcquireSuite(kAEGPUtilitySuite, kAEGPUtilitySuiteVersion6, (const void **)&S_util));
	ERR(suites.RegisterSuite5()->AEGP_RegisterIdleHook(S_my_id, IdleHook, 0));
	ERR(suites.RegisterSuite5()->AEGP_RegisterDeathHook(S_my_id, DeathHook, 0));

	if (!err && pipe(S_wake) == 0) {
		fcntl(S_wake[0], F_SETFL, fcntl(S_wake[0], F_GETFL) | O_NONBLOCK);
		fcntl(S_wake[1], F_SETFL, fcntl(S_wake[1], F_GETFL) | O_NONBLOCK);
		S_running = true;
		S_thread = std::thread(NetworkThread);
	}
	return err;
}
