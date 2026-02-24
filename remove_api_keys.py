#!/usr/bin/env python3
"""
Remove all hardcoded Gemini API keys from the codebase.
Replaces with proper env var lookups.
"""
import os

GEMINI_KEY = 'AIzaSyAQgj4c9UTOU_lvCXUXupansTwIJgnYop4'
fixes = 0

# 1. Fix .env — replace hardcoded key with placeholder
env_path = '.env'
if os.path.exists(env_path):
    with open(env_path, 'r') as f:
        content = f.read()
    if GEMINI_KEY in content:
        content = content.replace(GEMINI_KEY, 'PLACEHOLDER_SET_IN_VERCEL')
        with open(env_path, 'w') as f:
            f.write(content)
        print(f"  FIXED: .env")
        fixes += 1

# 2. Fix src/services/demandInsightsService.ts
file2 = 'src/services/demandInsightsService.ts'
if os.path.exists(file2):
    with open(file2, 'r') as f:
        content = f.read()
    if GEMINI_KEY in content:
        # Replace the hardcoded fallback line
        content = content.replace(
            f"    if ('{GEMINI_KEY}') return '{GEMINI_KEY}';",
            "    // Removed hardcoded key — use env vars only"
        )
        with open(file2, 'w') as f:
            f.write(content)
        print(f"  FIXED: {file2}")
        fixes += 1

# 3. Fix src/geminiService.ts (root-level copy)
file3 = 'src/geminiService.ts'
if os.path.exists(file3):
    with open(file3, 'r') as f:
        content = f.read()
    if GEMINI_KEY in content:
        content = content.replace(
            f"const apiKey = '{GEMINI_KEY}';",
            "const apiKey = getApiKey();"
        )
        with open(file3, 'w') as f:
            f.write(content)
        print(f"  FIXED: {file3}")
        fixes += 1

# 4. Fix geminiService.ts (another root-level copy)
file4 = 'geminiService.ts'
if os.path.exists(file4):
    with open(file4, 'r') as f:
        content = f.read()
    if GEMINI_KEY in content:
        content = content.replace(
            f"const apiKey = '{GEMINI_KEY}';",
            "const apiKey = getApiKey();"
        )
        with open(file4, 'w') as f:
            f.write(content)
        print(f"  FIXED: {file4}")
        fixes += 1

# 5. Add .env to .gitignore if not already there
gitignore_path = '.gitignore'
if os.path.exists(gitignore_path):
    with open(gitignore_path, 'r') as f:
        gi = f.read()
    additions = []
    if '.env' not in gi.split('\n'):
        additions.append('.env')
    if '.env.local' not in gi.split('\n'):
        additions.append('.env.local')
    if additions:
        with open(gitignore_path, 'a') as f:
            f.write('\n' + '\n'.join(additions) + '\n')
        print(f"  FIXED: .gitignore (added {', '.join(additions)})")
        fixes += 1
else:
    with open(gitignore_path, 'w') as f:
        f.write('.env\n.env.local\n')
    print(f"  CREATED: .gitignore")
    fixes += 1

print(f"\n  Total fixes: {fixes}")
print("\nRun: git add -A && git commit -m 'Remove hardcoded API keys' && git push")
