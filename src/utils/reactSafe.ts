
type AnyObj = Record<string, any>;

function isPlainObject(v: any): v is AnyObj {
  return v != null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
}

function safeStableStringify(v: any, maxLen = 250): string {
  try {
    const s = JSON.stringify(v, Object.keys(v || {}).sort());
    return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
  } catch {
    return String(v);
  }
}

export function toReactText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();

  if (isPlainObject(value)) {
    // common shapes that have been crashing due to LLM object return instead of string
    if ("region" in value && "insight" in value) {
      console.warn(`[REACT_SAFE][COERCE] keys=region,insight`);
      return `${String(value.region ?? "")}: ${String(value.insight ?? "")}`.trim();
    }
    if ("topic" in value && "format" in value) {
      console.warn(`[REACT_SAFE][COERCE] keys=topic,format`);
      return `${String(value.topic ?? "")} (${String(value.format ?? "")})`.trim();
    }
    if ("angle" in value && "reason" in value) {
      console.warn(`[REACT_SAFE][COERCE] keys=angle,reason`);
      return `${String(value.angle ?? "")}: ${String(value.reason ?? "")}`.trim();
    }
    // generic label/value fallback often seen in charts/stats
    if ("label" in value && "value" in value) {
       return `${String(value.label)}: ${String(value.value)}`;
    }
    return safeStableStringify(value);
  }

  if (Array.isArray(value)) return value.map(toReactText).join(", ");
  return String(value);
}

export function normalizeStringArray(input: unknown): string[] {
  if (Array.isArray(input)) return input.map(toReactText).filter(Boolean);
  if (input == null) return [];
  const s = toReactText(input);
  return s ? [s] : [];
}

export function normalizePlaybookResult(raw: any): any {
  if (!raw || typeof raw !== "object") return raw;
  const out = { ...raw };
  if ("positioning" in out) out.positioning = normalizeStringArray(out.positioning);
  if ("messaging_pillars" in out) out.messaging_pillars = normalizeStringArray(out.messaging_pillars);
  if ("content_plan" in out) out.content_plan = normalizeStringArray(out.content_plan);
  if ("creativeAngles" in out) out.creativeAngles = normalizeStringArray(out.creativeAngles);
  
  // Normalize action plan arrays if present
  if (out.action_plan_30_60_90 && typeof out.action_plan_30_60_90 === 'object') {
      const plan = { ...out.action_plan_30_60_90 };
      if (plan.day30) plan.day30 = normalizeStringArray(plan.day30);
      if (plan.day60) plan.day60 = normalizeStringArray(plan.day60);
      if (plan.day90) plan.day90 = normalizeStringArray(plan.day90);
      out.action_plan_30_60_90 = plan;
  }
  
  return out;
}

export function normalizeDeepDiveDTO(raw: any): any {
  if (!raw || typeof raw !== "object") return raw;
  const out = { ...raw };
  const listFields = [
    "insights",
    "opportunities",
    "risks",
    "recommendations",
    "key_findings",
    "signals_summary",
    "demand_summary",
  ];
  for (const f of listFields) {
    if (f in out) out[f] = normalizeStringArray(out[f]);
  }
  return out;
}

export function assertReactSafeVM(vm: any) {
  const unsafe: Array<{ path: string; keys?: string[] }> = [];
  const checkArray = (path: string, v: any) => {
    if (!Array.isArray(v)) return;
    v.forEach((item, i) => {
      if (isPlainObject(item)) unsafe.push({ path: `${path}[${i}]`, keys: Object.keys(item) });
    });
  };

  if (vm && typeof vm === "object") {
    checkArray("positioning", (vm as any).positioning);
    checkArray("messaging_pillars", (vm as any).messaging_pillars);
    checkArray("content_plan", (vm as any).content_plan);
    checkArray("creativeAngles", (vm as any).creativeAngles);
  }
  return { ok: unsafe.length === 0, unsafe };
}
