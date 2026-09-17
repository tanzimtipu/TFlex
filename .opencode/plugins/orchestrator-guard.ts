// orchestrator-guard.ts — enforce the two model-lifecycle duties the orchestrator keeps
// missing, mechanically, so they cannot be forgotten:
//
//   1. LOAD THE LOCAL MODEL BEFORE A LOCAL DISPATCH. When the orchestrator dispatches a
//      local role (backend-dev, frontend-dev, qa, git-agent), the guard checks
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
const LOCAL_ROLES = new Set(["backend-dev", "frontend-dev", "qa", "git-agent"])
// Named roles only: the orchestrator dispatches TFlex's specialist roles, never the
// generic `worker`/built-in subagents — an unnamed sub-agent runs unpinned and unaudited.
// APPROVED includes every dispatched role; LOCAL is only the subset that needs the
// local model loaded. The adversary is approved but NOT local (cloud, orchestrator's
// model) — do not derive APPROVED from LOCAL or the adversary gets refused.
const APPROVED_ROLES = new Set([...LOCAL_ROLES, "adversary", "feature-scout"])
// Emergency escape hatch for an operator debugging the guard. It must never be used as
// normal workflow configuration.
const GUARD_ENABLED = process.env.TFLEX_GUARD !== "off"

const execFileAsync = promisify(execFile)

// This machine has no powershell.exe stub in System32 root — only the v1.0
// folder — so bare "powershell" is NOT resolvable from every host process
// (observed as spawn ENOENT). Resolve the full path first, with one retry for
// a freshly-written executable's transient first-spawn failure (AV scanning).
const SYSTEM_ROOT = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows"
const POWERSHELL = [
  `${SYSTEM_ROOT}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
  "powershell.exe",
]

async function runFirstExisting(candidates: string[], args: string[], opts: object): Promise<{ stdout: string; stderr: string }> {
  const errors: string[] = []
  for (const exe of candidates) {
    try {
      return await execFileAsync(exe, args, opts)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`${exe}: ${msg}`)
      // One retry after a 1s pause: a freshly-written executable can fail its
      // first spawn with a transient ENOENT. The retry virtually always succeeds.
      if (/ENOENT/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 1000))
        try {
          return await execFileAsync(exe, args, opts)
        } catch (e2) {
          errors.push(`${exe} (retry): ${e2 instanceof Error ? e2.message : String(e2)}`)
        }
      }
    }
  }
  throw new Error(errors.join(" | "))
}

export const OrchestratorGuard: Plugin = async ({ client, directory }) => {
  const orchestratorSessions = new Set<string>()
  // Sessions the server currently reports busy (session.status -> "busy").
  const busy = new Set<string>()
  // Both session.status(idle) and session.idle are emitted by supported OpenCode
  // versions.  They can arrive back-to-back, so allow only one stop attempt.
  let offloadInProgress = false

  function log(message: string) {
    try {
      void client.app.log({
        body: { service: "orchestrator-guard", level: "info", message },
      })
    } catch {
      // Never break the intercept path.
    }
  }

  function commandErrorSummary(error: unknown): string {
    const commandError = error as Error & { stdout?: string; stderr?: string }
    return [commandError.message, commandError.stderr, commandError.stdout]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join(" | ")
  }

  async function endpointUp(): Promise<boolean> {
    try {
      const res = await fetch(ENDPOINT, { signal: AbortSignal.timeout(3000) })
      if (!res.ok) return false
      const payload = await res.json() as {
        data?: Array<{ id?: string; context_window?: number; modalities?: { vision?: boolean } }>
      }
      const model = payload.data?.find((entry) => entry.id === "qwen3.8-27b")
      if (!model) return false
      // Older NInfer builds may omit these optional fields. When present, reject a
      // stale server profile instead of treating any listener on port 8080 as healthy.
      if (model.context_window !== undefined && model.context_window !== 220000) return false
      if (model.modalities?.vision !== undefined && model.modalities.vision !== true) return false
      return true
    } catch {
      return false
    }
  }

  // Ensure the local model is loaded. Returns true if up, throws otherwise (fail-closed).
  async function ensureLoaded(): Promise<void> {
    if (await endpointUp()) return
    log("local model down -> running ninfer-model.ps1 start")
    try {
      await runFirstExisting(
        POWERSHELL,
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", START, "start"],
        { cwd: directory, timeout: 180000 },
      )
    } catch (e) {
      // The start script already waits and warms; a throw here is a real failure.
      const msg = commandErrorSummary(e)
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

  async function offload() {
    try {
      await runFirstExisting(
        POWERSHELL,
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", STOP, "stop"],
        { cwd: directory, timeout: 30000 },
      )
      log("offload: local model stopped")
    } catch (err) {
      const msg = commandErrorSummary(err)
      const alreadyStopped = /already stopped|not running/i.test(msg)
      log(alreadyStopped ? "offload: model already stopped" : `offload FAILED: ${msg}`)
    }
  }

  async function offloadWhenRunEnds(sessionID: string, source: string) {
    if (!GUARD_ENABLED || !orchestratorSessions.has(sessionID)) return

    busy.delete(sessionID)
    // Keep the server resident while any child is still working.  A later idle event
    // from the orchestrator will retry once the run has genuinely finished.
    if (busy.size > 0) {
      log(`run end (${source}) but ${busy.size} session(s) still busy -> keep model loaded`)
      return
    }
    if (offloadInProgress) {
      log(`run end (${source}) -> offload already in progress`)
      return
    }

    offloadInProgress = true
    try {
      log(`run end (${source}, 0 busy) -> offloading`)
      await offload()
    } finally {
      offloadInProgress = false
    }
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
        else if (status?.type === "idle") await offloadWhenRunEnds(sid, "session.status")
        return
      }

      if (event.type !== "session.idle") return
      const sid = props?.sessionID as string | undefined
      if (!sid) return
      await offloadWhenRunEnds(sid, "session.idle")
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

        // Named roles only: refuse generic worker/built-in subagents (fail-closed).
        if (!APPROVED_ROLES.has(agent)) {
          throw new Error(
            `orchestrator-guard: "${agent}" is not a TFlex role. Dispatch one of: ` +
              [...APPROVED_ROLES].join(", ") +
              ". A generic sub-agent runs unpinned and is refused.",
          )
        }

        // Load the local model before any local dispatch (fail-closed).
        if (LOCAL_ROLES.has(agent)) {
          await ensureLoaded()
        }
        return
      }
    },
  }
}
