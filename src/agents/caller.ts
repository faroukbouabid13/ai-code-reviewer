/**
 * agents/caller.ts
 * ─────────────────────────────────────────────────────────────────
 * 5 provider raw callers + smart router.
 *
 * Routing logic:
 *   1. Each agent has a PRIMARY provider (best model for that task)
 *   2. On 429 → walk the FALLBACK_ORDER for that provider
 *   3. Skip providers with no API key configured
 *   4. Fast backoff: 500ms → 1s → 2s → 4s between attempts
 *   5. Only providers with a key are tried — graceful degradation
 *
 * Provider    │ Agents                          │ Why
 * ────────────┼─────────────────────────────────┼─────────────────────────
 * Groq        │ security, tests                 │ Best reasoning + code gen
 * Gemini      │ quality, docs                   │ Structured review + JSDoc
 * Cerebras    │ errorHandling, complexity        │ Fastest inference
 * OpenRouter  │ style, duplication, dependencies│ Already configured, free
 * ─────────────────────────────────────────────────────────────────
 */

import {
  GROQ_URL, GEMINI_URL, CEREBRAS_URL, OPENROUTER_URL, NVIDIA_URL,
  GROQ_MODEL, GEMINI_MODEL, CEREBRAS_MODEL, OPENROUTER_MODEL,
  NVIDIA_MODEL_G1, NVIDIA_MODEL_QUALITY, NVIDIA_MODEL_ERROR,
  NVIDIA_MODEL_G2, NVIDIA_MODEL_G3,
  AGENT_PROVIDER, FALLBACK_ORDER, BACKOFF_MS,
  getGroqKey, getGeminiKey, getCerebrasKey, getOpenRouterKey, getNvidiaKey,
  getAvailableProviders,
} from "../core/config";

// ── Token usage accumulator (reset per analysis run) ─────────────
export interface TokenEntry {
  provider: string; model: string;
  promptTokens: number; completionTokens: number; totalTokens: number;
}
const _tokenLog: TokenEntry[] = [];
export function resetTokenUsage(): void { _tokenLog.length = 0; }
export function getTokenUsage(): TokenEntry[] { return [..._tokenLog]; }

// ── Status updater (injected from analyze.ts) ─────────────────────
let _setStatus: ((text: string, spin?: boolean) => void) | null = null;
export function registerStatusUpdater(fn: (text: string, spin?: boolean) => void) {
  _setStatus = fn;
}
function setStatus(text: string, spin = true) { _setStatus?.(text, spin); }

/* ─────────────────────────────────────────────────────────────────
   RAW CALLERS — one per provider
   ───────────────────────────────────────────────────────────────── */

const FETCH_TIMEOUT_MS = 90_000;

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

async function callGroqRaw(system: string, user: string): Promise<string> {
  const key = getGroqKey();
  if (!key) { throw Object.assign(new Error("Groq key not set"), { status: 401 }); }

  const res = await fetch(GROQ_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    signal:  withTimeout(FETCH_TIMEOUT_MS),
    body: JSON.stringify({
      model:       GROQ_MODEL,
      messages:    [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.1,
      max_tokens:  4000,
    }),
  });
  if (!res.ok) {
    let body = "";
    try { body = await res.text(); } catch {}
    console.error(`[Groq] HTTP ${res.status} — body:`, body);
    throw Object.assign(new Error(`Groq ${res.status}: ${body.slice(0, 200)}`), { status: res.status });
  }
  const groqData = (await res.json()) as any;
  if (groqData.usage) {
    _tokenLog.push({ provider: "groq", model: GROQ_MODEL,
      promptTokens:     groqData.usage.prompt_tokens     ?? 0,
      completionTokens: groqData.usage.completion_tokens ?? 0,
      totalTokens:      groqData.usage.total_tokens      ?? 0,
    });
  }
  return groqData.choices?.[0]?.message?.content ?? "";
}

async function callGeminiRaw(system: string, user: string): Promise<string> {
  const key = getGeminiKey();
  if (!key) { throw Object.assign(new Error("Gemini key not set"), { status: 401 }); }

  const res = await fetch(GEMINI_URL(key), {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    signal:  withTimeout(FETCH_TIMEOUT_MS),
    body: JSON.stringify({
      contents:         [{ parts: [{ text: `${system}\n\n${user}` }] }],
      generationConfig: { maxOutputTokens: 8000, temperature: 0.1 },
    }),
  });
  if (!res.ok) {
    let body = "";
    try { body = await res.text(); } catch {}
    console.error(`[Gemini] HTTP ${res.status} — body:`, body);
    throw Object.assign(new Error(`Gemini ${res.status}: ${body.slice(0, 200)}`), { status: res.status });
  }
  const gemData = (await res.json()) as any;
  if (gemData.usageMetadata) {
    _tokenLog.push({ provider: "gemini", model: GEMINI_MODEL,
      promptTokens:     gemData.usageMetadata.promptTokenCount     ?? 0,
      completionTokens: gemData.usageMetadata.candidatesTokenCount ?? 0,
      totalTokens:      gemData.usageMetadata.totalTokenCount      ?? 0,
    });
  }
  return gemData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

// NVIDIA NIM — OpenAI-compatible API, different model per group → independent 40 RPM each
interface NvidiaOpts {
  temperature?: number;
  top_p?:       number;
  thinkHigh?:   boolean; // deepseek-v4-pro Think High mode
}

async function callNvidiaRaw(system: string, user: string, model: string, opts: NvidiaOpts = {}): Promise<string> {
  const key = getNvidiaKey();
  if (!key) { throw Object.assign(new Error("NVIDIA key not set"), { status: 401 }); }

  const body: Record<string, any> = {
    model,
    messages:    [{ role: "system", content: system }, { role: "user", content: user }],
    temperature: opts.temperature ?? 0.1,
    max_tokens:  8000,
  };
  if (opts.top_p    !== undefined)  { body.top_p = opts.top_p; }
  if (opts.thinkHigh)               { body.chat_template_kwargs = { thinking: true }; }

  const res = await fetch(NVIDIA_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    signal:  withTimeout(FETCH_TIMEOUT_MS),
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    let body = ""; try { body = await res.text(); } catch {}
    console.error(`[NVIDIA/${model}] HTTP ${res.status}:`, body.slice(0, 200));
    throw Object.assign(new Error(`NVIDIA ${res.status}: ${body.slice(0, 200)}`), { status: res.status });
  }
  const nvData = (await res.json()) as any;
  if (nvData.usage) {
    _tokenLog.push({ provider: "nvidia", model,
      promptTokens:     nvData.usage.prompt_tokens     ?? 0,
      completionTokens: nvData.usage.completion_tokens ?? 0,
      totalTokens:      nvData.usage.total_tokens      ?? 0,
    });
  }
  const content = nvData.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) {
    console.warn(`[NVIDIA/${model}] HTTP 200 but empty content — treating as rate limit, triggering fallback`);
    throw Object.assign(new Error("NVIDIA empty response — concurrent limit reached"), { status: 429 });
  }
  return content;
}

async function callCerebrasRaw(system: string, user: string): Promise<string> {
  const key = getCerebrasKey();
  if (!key) { throw Object.assign(new Error("Cerebras key not set"), { status: 401 }); }

  const res = await fetch(CEREBRAS_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    signal:  withTimeout(FETCH_TIMEOUT_MS),
    body: JSON.stringify({
      model:       CEREBRAS_MODEL,
      messages:    [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.1,
      max_tokens:  4000,
    }),
  });
  if (!res.ok) {
    let body = "";
    try { body = await res.text(); } catch {}
    console.error(`[Cerebras] HTTP ${res.status} — body:`, body);
    throw Object.assign(new Error(`Cerebras ${res.status}: ${body.slice(0, 200)}`), { status: res.status });
  }
  const cbData = (await res.json()) as any;
  if (cbData.usage) {
    _tokenLog.push({ provider: "cerebras", model: CEREBRAS_MODEL,
      promptTokens:     cbData.usage.prompt_tokens     ?? 0,
      completionTokens: cbData.usage.completion_tokens ?? 0,
      totalTokens:      cbData.usage.total_tokens      ?? 0,
    });
  }
  return cbData.choices?.[0]?.message?.content ?? "";
}

async function callOpenRouterRaw(system: string, user: string): Promise<string> {
  const key = getOpenRouterKey();
  if (!key) { throw Object.assign(new Error("OpenRouter key not set"), { status: 401 }); }

  const res = await fetch(OPENROUTER_URL, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${key}`,
      "HTTP-Referer":  "https://ai-code-reviewer",
      "X-Title":       "AI Code Reviewer",
    },
    signal:  withTimeout(FETCH_TIMEOUT_MS),
    body: JSON.stringify({
      model:       OPENROUTER_MODEL,
      messages:    [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.1,
      max_tokens:  4000,
    }),
  });
  if (!res.ok) { throw Object.assign(new Error(`OpenRouter ${res.status}`), { status: res.status }); }
  const orData = (await res.json()) as any;
  if (orData.usage) {
    _tokenLog.push({ provider: "openrouter", model: OPENROUTER_MODEL,
      promptTokens:     orData.usage.prompt_tokens     ?? 0,
      completionTokens: orData.usage.completion_tokens ?? 0,
      totalTokens:      orData.usage.total_tokens      ?? 0,
    });
  }
  return orData.choices?.[0]?.message?.content ?? "";
}

// ── Provider dispatch table ───────────────────────────────────────
const PROVIDER_CALLERS: Record<string, (s: string, u: string) => Promise<string>> = {
  groq:       callGroqRaw,
  gemini:     callGeminiRaw,
  cerebras:   callCerebrasRaw,
  openrouter: callOpenRouterRaw,
  // 5 separate NVIDIA NIM entries — each model has its own 40 RPM queue
  nvidia:   (s, u) => callNvidiaRaw(s, u, NVIDIA_MODEL_G1),   // no Think High — avoids 90s timeout on free tier
  nvidiaQ:  (s, u) => callNvidiaRaw(s, u, NVIDIA_MODEL_QUALITY),
  nvidiaE:  (s, u) => callNvidiaRaw(s, u, NVIDIA_MODEL_ERROR),
  nvidia2:  (s, u) => callNvidiaRaw(s, u, NVIDIA_MODEL_G2),
  nvidia3:  (s, u) => callNvidiaRaw(s, u, NVIDIA_MODEL_G3),
};

/* ─────────────────────────────────────────────────────────────────
   SMART AGENT CALLER
   ───────────────────────────────────────────────────────────────── */

export async function callAgent(
  system:    string,
  user:      string,
  agentName: string,
): Promise<string> {

  const available = getAvailableProviders();
  if (available.length === 0) {
    throw new Error("No API keys configured. Set at least groqApiKey or geminiApiKey.");
  }

  // Get primary provider for this agent; fall back to first available
  const preferredPrimary = AGENT_PROVIDER[agentName] ?? "groq";
  const primary = available.includes(preferredPrimary)
    ? preferredPrimary
    : available[0];

  // Build full attempt sequence: primary → fallbacks (skip missing keys)
  const fallbackChain = (FALLBACK_ORDER[primary] ?? [])
    .filter(p => available.includes(p));
  const sequence = [primary, ...fallbackChain];

  let lastError: any;

  for (let attempt = 0; attempt < sequence.length; attempt++) {
    const provider = sequence[attempt];
    const caller   = PROVIDER_CALLERS[provider];

    try {
      const result = await caller(system, user);

      if (attempt > 0) {
        console.log(`[${agentName}] Recovered on ${provider} (attempt ${attempt + 1})`);
      }
      return result;

    } catch (err: any) {
      lastError = err;

      // 401 = wrong key, 404 = model not found/no access — both mean this provider won't work, skip
      const isSkip    = err?.status === 401
                     || err?.status === 404
                     || String(err?.message ?? "").toLowerCase().includes("not found")
                     || String(err?.message ?? "").toLowerCase().includes("model_not_found");
      const is429     = !isSkip && (
                        err?.status === 429
                     || err?.status === 503   // service unavailable — transient, treat same as rate limit
                     || err?.status === 529   // Anthropic/some providers: overloaded
                     || String(err?.message ?? "").toLowerCase().includes("rate")
                     || String(err?.message ?? "").toLowerCase().includes("unavailable")
                     || String(err?.message ?? "").toLowerCase().includes("overloaded"));
      const isTimeout = err?.name === "TimeoutError"
                     || err?.name === "AbortError"
                     || err?.cause?.name === "AbortError"    // Node.js wraps AbortError as TypeError("fetch failed")
                     || String(err?.message ?? "").toLowerCase().includes("timeout")
                     || String(err?.message ?? "").toLowerCase().includes("fetch failed");

      // Wrong key or model not accessible → skip this provider entirely, no delay
      if (isSkip) {
        console.warn(`[${agentName}] Skipping ${provider} (${err?.status ?? "no-access"}): ${String(err?.message ?? "").slice(0, 80)}`);
        continue;
      }

      // Rate limit or timeout → try next provider in fallback chain
      if (is429 || isTimeout) {
        const delay = isTimeout ? 0 : BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
        const next  = sequence[attempt + 1] ?? "none";
        const reason = isTimeout ? "timeout" : "rate limit";
        setStatus(`[${agentName}] ${reason} on ${provider} → ${next}…`);
        console.warn(`[${agentName}] ${reason} on ${provider} → ${next}`);
        if (delay > 0) { await new Promise(r => setTimeout(r, delay)); }
        continue;
      }

      // Non-recoverable error (network, malformed response) → fail fast
      console.error(`[${agentName}] Non-recoverable error on ${provider}:`, err?.message);
      throw err;
    }
  }

  throw new Error(
    `[${agentName}] All ${sequence.length} providers exhausted. Last: ${lastError?.message}`
  );
}