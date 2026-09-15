// orchestrator-guard.ts — enforce the two model-lifecycle duties the orchestrator keeps
// missing, mechanically, so they cannot be forgotten:
//
//   1. LOAD THE LOCAL MODEL BEFORE A LOCAL DISPATCH. When the orchestrator dispatches a
//      local role (backend-dev, frontend-dev, qa, adversary, git-agent), the guard checks
//      the endpoint and runs `ninfer-model.ps1 start` if it is down — fail-closed: a
//      dispatch into a stopped server is refused instead of dying as an opaque error.
//   2. OFFLOAD THE LOCAL MODEL AT RUN END. When the orchestrator's session goes idle and
//      no child session is still busy, run `scripts/ninfer-model.ps1 stop`.
//
// Note: the "QA follows every developer dispatch" rule is intentionally NOT enforced
// here — it is a strict prose guide in orchestrator.md, because the operator must be able
// to redirect the orchestrator away from QA (e.g. after frontend-dev finishes and the
// operator wants to do something else) without a hard block.
//
// The guard keys everything off the orchestrator's session (identified by chat.message
// with agent "orchestrator"), so sub-agent chatter is ignored.

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { Plugin } from "@opencode-ai/plugin"

const STOP = "scripts/ninfer-model.ps1"
const START = "scripts/ninfer-model.ps1"
const ENDPOINT = "http://127.0.0.1:8080/v1/models"
const LOCAL_ROLES = new Set(["backend-dev", "frontend-dev", "qa", "adversary", "git-agent"])
// Escape hatch: set TFLEX_GUARD=off to disable all checks (matches the DSH guard).
const GUARD_ENABLED = process.env.TFLEX_GUARD !== "off"

const execFileAsync = promisify(execFile)

export const OrchestratorGuard: Plugin = async ({ client, directory }) => {
  const orchestratorSessions = new Set<string>()
  // Sessions the server currently reports busy (session.status -> "busy").
  const busy = new Set<string>()

  function log(message: string) {
    try {
      void client.app.log({
        body: { service: "orchestrator-guard", level: "info", message },
      })
    } catch {
      // Never break the intercept path.
    }
  }

  async function endpointUp(): Promise<boolean> {
    try {
      const res = await fetch(ENDPOINT, { signal: AbortSignal.timeout(3000) })
      return res.ok
    } catch {
      return false
    }
  }

  // Ensure the local model is loaded. Returns true if up, throws otherwise (fail-closed).
  async function ensureLoaded(): Promise<void> {
    if (await endpointUp()) return
    log("local model down -> running ninfer-model.ps1 start")
    try {
      await execFileAsync(
        "powershell",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", START, "start"],
        { cwd: directory, timeout: 180000 },
      )
    } catch (e) {
      // The start script already waits and warms; a throw here is a real failure.
      const msg = e instanceof Error ? e.message : String(e)
      log(`load FAILED: ${msg}`)
      throw new Error(
        `orchestrator-guard: could not start the local model (${msg}). Refusing the dispatch.`,
      )
    }
    if (!(await endpointUp())) {
      log("load FAILED: endpoint still not answering after start")
      throw new Error(
        "orchestrator-guard: local model endpoint not answering after start. Refusing the dispatch.",
      )
    }
    log("local model loaded")
  }

  function offload() {
    execFile(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", STOP, "stop"],
      { cwd: directory },
      (err, _stdout, stderr) => {
        if (err) {
          const msg = (stderr || String(err)).trim()
          const alreadyStopped = /already stopped|not running/i.test(msg)
          log(alreadyStopped ? "offload: model already stopped" : `offload FAILED: ${msg}`)
        } else {
          log("offload: local model stopped")
        }
      },
    )
  }

  return {
    async "chat.message"(input) {
      const agent = input.agent ?? ""
      if (agent === "orchestrator") {
        orchestratorSessions.add(input.sessionID)
      }
    },

    async event({ event }) {
      const props = event.properties as Record<string, unknown> | undefined

      if (event.type === "session.status") {
        const sid = props?.sessionID as string | undefined
        if (!sid) return
        const status = props?.status as { type?: string } | undefined
        if (status?.type === "busy") busy.add(sid)
        else if (status?.type === "idle") busy.delete(sid)
        return
      }

      if (event.type !== "session.idle") return
      const sid = props?.sessionID as string | undefined
      if (!sid || !orchestratorSessions.has(sid)) return

      if (!GUARD_ENABLED) return

      busy.delete(sid)
      // The orchestrator's run is over. Offload only if no child is still working —
      // with every local role a synchronous dispatch, an idle orchestrator means none is.
      if (busy.size === 0) {
        log(`run end (orchestrator idle, 0 busy) -> offloading`)
        offload()
      } else {
        log(`run end but ${busy.size} session(s) still busy -> keep model loaded`)
      }
    },

    async "tool.execute.before"(input, output) {
      if (!GUARD_ENABLED) return
      const args = (output.args ?? {}) as Record<string, unknown>
      // Only police the orchestrator's own dispatches.
      if (!orchestratorSessions.has(input.sessionID)) return

      // A task tool call to a sub-agent.
      if (input.tool === "task") {
        const agent = (args.subagent_type ?? args.agent ?? args.name) as string | undefined
        if (!agent) return

        // Load the local model before any local dispatch (fail-closed).
        if (LOCAL_ROLES.has(agent)) {
          await ensureLoaded()
        }
        return
      }
    },
  }
}