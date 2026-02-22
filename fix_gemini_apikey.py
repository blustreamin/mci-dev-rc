#!/usr/bin/env python3
"""
FIX: Gemini API key not resolving in browser (Vite)

Problem: geminiService.ts and consumerNeedsSynthesisService.ts use process.env.API_KEY
which is undefined in Vite browser builds. Only VITE_ prefixed vars work via import.meta.env.

Solution: Use the same getApiKey() pattern from demandInsightsService.ts that checks
both process.env AND import.meta.env.VITE_GOOGLE_API_KEY.
"""
import re

# ============================================================
# FIX 1: geminiService.ts
# ============================================================
print("=== FIX 1: geminiService.ts ===")
path = 'src/services/geminiService.ts'
with open(path, 'r') as f:
    content = f.read()

old_getai = """const safeProcess = (typeof process !== 'undefined' && process && process.env) 
    ? process 
    : { env: {} as Record<string, string | undefined> };

const FAST_MODEL = 'gemini-3-flash-preview'; 
const THINKING_MODEL = 'gemini-3-pro-preview';
const IMAGE_MODEL = 'gemini-2.5-flash-image';
const LITE_MODEL = 'gemini-flash-lite-latest';

function getAI() {
  const apiKey = safeProcess.env.API_KEY;
  if (!apiKey) throw new Error("API Key missing. Please set process.env.API_KEY.");
  return new GoogleGenAI({ apiKey });
}"""

new_getai = """const safeProcess = (typeof process !== 'undefined' && process && process.env) 
    ? process 
    : { env: {} as Record<string, string | undefined> };

const FAST_MODEL = 'gemini-3-flash-preview'; 
const THINKING_MODEL = 'gemini-3-pro-preview';
const IMAGE_MODEL = 'gemini-2.5-flash-image';
const LITE_MODEL = 'gemini-flash-lite-latest';

function getApiKey(): string | undefined {
    // 1. Process Env (Node/Build-time)
    if (safeProcess.env.API_KEY) return safeProcess.env.API_KEY;
    // 2. Vite Import Meta (Browser)
    try {
        // @ts-ignore
        if (import.meta && import.meta.env) {
            // @ts-ignore
            if (import.meta.env.VITE_GOOGLE_API_KEY) return import.meta.env.VITE_GOOGLE_API_KEY;
            // @ts-ignore
            if (import.meta.env.VITE_GEMINI_API_KEY) return import.meta.env.VITE_GEMINI_API_KEY;
            // @ts-ignore
            if (import.meta.env.API_KEY) return import.meta.env.API_KEY;
        }
    } catch (e) {}
    return undefined;
}

function getAI() {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API Key missing. Set VITE_GOOGLE_API_KEY in Vercel env vars.");
  return new GoogleGenAI({ apiKey });
}"""

if old_getai in content:
    content = content.replace(old_getai, new_getai)
    with open(path, 'w') as f:
        f.write(content)
    print("  OK: Fixed getAI() to use import.meta.env")
else:
    print("  SKIP: Pattern not found exactly")

# ============================================================
# FIX 2: consumerNeedsSynthesisService.ts
# ============================================================
print("\n=== FIX 2: consumerNeedsSynthesisService.ts ===")
path2 = 'src/services/consumerNeedsSynthesisService.ts'
with open(path2, 'r') as f:
    content2 = f.read()

old_getai2 = """const safeProcess = (typeof process !== 'undefined' && process && process.env) 
    ? process 
    : { env: {} as Record<string, string | undefined> };

function getAI() {
  const apiKey = safeProcess.env.API_KEY;
  if (!apiKey) throw new Error("API Key missing");
  return new GoogleGenAI({ apiKey });
}"""

new_getai2 = """const safeProcess = (typeof process !== 'undefined' && process && process.env) 
    ? process 
    : { env: {} as Record<string, string | undefined> };

function getApiKey(): string | undefined {
    if (safeProcess.env.API_KEY) return safeProcess.env.API_KEY;
    try {
        // @ts-ignore
        if (import.meta && import.meta.env) {
            // @ts-ignore
            if (import.meta.env.VITE_GOOGLE_API_KEY) return import.meta.env.VITE_GOOGLE_API_KEY;
            // @ts-ignore
            if (import.meta.env.VITE_GEMINI_API_KEY) return import.meta.env.VITE_GEMINI_API_KEY;
            // @ts-ignore
            if (import.meta.env.API_KEY) return import.meta.env.API_KEY;
        }
    } catch (e) {}
    return undefined;
}

function getAI() {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API Key missing. Set VITE_GOOGLE_API_KEY in Vercel env vars.");
  return new GoogleGenAI({ apiKey });
}"""

if old_getai2 in content2:
    content2 = content2.replace(old_getai2, new_getai2)
    with open(path2, 'w') as f:
        f.write(content2)
    print("  OK: Fixed getAI() to use import.meta.env")
else:
    print("  SKIP: Pattern not found exactly")

# ============================================================
# FIX 3: deepDiveServiceV2.ts (same issue)
# ============================================================
print("\n=== FIX 3: deepDiveServiceV2.ts ===")
path3 = 'src/services/deepDiveServiceV2.ts'
with open(path3, 'r') as f:
    content3 = f.read()

old_getai3 = """const safeProcess = (typeof process !== 'undefined' && process && process.env) 
    ? process 
    : { env: {} as Record<string, string | undefined> };

function getAI() {
  const apiKey = safeProcess.env.API_KEY;
  if (!apiKey) throw new Error("API Key missing");
  return new GoogleGenAI({ apiKey });
}"""

new_getai3 = """const safeProcess = (typeof process !== 'undefined' && process && process.env) 
    ? process 
    : { env: {} as Record<string, string | undefined> };

function getApiKey(): string | undefined {
    if (safeProcess.env.API_KEY) return safeProcess.env.API_KEY;
    try {
        // @ts-ignore
        if (import.meta && import.meta.env) {
            // @ts-ignore
            if (import.meta.env.VITE_GOOGLE_API_KEY) return import.meta.env.VITE_GOOGLE_API_KEY;
            // @ts-ignore
            if (import.meta.env.VITE_GEMINI_API_KEY) return import.meta.env.VITE_GEMINI_API_KEY;
            // @ts-ignore
            if (import.meta.env.API_KEY) return import.meta.env.API_KEY;
        }
    } catch (e) {}
    return undefined;
}

function getAI() {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API Key missing. Set VITE_GOOGLE_API_KEY in Vercel env vars.");
  return new GoogleGenAI({ apiKey });
}"""

if old_getai3 in content3:
    content3 = content3.replace(old_getai3, new_getai3)
    with open(path3, 'w') as f:
        f.write(content3)
    print("  OK: Fixed getAI() to use import.meta.env")
else:
    print("  SKIP: Pattern not found exactly")

print("\n=== ALL DONE ===")
print("\nIMPORTANT: You also need to set VITE_GOOGLE_API_KEY in Vercel:")
print("  1. Go to Vercel → mci-dev-rc → Settings → Environment Variables")
print("  2. Add: VITE_GOOGLE_API_KEY = <your Gemini API key>")
print("  3. Redeploy after adding the env var")
print("\nOR add it to .env.local:")
print("  echo 'VITE_GOOGLE_API_KEY=your-key-here' >> .env.local")
print("\nThen: git add -A && git commit -m 'Fix Gemini API key for Vite browser builds' && git push")
