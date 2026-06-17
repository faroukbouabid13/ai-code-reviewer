import { cosineSimilarity } from "./embeddings";
import type { TemplateMatch } from "../pipeline/types";

export interface Template {
  id:          string;
  name:        string;
  description: string;
  tags:        string[];
  code:        string;
  embedding?:  number[];
}

export const TEMPLATES: Template[] = [
  { id:"tpl-001", name:"Array transform with map",       description:"Prefer Array.map() over manual for-loops",           tags:["array","performance"],   code:`function transformItems(items, fn) { return items.map(fn); }` },
  { id:"tpl-002", name:"Async with error handling",      description:"Always wrap async calls in try/catch",               tags:["async","error"],         code:`async function fetchData(url) {\n  try {\n    const res = await fetch(url);\n    if (!res.ok) throw new Error("HTTP " + res.status);\n    return await res.json();\n  } catch (e) { console.error(e); return null; }\n}` },
  { id:"tpl-003", name:"Guard clauses over nested if",   description:"Use early returns to reduce nesting",                tags:["readability"],           code:`function process(user) {\n  if (!user) return null;\n  if (!user.email) return null;\n  return user.name;\n}` },
  { id:"tpl-004", name:"Filter and map chain",           description:"Use filter/map instead of manual loops",             tags:["array","functional"],    code:`function getActiveNames(users) { return users.filter(u => u.active).map(u => u.name); }` },
  { id:"tpl-005", name:"Promise.all for parallel async", description:"Run independent calls in parallel",                  tags:["async","performance"],   code:`async function loadAll(id) { const [a, b] = await Promise.all([fetchA(id), fetchB(id)]); return { a, b }; }` },
  { id:"tpl-006", name:"Reduce for accumulation",        description:"Use reduce instead of manual accumulator loops",     tags:["array","functional"],    code:`function sumAmounts(orders) { return orders.reduce((total, o) => total + o.amount, 0); }` },
  { id:"tpl-007", name:"Nullish coalescing over OR",     description:"Use ?? instead of || for null safety",               tags:["null-safety"],           code:`function getTimeout(config) { return config.timeout ?? 3000; }` },
  { id:"tpl-008", name:"Method chaining for strings",    description:"Chain string methods instead of step-by-step vars",  tags:["readability","strings"], code:`function slugify(title) { return title.toLowerCase().trim().replace(/\s+/g, "-"); }` },
];

export function templateSearch(queryVector: number[], limit = 3): TemplateMatch[] {
  return TEMPLATES
    .filter(t => t.embedding?.length)
    .map(t => ({
      name:       t.name,
      similarity: cosineSimilarity(queryVector, t.embedding!),
      code:       t.code,
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}