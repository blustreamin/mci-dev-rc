
// Deterministic Rule Engine for Anchor Assignment
// No LLM used. Pure regex pattern matching.

const PATTERNS: Record<string, Record<string, RegExp>> = {
    // Generic Fallback Patterns (applied if category specific logic missing)
    'DEFAULT': {
        'Price & Cost': /\b(price|cost|rate|cheap|expensive|discount|offer|buy|online)\b/i,
        'Reviews & Comparison': /\b(review|vs|better|best|top|rating|opinion|versus)\b/i,
        'Problems & Solutions': /\b(problem|fix|issue|help|pain|itch|bump|rash|cure|solution|remedy)\b/i,
        'How-To & Info': /\b(how|what|why|when|guide|tip|tutorial|step)\b/i,
        'Brand Specific': /\b(gillette|beardo|ustraa|bombay shaving|nivea|loreal|garnier)\b/i,
    },
    // Category Specific Overrides
    'shaving': {
        'Razors & Blades': /\b(razor|blade|cartridge|mach3|fusion|safety razor|straight razor)\b/i,
        'Electric Trimmers': /\b(trimmer|clipper|electric shaver|philips|braun|panasonic)\b/i,
        'Creams & Foams': /\b(cream|foam|gel|lather|soap|brush)\b/i,
        'Aftershave & Care': /\b(aftershave|balm|lotion|alum|block|antiseptic)\b/i,
        'Beard Issues': /\b(burn|cut|nick|bump|ingrown|rash|sensitive)\b/i
    }
};

export const AnchorRules = {
    deriveAnchor(keyword: string, categoryId: string): string {
        const text = keyword.toLowerCase();
        
        // 1. Try Category Specific Patterns
        const catPatterns = PATTERNS[categoryId] || PATTERNS['DEFAULT'];
        
        for (const [anchor, regex] of Object.entries(catPatterns)) {
            if (regex.test(text)) return anchor;
        }

        // 2. Try Generic Patterns if category specific failed (and wasn't default)
        if (catPatterns !== PATTERNS['DEFAULT']) {
            for (const [anchor, regex] of Object.entries(PATTERNS['DEFAULT'])) {
                if (regex.test(text)) return anchor;
            }
        }

        return 'General Exploration';
    }
};
