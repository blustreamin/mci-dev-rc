
import { CATEGORY_ANCHORS_V1 } from '../contracts/categoryAnchorsV1';

const PADDING_ANCHORS = [
    "Price & Value", 
    "Top Brands", 
    "Usage & Routine", 
    "Problems & Solutions", 
    "Benefits & Features", 
    "Alternatives"
];

export const AnchorScanner = {
    scanAnchors(categoryId: string): string[] {
        // 1. Try V1 Contract first
        const v1Def = CATEGORY_ANCHORS_V1[categoryId];
        let anchors = v1Def ? v1Def.anchors.map(a => a.name) : [];
        
        // 2. If empty, fall back to basic logic or hardcoded defaults logic could go here
        // For now, we rely on padding if empty.
        
        // 3. Deduplicate
        anchors = Array.from(new Set(anchors));
        
        // 4. Enforce Minimum 6 (Padding)
        if (anchors.length < 6) {
            for (const pad of PADDING_ANCHORS) {
                if (anchors.length >= 6) break;
                if (!anchors.includes(pad)) {
                    anchors.push(pad);
                }
            }
        }
        
        return anchors;
    }
};
