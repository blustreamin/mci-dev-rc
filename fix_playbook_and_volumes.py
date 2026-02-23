#!/usr/bin/env python3
"""
Two fixes:
1. Hide Playbook tab from nav
2. Add search volumes to keywords in Consumer Intent Statements
"""
import re

# ============================================================
# FIX 1: Hide Playbook tab
# ============================================================
print("=== FIX 1: Hide Playbook tab ===")

app_path = 'src/App.tsx'
with open(app_path, 'r') as f:
    content = f.read()

# Find and remove the Playbook gear entry from the nav array
# It could be in various forms
patterns_to_remove = [
    "{ gear: 'PLAYBOOK', icon: Zap, label: 'Playbook' },\n",
    "{ gear: 'PLAYBOOK', icon: Zap, label: 'Playbook' },",
    '{ gear: \'PLAYBOOK\', icon: Zap, label: \'Playbook\' },\n',
]

found = False
for pat in patterns_to_remove:
    if pat in content:
        content = content.replace(pat, '// Playbook hidden\n' if pat.endswith('\n') else '// Playbook hidden\n')
        found = True
        break

if not found:
    # Try regex
    match = re.search(r"\{\s*gear:\s*'PLAYBOOK'[^}]*\},?\s*\n?", content)
    if match:
        content = content.replace(match.group(0), '// Playbook hidden\n')
        found = True

if found:
    with open(app_path, 'w') as f:
        f.write(content)
    print("  OK: Playbook tab hidden")
else:
    if '// Playbook hidden' in content:
        print("  SKIP: Already hidden")
    else:
        print("  WARN: Could not find Playbook nav entry")

# ============================================================
# FIX 2: Add keyword volumes to Consumer Intent Statements  
# ============================================================
print("\n=== FIX 2: Add keyword volumes ===")

# Fix A: geminiService.ts - include volumes in evidence data
gemini_path = 'src/services/geminiService.ts'
with open(gemini_path, 'r') as f:
    gcontent = f.read()

# Check if evidenceWithVolume already exists
if 'evidenceWithVolume' in gcontent:
    print("  SKIP: evidenceWithVolume already in geminiService.ts")
else:
    # Find the evidence line and add evidenceWithVolume after it
    old_evidence = "evidence: stats.keywords.sort((a,b) => b.sv - a.sv).slice(0, 5).map(k => k.k),"
    new_evidence = "evidence: stats.keywords.sort((a,b) => b.sv - a.sv).slice(0, 15).map(k => k.k),\n        evidenceWithVolume: stats.keywords.sort((a,b) => b.sv - a.sv).slice(0, 15).map(k => ({ keyword: k.k, volume: k.sv })),"
    
    if old_evidence in gcontent:
        gcontent = gcontent.replace(old_evidence, new_evidence)
        with open(gemini_path, 'w') as f:
            f.write(gcontent)
        print("  OK: Added evidenceWithVolume to geminiService.ts")
    else:
        # Try with 15 already
        old_15 = "evidence: stats.keywords.sort((a,b) => b.sv - a.sv).slice(0, 15).map(k => k.k),"
        if old_15 in gcontent and 'evidenceWithVolume' not in gcontent:
            new_15 = old_15 + "\n        evidenceWithVolume: stats.keywords.sort((a,b) => b.sv - a.sv).slice(0, 15).map(k => ({ keyword: k.k, volume: k.sv })),"
            gcontent = gcontent.replace(old_15, new_15)
            with open(gemini_path, 'w') as f:
                f.write(gcontent)
            print("  OK: Added evidenceWithVolume (15-slice variant)")
        else:
            print("  WARN: Could not find evidence line pattern")

# Fix B: CategoryOutputCard.tsx - display volumes next to keywords
# We need to find the keyword rendering section and replace it
card_path = 'src/console/CategoryOutputCard.tsx'
with open(card_path, 'r') as f:
    ccontent = f.read()

# Look for the keyword rendering block - find by nearby context
# The keywords are rendered in the anchor_intelligence section
old_kw_block = None
new_kw_block = None

# Pattern 1: Original 5-keyword display
p1 = '''(Array.isArray(intel.evidence) ? intel.evidence : []).slice(0, 5).map((kw: string, k: number) => (
                                                <span key={k} className="px-1.5 py-0.5 bg-slate-50 text-slate-500 text-[9px] rounded border border-slate-100">
                                                    {toReactText(kw)}
                                                </span>
                                            ))'''

# Pattern 2: Check if already has volume logic
if 'evidenceWithVolume' in ccontent:
    print("  SKIP: Volume display already in CategoryOutputCard.tsx")
else:
    # Find the flex flex-wrap gap-1 section inside anchor_intelligence
    # Use regex to find the keyword rendering
    kw_pattern = re.search(
        r'(<div className="flex flex-wrap gap-1">\s*\{)(.*?)(\.map\((kw|item).*?</span>\s*\)\))',
        ccontent, re.DOTALL
    )
    
    if kw_pattern or p1 in ccontent:
        # Replace the entire keyword display section
        # Find the section between "flex flex-wrap gap-1" and its closing </div>
        # within the anchor_intelligence block
        
        old_section = re.search(
            r'(<div className="flex flex-wrap gap-1">)\s*\{(.*?)\}\s*(</div>)',
            ccontent[ccontent.find('anchor_intelligence'):] if 'anchor_intelligence' in ccontent else ccontent,
            re.DOTALL
        )
        
        if old_section:
            old_full = old_section.group(0)
            # Find it in the full content
            start_idx = ccontent.find(old_full)
            if start_idx >= 0:
                new_section = '''<div className="flex flex-wrap gap-1">
                                            {(() => {
                                                const ewv = intel.evidenceWithVolume || intel.evidence_with_volume;
                                                const items = Array.isArray(ewv) && ewv.length > 0
                                                    ? ewv.map((item: any) => ({ keyword: item.keyword || item.k || '', volume: item.volume || item.sv || 0 }))
                                                    : (Array.isArray(intel.evidence) ? intel.evidence : []).map((kw: any) => ({ keyword: typeof kw === 'string' ? kw : kw.keyword || '', volume: typeof kw === 'object' ? (kw.volume || kw.sv || 0) : 0 }));
                                                return items.slice(0, 12).map((item: any, k: number) => {
                                                    const vol = item.volume || 0;
                                                    const volDisplay = vol >= 1000000 ? `${(vol/1000000).toFixed(1)}M` : vol >= 1000 ? `${(vol/1000).toFixed(vol >= 10000 ? 0 : 1)}K` : vol > 0 ? String(vol) : '';
                                                    return (
                                                        <span key={k} className="px-1.5 py-0.5 bg-slate-50 text-slate-500 text-[9px] rounded border border-slate-100 inline-flex items-center gap-1">
                                                            {toReactText(item.keyword)}
                                                            {volDisplay && <span className="text-indigo-500 font-bold">{volDisplay}</span>}
                                                        </span>
                                                    );
                                                });
                                            })()}
                                        </div>'''
                ccontent = ccontent[:start_idx] + new_section + ccontent[start_idx + len(old_full):]
                with open(card_path, 'w') as f:
                    f.write(ccontent)
                print("  OK: Updated keyword display with volumes")
            else:
                print("  WARN: Found pattern in substring but not in full content")
        else:
            print("  WARN: Could not find keyword display section via regex")
    else:
        print("  WARN: Could not find keyword rendering pattern")

# Also check the OTHER CategoryOutputCard (there are two)
card_path2 = 'src/components/CategoryOutputCard.tsx'
import os
if os.path.exists(card_path2):
    with open(card_path2, 'r') as f:
        ccontent2 = f.read()
    if 'evidenceWithVolume' not in ccontent2 and 'intel.evidence' in ccontent2:
        print("\n  NOTE: src/components/CategoryOutputCard.tsx also exists and may need the same fix")

print("\n=== DONE ===")
print("Run: git add -A && git commit -m 'Hide Playbook + add keyword volumes' && git push")
