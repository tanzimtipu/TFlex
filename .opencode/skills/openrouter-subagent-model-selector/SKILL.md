---
name: openrouter-subagent-model-selector
description: Use when asked to analyze OpenRouter discounted models or free models, calculate token costs against TFlex sub-agent models, compare model capabilities, evaluate local Hugging Face models for the operator's Ryzen 9 5950X / 64GB RAM / RTX 4090 24GB hardware, and recommend cost-effective capable cloud or local endpoints for sub-agent replacement.
---

# OpenRouter Sub-Agent Model Selector

Use this skill to produce a current, evidence-based recommendation for TFlex sub-agent model replacements. Evaluate both hosted OpenRouter models and local Hugging Face models. The goal is the lowest sustainable cost that still preserves each role's required capability, reliability, context, and tool-use performance.

This skill is analysis-first. Do not edit `.opencode/agents/*.md`, `AGENTS.md`, `AGENTS_NOTES.md`, or any product code unless the human explicitly asks for that separate change after reviewing the recommendation.

## Scope and hard rules

- Analyze only sub-agents: `backend-dev`, `frontend-dev`, `qa`, `adversary`, and `git-agent`.
- Never analyze or replace the orchestrator's `openrouter/deepseek/deepseek-v4.1-flash` model.
- Never recommend `openrouter/deepseek/deepseek-v4.1-flash` for any sub-agent; TFlex reserves it for the orchestrator.
- Read `AGENTS.md` and `.opencode/agents/*.md` before comparing. Treat their model-integrity and fallback rules as constraints.
- A recommendation is not an applied swap. State clearly that only the human may approve and apply model changes, and that swaps must be recorded in `AGENTS_NOTES.md` when applied.
- Do not use stale benchmark or pricing knowledge. Refresh all prices and model IDs at run time.

## Data sources

Fetch all of these at run time:

1. `https://openrouter.ai/collections/discounted-models`
   - Source for current promotional discounts.
   - Treat discount badges and page ordering as discovery signals, not authoritative metadata.
2. `https://openrouter.ai/collections/free-models`
   - Source for current free candidates.
   - Free means `$0/M` input and `$0/M` output at collection time, not necessarily unlimited or rate-limit-free.
3. `https://openrouter.ai/api/v1/models`
   - Authoritative source for canonical OpenRouter model IDs, pricing fields, context length, modality, and supported parameters.
   - Always cross-check every OpenRouter collection candidate against this API before recommending it.
   - Warning: this API returns default-route pricing, which can be materially higher than the cheapest promoted route (observed: GLM 5.2 default $1.19/M vs $0.3276/M at StreamLake fp8). Never price-compare on this API alone.
4. `https://openrouter.ai/api/v1/models/<id>/endpoints`
   - Authoritative for the cheapest routable price per model: `pricing.prompt`, `pricing.completion`, `pricing.discount`, `quantization`, per-route `context_length`, and provider count.
   - Required for every shortlisted candidate. Per-route context length is evidence: the same model can be 1M on one provider and 256K on another; single-provider routes are a reliability signal.
5. OpenRouter model detail pages, when needed:
   - `https://openrouter.ai/<provider>/<model>`
   - Use these for capability descriptions, provider notes, data-policy warnings, quantization notes, tool support, reasoning support, and output limits.
6. `https://huggingface.co/models`
   - Source for local candidates comparable to the OpenRouter candidates.
   - Search/filter for current instruction-tuned coding, agentic, tool-calling, and multimodal models as appropriate to each role.
7. Hugging Face model cards and repository files for each local candidate.
   - Use the model card for parameter count, architecture, context length, license, intended use, quantization support, tool-calling support, benchmark claims, and hardware guidance.
   - Use repository files to verify downloadable artifacts such as GGUF, safetensors, AWQ, GPTQ, EXL2, or MLX files.
8. Local inference documentation when needed:
   - LM Studio, Ollama, llama.cpp, vLLM, Transformers, ExLlamaV2/TabbyAPI, or another mainstream runner.
   - Prefer the simplest reliable runner for the operator's Windows desktop and OpenCode workflow.

If a collection page is incomplete in fetched markdown, use the model APIs plus targeted model detail pages to recover candidate details. Do not guess missing data.

## Run-time fetch protocol (retry-proof)

Follow these rules when fetching run-time data. They exist because this session previously produced empty prices, zero-byte sizes, and hard shell errors that forced repeated retries.

1. PowerShell 5.1 rules (this environment):
   - Use `Invoke-RestMethod` only. Never use `Invoke-WebRequest` — it hard-errors with "NonInteractive mode" on this machine.
   - Never compute inside `-f` format strings over pipeline objects. Select the object into a local, compute scalars (e.g. `$p = [math]::Round([decimal]$best.pricing.prompt * 1e6, 4)`), then format. Inline math in format strings produced empty `in=/M out=/M` output before.
   - Silence expected per-probe HTTP errors with `try/catch` or `-ErrorAction SilentlyContinue`, accumulate results into an array, and print once. Do not let the error stream flood the output.
   - When looping over 10+ model IDs, set the shell command timeout >= 180000 ms with `-TimeoutSec 60` per HTTP call.
2. Recipe A — OpenRouter sweep (known-good):
   - Fetch `https://openrouter.ai/api/v1/models` once; filter candidate IDs; extract id, context_length, modality, pricing, `supported_parameters` (tools, structured_outputs), `hugging_face_id`.
   - Then per shortlisted ID fetch `https://openrouter.ai/api/v1/models/<id>/endpoints`; sort endpoints by `[decimal]$_.pricing.prompt` ascending; take the first. Report provider name, in/out per 1M, discount %, quantization, per-route context length, and endpoint count.
3. Recipe B — Hugging Face card and file sizes (known-good):
   - Card/tags: `https://huggingface.co/api/models/<repo>` (downloads, tags, license).
   - Sizes in one call: `https://huggingface.co/api/models/<repo>?blobs=true`; read `siblings[].size`. Never call the tree API per file (`/tree/main/<file>` errors like `.gitattributes does not exist on "main"` flood the output and yield 0 GB). Never probe `/resolve/...` with HEAD.
4. Recipe C — HF GGUF discovery (known-good):
   - `https://huggingface.co/api/models?search=<query>&limit=5`; verify the chosen repo via Recipe B.
5. Sanity gates — stop and re-fetch, never score, when:
   - Any price prints empty or shows `/M` with no number (formatting failure, not data).
   - All sizes print `0 GB` for a repo that advertises GGUF (probe failure, not data).
   - Only base-model pricing was used for a price comparison (endpoints sweep missing).
   - A hosted candidate's cheapest-route context length was not recorded (route context can be 4x smaller than base API context).
6. Gated HF repos (e.g. Gemma): detect the license-acceptance gate from the model card (`license:` tag) and record the gate as a risk. Do not treat a 401 from `/resolve` as "no downloadable artifact" — the HF API with `?blobs=true` still proves the artifacts exist.

## Current TFlex baseline discovery

Read the model fields from the agent definitions instead of assuming them. As a cross-check, the current expected baselines are:

| Agent | Current expected endpoint |
| --- | --- |
| `backend-dev` | `openrouter/z-ai/glm-5.2` |
| `frontend-dev` | `openrouter/minimax/minimax-m3:free` |
| `qa` | `openrouter/google/gemini-3-flash-preview` |
| `adversary` | `openrouter/deepseek/deepseek-v4-flash` |
| `git-agent` | `openrouter/z-ai/glm-5.3-flash` |

If an agent file differs, the agent file wins and the report must call out the difference.

Exclude `orchestrator.md` from the candidate comparison except to enforce the reserved-orchestrator-model rule.

## Candidate filtering

Start with the union of OpenRouter discounted and free collection models plus Hugging Face local models that are plausibly comparable to them. Remove candidates that fail any applicable hard gate:

- OpenRouter candidate is not present in `https://openrouter.ai/api/v1/models`.
- Hugging Face candidate has no verifiable model card, downloadable weights, or usable text-generation format.
- Wrong modality for the role.
- No usable text output for a coding, QA, adversarial, or git sub-agent.
- Insufficient context for the role.
- Missing reliable tool/function-calling support where the role requires it.
- Explicitly unsuitable for agentic coding or long-horizon tasks in provider notes.
- Known account data-policy incompatibility for this operator, when documented in `AGENTS_NOTES.md`.
- Alias-only or redirect-only model where no canonical project endpoint can be resolved.
- Non-text generators such as video, audio, speech, embedding, or reranking models unless the user explicitly asks to evaluate them for another purpose.
- Base `/api/v1/models` pricing is default-route pricing only. Every hosted comparison must use the cheapest-route price from the endpoints API (`/api/v1/models/<id>/endpoints`), and must record per-route context length and provider count as reliability evidence.

Free OpenRouter candidates need an additional reliability note: check whether the free route has tighter rate limits, data retention/training terms, reduced context compared with the paid route, or provider restrictions. A free model is not automatically the winner if it risks repeated failed attempts or blocked dispatches.

## Local model hardware assessment

The operator's local machine is:

- CPU: AMD Ryzen 9 5950X, 16 cores / 32 threads.
- RAM: 64GB DDR4 CL16 3600MHz.
- GPU: NVIDIA RTX 4090 with 24GB VRAM.
- Storage: 3TB SSD.

Use these practical fit rules for local recommendations:

- Prefer models that fit comfortably in the RTX 4090's 24GB VRAM at a usable context length.
- Full-GPU candidates should normally be 7B-14B dense models at common 4-bit/8-bit quantizations, or MoE models whose active and resident weights fit the selected runner's memory model.
- 20B-35B dense models may work only at aggressive quantization or reduced context; mark them as conditional and state the expected trade-off.
- Models requiring more than 24GB VRAM may still be listed as CPU/RAM offload options, but mark them as slow or high-risk unless their MoE architecture and quantization make them practical.
- Do not recommend models whose full-precision weights clearly exceed combined practical system capacity, even if disk space is sufficient.
- Disk usage is usually not the limiting factor with 3TB SSD, but state the download size anyway.
- Consider KV-cache memory separately from weight memory; long context can exceed VRAM even when the weights fit.
- Prefer GGUF for llama.cpp/LM Studio/Ollama compatibility, EXL2/GPTQ/AWQ for GPU-first runners, and safetensors only when a mainstream runtime supports the model well on Windows.

For each local candidate, report:

- Parameter count and active parameter count when applicable.
- Architecture and whether it is dense or MoE.
- Available quantization formats and the specific recommended file/repository.
- Download size for the recommended quantization.
- Estimated VRAM requirement at the recommended context.
- Estimated RAM requirement if CPU/RAM offload is required.
- Expected speed class on an RTX 4090: `fast`, `usable`, `slow`, or `not practical`.
- Maximum practical context on this hardware, if evidence supports it.
- Download link to the Hugging Face repository or exact file.
- Suggested runner and OpenCode provider configuration approach.

## OpenCode local-provider endpoint format

OpenRouter endpoint format remains:

```text
openrouter/<canonical-openrouter-model-id>
```

For local models, do not invent an OpenRouter endpoint. Recommend a local OpenAI-compatible provider only if the runner supports tool calling and OpenCode can be configured to use it. Report both:

- The Hugging Face model/download link.
- The suggested OpenCode model/provider configuration name, marked `needs local provider setup` until verified on the machine.

If the local route cannot meet OpenCode tool-calling or provider requirements, mark it `not currently recommendable as a direct sub-agent replacement` even if the raw model is strong.

## Role capability gates

Use these minimum gates unless the human supplies different weights:

### backend-dev

- Strong long-horizon coding and tool use.
- Multi-file TypeScript/Electron/main-process reasoning.
- Reliable test failure diagnosis and minimal diffs.
- Prefer context >= 200K; strong candidates should support 1M or demonstrate clear long-context design.
- Must not be a vision-only, reranking, embedding, or media-generation model.

### frontend-dev

- Strong React/TypeScript/UI implementation and debugging.
- Strong tool use, code editing, and unit-test repair.
- Vision is useful for screenshot-driven UI work, but not mandatory if the orchestrator/qa supplies observations.
- Prefer context >= 200K.

### qa

- Strong screenshot/visual inspection ability.
- Reliable Playwright/e2e reasoning and structured ledger formatting.
- Vision/multimodal input is strongly preferred; text-only candidates must be marked high-risk for screenshot review.
- Prefer context >= 200K.

### adversary

- Strong exploratory reasoning, hostile-input generation, edge-case analysis, and concise structured reporting.
- Vision is useful for screenshots but less critical than for qa.
- Prefer context >= 200K.

### git-agent

- Reliable command planning, shell/git output interpretation, release-pipeline verification, and conservative instruction following.
- Coding-model quality is useful but less important than precision and low cost.
- Prefer context >= 100K.

## Cost calculations

Use the OpenRouter API's `pricing.prompt` and `pricing.completion` values as the source of truth. Normalize every candidate and every current model to dollars per one million tokens:

- `input_cost_per_million = prompt_price_per_token * 1,000,000`
- `output_cost_per_million = completion_price_per_token * 1,000,000`

For each role and candidate, report at least these workload estimates:

- Light task: 20K input + 5K output.
- Typical sub-agent task: 100K input + 20K output.
- Long-horizon task: 500K input + 100K output.

Formula:

```text
estimated_cost_usd =
  (input_tokens / 1,000,000 * input_cost_per_million) +
  (output_tokens / 1,000,000 * output_cost_per_million)
```

Also report a blended rate for quick sorting:

```text
blended_cost_per_million =
  (0.8 * input_cost_per_million) + (0.2 * output_cost_per_million)
```

State the 80/20 assumption when using the blended rate. If cached input pricing, request pricing, image pricing, or other non-token pricing materially affects a role, mention it separately rather than hiding it in the blended rate.

## Capability scoring

Use a transparent 100-point score after hard gates:

- 30 points: role fit and demonstrated agentic/tool-use capability.
- 20 points: coding or task-domain strength relevant to the role.
- 15 points: context window and long-horizon suitability.
- 10 points: modality fit, especially vision for qa.
- 10 points: provider/OpenRouter reliability signals, route availability, rate-limit risk, and data-policy fit.
- 10 points: reasoning controls, structured output support, output length, and instruction-following evidence.
- 5 points: operational maturity, usage volume, and documentation clarity.

Score only from fetched evidence. If evidence is missing, do not invent a score; mark the category `unknown` and explain the risk.

## Selection policy

Recommend the most cost-effective capable model, not merely the cheapest:

1. Apply hard gates.
2. Rank remaining candidates by role-specific capability score.
3. Exclude any candidate whose capability score is too low for safe production use; use 70/100 as the default minimum unless the human asks for a more aggressive cost cut.
4. Among capable candidates, rank by blended cost and typical-task cost.
5. Prefer a paid low-cost model over a free model when the free model has material rate-limit, privacy, route-stability, or data-policy risk.
6. Prefer the current model when a cheaper candidate is only marginally cheaper but materially less capable or less reliable.
7. Prefer a single shared replacement only when it fits every selected role; otherwise give role-specific winners.

## Local replacement trade-off analysis

For every local model suggested as a replacement, compare it directly against the role's current OpenRouter model and the best shortlisted hosted replacement. Include:

- Capability pros: privacy, no per-token API bill, offline operation, large local context where practical, no provider rate limit, and model/license transparency.
- Capability cons: weaker benchmark performance, reduced tool-calling reliability, smaller effective context after KV-cache pressure, slower iteration, lack of hosted routing/fallbacks, or missing vision support.
- Operational pros: no OpenRouter data-policy exposure, predictable marginal cost, reusable local runtime.
- Operational cons: setup time, runner maintenance, GPU contention with TFlex/Playwright, power/thermal load, local model updates, and possible provider-configuration work.
- Economic comparison: hosted token cost versus local electricity/runtime cost. Do not claim local inference is exactly free; label it `near-zero marginal token cost after hardware ownership` and note electricity and time costs.
- Reliability verdict: `direct replacement`, `pilot first`, `fallback/offline option`, or `not recommended`.

Only recommend a local model as a direct replacement if it plausibly passes the same role capability gates, runs reliably on the listed hardware, supports the required tool-calling workflow, and has a concrete downloadable artifact.

## Endpoint format

For OpenCode agent definitions, the endpoint format is:

```text
openrouter/<canonical-openrouter-model-id>
```

Examples:

- API model ID `z-ai/glm-5.2:free` -> project endpoint `openrouter/z-ai/glm-5.2:free`
- API model ID `deepseek/deepseek-v4-pro` -> project endpoint `openrouter/deepseek/deepseek-v4-pro`

Rules:

- Preserve suffixes such as `:free` and `:batch` exactly.
- Do not include `https://openrouter.ai/` in the agent endpoint.
- Do not use display names as endpoints.
- Do not construct endpoints from collection-page titles.
- Resolve `~` or latest/redirect links to a canonical API model ID before recommending them.
- Verify the final endpoint by finding the exact model ID in the model API response.

## Suggestions must compare price and capability

Every recommendation must be justified with a direct price-versus-capability comparison. Do not give a bare list of endpoints. For each role, show:

- The current model's endpoint, price, capability score, and key strengths or weaknesses.
- Each shortlisted replacement's endpoint, price, capability score, and key strengths or weaknesses.
- Whether the replacement is cheaper and weaker, cheaper and comparable, cheaper and stronger, or not worth changing.
- The expected dollar difference for the typical sub-agent task and long-horizon task.
- A final `Recommended endpoint` line only after the comparison has made the trade-off explicit.

Use `same`, `better`, `worse`, or `unknown` for capability deltas; use exact dollar amounts or percentages for cost deltas. If capability evidence is unavailable, say `unknown` and lower confidence instead of guessing.

## Required report format

Produce the report in this order:

```markdown
# OpenRouter sub-agent model recommendation

- Run date:
- Sources checked:
- Discounted collection status:
- Free collection status:
- Baselines read from agent files:

## Executive recommendation

| Agent | Current endpoint | Recommended endpoint | Capability delta | Cost delta | Verdict | Typical task cost | Est. savings |
| --- | --- | --- | --- | ---: | --- | ---: | ---: |

## Price and capability comparison

| Agent | Current endpoint | Current capability | Current price in/out per 1M | Suggested hosted endpoint | Suggested hosted capability | Suggested hosted price in/out per 1M | Suggested local model | Local hardware fit | Price comparison | Capability comparison | Recommendation |
| --- | --- | --- | ---: | --- | --- | ---: | --- | --- | --- | --- | --- |

## Local Hugging Face model comparison

| Agent | Local model | Download link | Parameters | Recommended format/file | Download size | VRAM/RAM fit | Context fit | Runner | Pros vs current | Cons vs current | Verdict |
| --- | --- | --- | ---: | --- | ---: | --- | --- | --- | --- | --- | --- |

## Candidate shortlist

| Candidate endpoint | Price in/out per 1M | Discount/free status | Context | Modalities | Role fit | Capability score | Key risks |
| --- | ---: | --- | ---: | --- | --- | ---: | --- |

## Per-agent comparison

### backend-dev

| Endpoint or local model | Type | Capability score | Key capability evidence | Light | Typical | Long-horizon | Hardware fit | Price delta vs current | Capability delta vs current | Recommendation |
| --- | --- | ---: | --- | ---: | ---: | ---: | --- | ---: | --- | --- |

Repeat this section for frontend-dev, qa, adversary, and git-agent. Every suggested endpoint or local model in these sections must compare both price and capability against the agent's current endpoint. For local models, use `local` in the type column and put the Hugging Face download link in the evidence or recommendation text.

## Rejected candidates

| Candidate | Reason rejected |
| --- | --- |

## Suggested agent-definition changes

```yaml
# backend-dev.md
model: openrouter/<canonical-id>
```

Repeat only for agents where a change is recommended.

## Operational notes

- Rate-limit or free-tier concerns:
- Data-policy concerns:
- Local hardware concerns:
- Local runner/tool-calling concerns:
- Model-integrity rule impact:
- AGENTS.md fallback-table impact:
- Suggested rollout order:
```

## Rollout recommendation

When a change is recommended:

1. Recommend one low-risk pilot first, usually `git-agent` or `adversary`, unless a role-specific blocker exists.
2. For hosted OpenRouter changes, advise restarting OpenCode after editing agent definitions because configuration is loaded at startup.
3. For local Hugging Face changes, advise installing and testing the runner first, then verifying tool calling with a small OpenCode session before changing a production sub-agent.
4. Advise the orchestrator to run its model verification probe before real work.
5. Advise recording any human-approved swap in `AGENTS_NOTES.md` with the date, old endpoint, new endpoint or local provider name, and reason.
6. If the proposed model is outside the fallback table in `AGENTS.md`, explicitly say that the human is making a new primary selection rather than an emergency fallback.
7. Keep an OpenRouter fallback ready for local-model rollouts until the local provider has completed at least one real phase task without a tool-calling, context, or reliability failure.
