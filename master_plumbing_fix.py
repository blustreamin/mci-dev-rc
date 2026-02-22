#!/usr/bin/env python3
"""
MASTER PLUMBING FIX
1. Fix getAI() in ALL 11 broken services to use import.meta.env
2. Unhide Playbook tab in navigation
"""
import os
import glob

# ============================================================
# FIX 1: Replace getAI in ALL services
# ============================================================
print("=" * 60)
print("FIX 1: Fixing getAI() in ALL services")
print("=" * 60)

OLD_GETAI = """function getAI() {
  const apiKey = safeProcess.env.API_KEY;
  if (!apiKey) throw new Error("API Key missing");
  return new GoogleGenAI({ apiKey });
}"""

OLD_GETAI_V2 = """function getAI() {
  const apiKey = safeProcess.env.API_KEY;
  if (!apiKey) throw new Error("API Key missing.");
  return new GoogleGenAI({ apiKey });
}"""

OLD_GETAI_V3 = """function getAI() {
  const apiKey = safeProcess.env.API_KEY;
  if (!apiKey) throw new Error("API Key missing. Please set process.env.API_KEY.");
  return new GoogleGenAI({ apiKey });
}"""

NEW_GETAI = """function getApiKey(): string | undefined {
    if (safeProcess.env.API_KEY) return safeProcess.env.API_KEY;
    try {
        // @ts-ignore
        if (import.meta && import.meta.env) {
            // @ts-ignore
            if (import.meta.env.VITE_GOOGLE_API_KEY) return import.meta.env.VITE_GOOGLE_API_KEY;
            // @ts-ignore
            if (import.meta.env.VITE_GEMINI_API_KEY) return import.meta.env.VITE_GEMINI_API_KEY;
        }
    } catch (e) {}
    return undefined;
}

function getAI() {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API Key missing. Set VITE_GOOGLE_API_KEY.");
  return new GoogleGenAI({ apiKey });
}"""

# Find all .ts files in services/
services_dir = 'src/services'
fixed_count = 0
skip_count = 0

for fpath in glob.glob(os.path.join(services_dir, '*.ts')):
    fname = os.path.basename(fpath)
    with open(fpath, 'r') as f:
        content = f.read()
    
    # Skip if already fixed
    if 'getApiKey' in content:
        print(f"  SKIP (already fixed): {fname}")
        skip_count += 1
        continue
    
    # Try all variants
    replaced = False
    for old_pattern in [OLD_GETAI, OLD_GETAI_V2, OLD_GETAI_V3]:
        if old_pattern in content:
            content = content.replace(old_pattern, NEW_GETAI)
            replaced = True
            break
    
    if not replaced and 'function getAI()' in content:
        # Line-level replacement as fallback
        lines = content.split('\n')
        new_lines = []
        skip = False
        inserted = False
        brace_depth = 0
        
        for line in lines:
            if 'function getAI()' in line and not inserted:
                skip = True
                brace_depth = 0
                new_lines.append(NEW_GETAI)
                inserted = True
            
            if skip:
                brace_depth += line.count('{') - line.count('}')
                if brace_depth <= 0 and '{' in ''.join(new_lines[-5:]):
                    skip = False
                continue
            
            new_lines.append(line)
        
        if inserted:
            content = '\n'.join(new_lines)
            replaced = True
    
    if replaced:
        with open(fpath, 'w') as f:
            f.write(content)
        print(f"  FIXED: {fname}")
        fixed_count += 1
    elif 'getAI' in content:
        print(f"  WARN (has getAI but couldn't fix): {fname}")

# Also fix geminiService.ts which is in the same dir but has a different error message
gemini_path = os.path.join(services_dir, 'geminiService.ts')
if os.path.exists(gemini_path):
    with open(gemini_path, 'r') as f:
        content = f.read()
    if 'getApiKey' not in content and 'function getAI()' in content:
        # Force fix with broader pattern
        import re
        pattern = r'function getAI\(\)\s*\{[^}]*?return new GoogleGenAI\(\{[^}]*?\}\);\s*\}'
        match = re.search(pattern, content, re.DOTALL)
        if match:
            content = content[:match.start()] + NEW_GETAI + content[match.end():]
            with open(gemini_path, 'w') as f:
                f.write(content)
            print(f"  FIXED (regex): geminiService.ts")
            fixed_count += 1

# Also check deepDiveRepair and googleTrendsService
for extra_file in ['deepDiveRepair.ts', 'googleTrendsService.ts']:
    extra_path = os.path.join(services_dir, extra_file)
    if os.path.exists(extra_path):
        with open(extra_path, 'r') as f:
            content = f.read()
        if 'getApiKey' not in content and 'safeProcess.env.API_KEY' in content:
            content = content.replace(
                'const apiKey = safeProcess.env.API_KEY;',
                'const apiKey = getApiKey();'
            )
            # Add getApiKey before getAI if not present
            if 'function getApiKey' not in content:
                content = content.replace(
                    'function getAI()',
                    NEW_GETAI.split('function getAI()')[0] + 'function getAI()'
                )
            with open(extra_path, 'w') as f:
                f.write(content)
            print(f"  FIXED (inline): {extra_file}")
            fixed_count += 1

print(f"\n  Total: {fixed_count} fixed, {skip_count} already OK")

# ============================================================
# FIX 2: Unhide Playbook in navigation
# ============================================================
print("\n" + "=" * 60)
print("FIX 2: Unhide Playbook tab")
print("=" * 60)

app_path = 'src/App.tsx'
with open(app_path, 'r') as f:
    content = f.read()

old_nav = """                                { gear: 'DEEP_DIVE', icon: Microscope, label: 'Deep Dive' },
                                // Playbook hidden
                                { gear: 'SIGNALS', icon: Wifi, label: 'Signals' },"""

new_nav = """                                { gear: 'DEEP_DIVE', icon: Microscope, label: 'Deep Dive' },
                                { gear: 'PLAYBOOK', icon: Zap, label: 'Playbook' },
                                { gear: 'SIGNALS', icon: Wifi, label: 'Signals' },"""

if old_nav in content:
    content = content.replace(old_nav, new_nav)
    
    # Ensure Zap is imported
    if "'lucide-react'" in content and 'Zap' not in content.split("from 'lucide-react'")[0].split('\n')[-1]:
        # Add Zap to imports if missing
        content = content.replace(
            "import { Wifi,",
            "import { Wifi, Zap,"
        )
    
    with open(app_path, 'w') as f:
        f.write(content)
    print("  OK: Playbook tab restored in navigation")
else:
    print("  SKIP: Nav pattern not found (may need manual fix)")
    # Try alternate approach
    if '// Playbook hidden' in content:
        content = content.replace(
            '// Playbook hidden',
            "{ gear: 'PLAYBOOK', icon: Zap, label: 'Playbook' },"
        )
        with open(app_path, 'w') as f:
            f.write(content)
        print("  OK (alt): Playbook comment replaced")

# ============================================================
# FIX 3: Verify Zap import exists
# ============================================================
print("\n" + "=" * 60)
print("FIX 3: Verify icon imports")
print("=" * 60)

with open(app_path, 'r') as f:
    content = f.read()

if 'Zap' in content and 'Zap' not in content[:content.index('function') if 'function' in content else content.index('const App')]:
    # Zap used but not imported - find the lucide import line
    lines = content.split('\n')
    for i, line in enumerate(lines):
        if 'lucide-react' in line and 'import' in line:
            if 'Zap' not in line:
                # Add Zap to the import
                line = line.replace(' } from', ', Zap } from')
                lines[i] = line
                content = '\n'.join(lines)
                with open(app_path, 'w') as f:
                    f.write(content)
                print("  OK: Added Zap to lucide-react imports")
            else:
                print("  OK: Zap already imported")
            break
else:
    print("  OK: Imports look fine")

print("\n" + "=" * 60)
print("ALL PLUMBING FIXES DONE")
print("=" * 60)
print("\nRun: git add -A && git commit -m 'Master plumbing fix: all API keys + Playbook tab' && git push")
