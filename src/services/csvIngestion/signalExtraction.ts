
export interface KeywordSignals {
    modifiers: string[];
    entities: string[];
    actions: string[];
    problems: string[];
    routines: string[];
    productType?: string;
}

const DICTIONARY = {
    MODIFIERS: ["best", "top", "review", "vs", "versus", "price", "cost", "cheap", "expensive", "online", "near me", "for men", "in india", "benefits", "side effects", "how to", "what is"],
    ACTIONS: ["buy", "use", "apply", "remove", "prevent", "cure", "treat", "fix", "grow", "groom", "style", "wash", "clean", "shave", "trim"],
    PROBLEMS: ["acne", "pimple", "dark spot", "dandruff", "hair fall", "baldness", "grey hair", "white hair", "oily", "dry", "sensitive", "itch", "rash", "burn", "bump", "smell", "odor", "sweat"],
    ROUTINES: ["daily", "night", "morning", "routine", "step", "guide", "tips", "hack", "before", "after"],
    // Category agnostic entity detection is hard, but we can detect common forms
    ENTITIES_COMMON: ["cream", "oil", "gel", "wax", "spray", "serum", "wash", "soap", "shampoo", "conditioner", "kit", "combo", "gift", "razor", "trimmer", "blade", "machine"]
};

export const SignalExtraction = {
    extract(keyword: string): KeywordSignals {
        const text = keyword.toLowerCase();
        const tokens = text.split(/\s+/);
        
        const signals: KeywordSignals = {
            modifiers: [],
            entities: [],
            actions: [],
            problems: [],
            routines: []
        };

        // 1. Modifiers
        DICTIONARY.MODIFIERS.forEach(m => {
            if (text.includes(m)) signals.modifiers.push(m);
        });

        // 2. Actions
        DICTIONARY.ACTIONS.forEach(a => {
            if (tokens.includes(a)) signals.actions.push(a);
        });

        // 3. Problems
        DICTIONARY.PROBLEMS.forEach(p => {
            if (text.includes(p)) signals.problems.push(p);
        });

        // 4. Routines
        DICTIONARY.ROUTINES.forEach(r => {
            if (text.includes(r)) signals.routines.push(r);
        });

        // 5. Entities (Product Types)
        DICTIONARY.ENTITIES_COMMON.forEach(e => {
            if (text.includes(e)) {
                signals.entities.push(e);
                // Heuristic: First entity found is often the core product type
                if (!signals.productType) signals.productType = e;
            }
        });

        return signals;
    }
};
