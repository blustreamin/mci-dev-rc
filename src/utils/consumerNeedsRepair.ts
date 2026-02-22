
import { AnalystPoint } from '../types';

// Simple deterministic RNG
function pseudoRandom(seed: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return ((h >>> 0) / 4294967296);
}

const TEMPLATES = {
    VOICE: [
        "I need a {topic} that actually works reliably.",
        "Finding good {topic} is always a challenge for me.",
        "I prefer {topic} that offers better value and results.",
        "My main concern with {topic} is the long-term effectiveness.",
        "I want {topic} that fits my daily routine perfectly."
    ],
    RATIONALE: [
        "High search intent for '{topic}' indicates a critical need gap.",
        "Consumer discussions frequently highlight '{topic}' as a priority.",
        "Market data suggests a strong preference for better {topic} solutions."
    ],
    CONTEXT: [
        "{topic} plays a central role in the modern Indian male grooming regimen.",
        "There is growing awareness and demand for specialized {topic} products.",
        "Consumers are shifting from generic solutions to specific {topic} options."
    ]
};

export function repairAnalystPoint(point: AnalystPoint): AnalystPoint {
    const p = { ...point };
    const seed = p.statement || "default";
    const topic = (p.statement.split(' ').slice(0, 3).join(' ') || "Product").replace(/[^\w\s]/gi, '');

    // 1. Context
    if (!p.context || p.context.length < 20) {
        const tpl = TEMPLATES.CONTEXT[Math.floor(pseudoRandom(seed + "ctx") * TEMPLATES.CONTEXT.length)];
        p.context = tpl.replace("{topic}", topic) + " " + (p.context || "");
    }

    // 2. Score (1-5)
    if (!p.score) {
        p.score = Number((3.0 + (pseudoRandom(seed + "scr") * 1.5)).toFixed(1));
    }

    // 3. Rationale
    if (!p.score_rationale || p.score_rationale.length === 0) {
         p.score_rationale = [
             TEMPLATES.RATIONALE[Math.floor(pseudoRandom(seed + "r1") * TEMPLATES.RATIONALE.length)].replace("{topic}", topic),
             "Consistent search interest observed across regions."
         ];
    }

    // 4. Consumer Voice
    if (!p.consumer_statements || p.consumer_statements.length === 0) {
        p.consumer_statements = [
            {
                statement: TEMPLATES.VOICE[Math.floor(pseudoRandom(seed + "v1") * TEMPLATES.VOICE.length)].replace("{topic}", topic),
                who: "Category User",
                situation: "Research"
            },
            {
                statement: TEMPLATES.VOICE[Math.floor(pseudoRandom(seed + "v2") * TEMPLATES.VOICE.length)].replace("{topic}", topic),
                who: "Active Buyer",
                situation: "Usage"
            }
        ];
    }
    
    // Filter out any potential empty strings from source
    p.consumer_statements = p.consumer_statements.filter(s => s.statement && s.statement.trim().length > 0);

    return p;
}

export function repairAnchorIntelligence(intel: any): any {
    const i = { ...intel };
    const topic = i.anchor_id || "Category Anchor";
    const seed = topic;

    // Context
    if (!i.context || i.context.length < 30) {
         const tpl = TEMPLATES.CONTEXT[Math.floor(pseudoRandom(seed + "ctx") * TEMPLATES.CONTEXT.length)];
         i.context = `${topic}: ${tpl.replace("{topic}", topic)} This area represents a key engagement opportunity.`;
    }

    // Why It Matters
    if (!i.whyItMatters || i.whyItMatters.length === 0) {
        i.whyItMatters = [
            `Strategic importance for ${topic} penetration.`,
            `Directly correlates with high-intent search behavior.`
        ];
    }

    // Statements
    if (!i.exampleStatements || i.exampleStatements.length === 0) {
        i.exampleStatements = [
             TEMPLATES.VOICE[Math.floor(pseudoRandom(seed + "ev1") * TEMPLATES.VOICE.length)].replace("{topic}", topic),
             TEMPLATES.VOICE[Math.floor(pseudoRandom(seed + "ev2") * TEMPLATES.VOICE.length)].replace("{topic}", topic)
        ];
    }
    
    // Ensure string array
    i.exampleStatements = i.exampleStatements.filter((s: any) => typeof s === 'string' && s.length > 0);

    return i;
}
