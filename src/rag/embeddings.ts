import { OPENROUTER_EMBED, EMBED_MODEL, getEmbedKey, getGroqKey } from "../core/config";

export async function getEmbedding(code: string): Promise<number[] | null> {
  try {
    const apiKey = getEmbedKey() || getGroqKey();
    if (!apiKey) { return null; }

    const res = await fetch(OPENROUTER_EMBED, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer":  "https://ai-code-reviewer",
        "X-Title":       "AI Code Reviewer",
      },
      body: JSON.stringify({ model: EMBED_MODEL, input: code }),
    });

    if (!res.ok) { throw new Error(`Embed ${res.status}`); }
    return ((await res.json()) as any).data?.[0]?.embedding ?? null;
  } catch (e: any) {
    console.error("[embeddings]", e.message);
    return null;
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) { return 0; }
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}