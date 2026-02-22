
import { CANONICAL_ANCHORS } from './canonicalAnchors';

export interface V1AnchorDef {
    name: string;
    description: string;
}

export interface V1CategoryDef {
    id: string; // Matches CategoryBaseline.id
    anchors: V1AnchorDef[];
}

// Automatically generate the V1 definitions from the Canonical Anchors
// This ensures single source of truth while maintaining type compatibility
export const CATEGORY_ANCHORS_V1: Record<string, V1CategoryDef> = Object.entries(CANONICAL_ANCHORS).reduce((acc, [id, anchors]) => {
    acc[id] = {
        id,
        anchors: anchors.map(name => ({
            name,
            description: "Canonical Strategic Anchor" // Fixed description to enforce uniformity
        }))
    };
    return acc;
}, {} as Record<string, V1CategoryDef>);
