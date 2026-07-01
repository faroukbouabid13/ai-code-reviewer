import * as vscode from "vscode";

// ── API endpoints ──────────────────────────────────────────────────
export const GROQ_URL        = "https://api.groq.com/openai/v1/chat/completions";
export const GEMINI_URL      = (key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
export const CEREBRAS_URL    = "https://api.cerebras.ai/v1/chat/completions";
export const NVIDIA_URL      = "https://integrate.api.nvidia.com/v1/chat/completions";
export const OPENROUTER_URL  = "https://openrouter.ai/api/v1/chat/completions";
export const SAMBANOVA_URL   = "https://api.sambanova.ai/v1/chat/completions";
export const ANTHROPIC_URL   = "https://api.anthropic.com/v1/messages";

// ── Provider → Agent assignments (what runs where) ────────────────
// Security     → Groq    deepseek-r1-distill-llama-70b  30 RPM / 1K RPD  (reasoning)
// Quality      → Gemini  gemini-2.5-flash                10 RPM / 1.5K RPD / 1M TPM  (balanced)
// Error        → Cerebras llama3.3-70b                   30 RPM / unlimited RPD / 60K TPM  (fastest)
// Group 2      → NVIDIA  devstral-2                       40 RPM  (code-focused)
// Group 3      → NVIDIA  llama-4-maverick                 40 RPM  (balanced)
export const NVIDIA_MODEL_G2       = "meta/llama-3.3-70b-instruct";          // devstral-small-2505 unavailable on this account; llama-3.3-70b confirmed working
export const NVIDIA_MODEL_G3       = "meta/llama-4-maverick-17b-128e-instruct";
export const NVIDIA_MODEL_G1       = "mistralai/devstral-small-2505";
export const NVIDIA_MODEL_QUALITY  = "meta/llama-4-maverick-17b-128e-instruct";
export const NVIDIA_MODEL_ERROR    = "deepseek-ai/deepseek-v4-pro";          // error handling agent
export const OPENROUTER_EMBED      = "https://openrouter.ai/api/v1/embeddings";

// ── Model identifiers ──────────────────────────────────────────────
export const GROQ_MODEL       = "llama-3.3-70b-versatile";                  // security (deepseek-r1-distill decommissioned on Groq)
export const GEMINI_MODEL     = "gemini-2.5-flash";                          // quality: balanced
export const CEREBRAS_MODEL   = "gemma-4-31b";                               // confirmed available on this Cerebras account
export const OPENROUTER_MODEL = "meta-llama/llama-3.3-70b-instruct:free";
export const SAMBANOVA_MODEL  = "Meta-Llama-3.3-70B-Instruct";               // SambaNova — same Llama 3.3 70B, fast RDU inference
export const EMBED_MODEL      = "openai/text-embedding-3-small";
export const CLAUDE_MODEL     = "claude-haiku-4-5-20251001";                 // security: fast + affordable

// ── Per-agent provider assignment ─────────────────────────────────
export const AGENT_PROVIDER: Record<string, string> = {
  security:      "groq",      // llama-3.3-70b-versatile        — confirmed working
  quality:       "gemini",    // gemini-2.5-flash               — balanced, 1M TPM (503→falls back to Groq)
  errorHandling: "nvidiaE",   // deepseek-ai/deepseek-v4-pro    — NVIDIA NIM
  style:         "nvidia2",   // devstral-2                     — code-focused (G2, runs alone first)
  complexity:    "nvidia2",
  duplication:   "nvidia2",
  docs:          "nvidia3",   // llama-4-maverick               — balanced (G3)
  tests:         "nvidia3",
  dependencies:  "nvidia3",
  synthesis:        "cerebras",   // Final refactor — incorporates all 9 agent findings
  debateStrict:     "cerebras",   // Agent A — Strict Senior Engineer (grey-zone scores 4-7 only)
  debatePragmatic:  "gemini",     // Agent B — Pragmatic Developer    (grey-zone scores 4-7 only)
};

// ── Fallback order per provider ────────────────────────────────────
export const FALLBACK_ORDER: Record<string, string[]> = {
  claude:     ["groq", "cerebras", "gemini"],
  groq:       ["cerebras", "sambanova", "gemini"],
  gemini:     ["cerebras", "nvidia3"],
  cerebras:   ["groq", "gemini"],
  nvidia2:    ["groq", "cerebras", "gemini"],
  nvidia3:    ["groq", "cerebras", "gemini"],
  nvidia:     ["groq", "cerebras", "gemini"],
  nvidiaQ:    ["gemini", "groq", "cerebras"],
  nvidiaE:    ["groq", "gemini"],
};

// ── Fast backoff (ms) ──────────────────────────────────────────────
export const BACKOFF_MS = [1000, 2000, 4000, 8000];

// ── Filesystem ────────────────────────────────────────────────────
export const HISTORY_DIR  = ".ai-reviewer";
export const HISTORY_FILE = "history.jsonl";
export const SCORES_FILE  = "scores.jsonl";
export const DIFF_REVIEW_FILE = "last-analysis.json";
export const LANCEDB_DIR  = "vector-store";
export const TABLE_NAME   = "functions";
export const EMPTY_TREE   = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

// ── Limits ────────────────────────────────────────────────────────
export const VECTOR_DIM    = 1536;
export const CACHE_TTL_MS  = 60 * 60 * 1000;
export const MAX_FUNCTIONS = 4;

// ── Supported languages ───────────────────────────────────────────
export const SUPPORTED_LANGUAGES = new Set([
  "typescript", "javascript", "typescriptreact", "javascriptreact",
  "python", "java", "go",
]);

// ── Key cache (populated from SecretStorage at activation) ───────
const _keyCache = new Map<string, string>();

export async function initKeyCache(secrets: vscode.SecretStorage): Promise<void> {
  const keys: [string, string][] = [
    ["groqApiKey",       "aiReviewer.groqApiKey"],
    ["geminiApiKey",     "aiReviewer.geminiApiKey"],
    ["nvidiaApiKey",     "aiReviewer.nvidiaApiKey"],
    ["cerebrasApiKey",   "aiReviewer.cerebrasApiKey"],
    ["sambanovaApiKey",  "aiReviewer.sambanovaApiKey"],
  ];
  await Promise.all(keys.map(async ([local, secretKey]) => {
    const val = await secrets.get(secretKey);
    if (val) { _keyCache.set(local, val); }
  }));
}

export function setCachedKey(localKey: string, value: string): void {
  if (value) { _keyCache.set(localKey, value); }
  else        { _keyCache.delete(localKey); }
}

// ── API key accessors — SecretStorage cache first, settings fallback ──
const cfg = () => vscode.workspace.getConfiguration("aiReviewer");
const k = (local: string, cfgKey: string) =>
  _keyCache.get(local) || cfg().get<string>(cfgKey) || "";

export const getNvidiaKey     = () => k("nvidiaApiKey",     "nvidiaApiKey");
export const getGroqKey       = () => k("groqApiKey",       "groqApiKey");
export const getGeminiKey     = () => k("geminiApiKey",     "geminiApiKey");
export const getCerebrasKey   = () => k("cerebrasApiKey",   "cerebrasApiKey");
export const getOpenRouterKey = () => k("openrouterApiKey", "openrouterApiKey");
export const getSambanovaKey  = () => k("sambanovaApiKey",  "sambanovaApiKey");
export const getGithubToken   = () => cfg().get<string>("githubToken") ?? "";
export const getAnthropicKey  = () => k("anthropicApiKey",  "anthropicApiKey");
export const getEmbedKey      = () => getOpenRouterKey() || getGroqKey();

// ── Key availability check ─────────────────────────────────────────
export function getAvailableProviders(): string[] {
  const available: string[] = [];
  if (getNvidiaKey())     { available.push("nvidia", "nvidiaQ", "nvidiaE", "nvidia2", "nvidia3"); }
  if (getGroqKey())       { available.push("groq");       }
  if (getGeminiKey())     { available.push("gemini");     }
  if (getCerebrasKey())   { available.push("cerebras");   }
  if (getOpenRouterKey()) { available.push("openrouter"); }
  if (getSambanovaKey())  { available.push("sambanova");  }
  if (getAnthropicKey())  { available.push("claude");     }
  return available;
}