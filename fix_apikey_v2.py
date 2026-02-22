#!/usr/bin/env python3
"""
Direct fix - replace getAI() in all three files using actual file content.
"""

files_to_fix = [
    'src/services/consumerNeedsSynthesisService.ts',
    'src/services/geminiService.ts', 
    'src/services/deepDiveServiceV2.ts'
]

NEW_BLOCK = '''function getApiKey(): string | undefined {
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
}'''

for fpath in files_to_fix:
    try:
        with open(fpath, 'r') as f:
            content = f.read()
    except FileNotFoundError:
        print(f"  SKIP: {fpath} not found")
        continue
    
    # Find and replace the getAI function - look for the pattern
    import re
    
    # Match: function getAI() { ... const apiKey = safeProcess.env.API_KEY; ... }
    pattern = r'function getAI\(\)\s*\{[^}]*safeProcess\.env\.API_KEY[^}]*\}'
    match = re.search(pattern, content)
    
    if match:
        old = match.group(0)
        content = content.replace(old, NEW_BLOCK)
        with open(fpath, 'w') as f:
            f.write(content)
        print(f"  OK: {fpath}")
    else:
        # Try alternate: maybe it already has getApiKey
        if 'getApiKey' in content:
            print(f"  SKIP: {fpath} (already has getApiKey)")
        else:
            print(f"  WARN: {fpath} - getAI pattern not found, doing line-level fix")
            # Brute force: replace line by line
            lines = content.split('\n')
            new_lines = []
            skip_until_close = False
            inserted = False
            for line in lines:
                if 'function getAI()' in line and not inserted:
                    skip_until_close = True
                    new_lines.append(NEW_BLOCK)
                    inserted = True
                    continue
                if skip_until_close:
                    if line.strip() == '}':
                        skip_until_close = False
                    continue
                new_lines.append(line)
            
            if inserted:
                with open(fpath, 'w') as f:
                    f.write('\n'.join(new_lines))
                print(f"  OK: {fpath} (line-level fix)")
            else:
                print(f"  FAIL: {fpath}")

print("\nDone. Now:")
print("1. Set VITE_GOOGLE_API_KEY in Vercel env vars (or .env.local)")
print("2. git add -A && git commit -m 'Fix Gemini API key for browser' && git push")
