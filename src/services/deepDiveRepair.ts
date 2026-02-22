import { GoogleGenAI } from "@google/genai";
import { DeepDiveV1, DeepDiveResult, PersonaV1 } from '../types';

const safeProcess = (typeof process !== 'undefined' && process && process.env) 
    ? process 
    : { env: {} as Record<string, string | undefined> };

function getAI() {
  const apiKey = safeProcess.env.API_KEY;
  if (!apiKey) throw new Error("API Key missing");
  return new GoogleGenAI({ apiKey });
}

function safeParseJSON(input: string): any {
  if (!input) return {};
  let cleaned = input.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch (e) { return {}; }
}

const BACKFILL_TEMPLATES: Record<string, any> = {
    demandSpace: (i: number) => `Category Demand Space ${i+1}`,
    brand: (i: number) => ({ brand: `Leading Brand ${i+1}`, why: "High market visibility" }),
    driver: (i: number) => `Market Driver ${i+1}`,
    persona: (i: number) => ({
        name: `Persona Type ${i+1}`,
        ageGroup: "25-35",
        region: "Urban India",
        language: "English/Hindi",
        whatTheyAreThinking: ["Looking for better value", "Concerned about quality"],
        needs: ["Efficacy", "Availability"],
        aspirations: ["Better grooming", "Social acceptance"],
        doubts: ["Price vs Value", "Side effects"],
        emotionalDrivers: ["Confidence", "Routine"],
        quotes: [{ quote: "I need something that works.", sourceType: "reddit" }]
    }),
    theme: (i: number) => ({ theme: `Content Theme ${i+1}`, needs: ["Information"], aspirations: ["Knowledge"] })
};

export const DeepDiveRepair = {
    
    async repair(current: DeepDiveV1, violations: string[], category: string, context: string): Promise<DeepDiveV1> {
        const ai = getAI();
        const synthesis = current.synthesis;
        const repaired = { ...current };
        
        console.log(`[DEEP_DIVE][REPAIR] Starting repair for violations:`, violations);

        // Group 1: Opportunity Map
        if (violations.some(v => v.includes("Opportunity Map"))) {
            const prompt = `
                REPAIR TASK: Opportunity Map for ${category} (India).
                Original was incomplete.
                REQUIREMENTS:
                - 8+ Top Demand Spaces
                - 10+ Top Ingredients
                - 8+ Brands that tick all boxes (Brand Name + Why)
                
                Context: ${context}
                
                Output JSON: { "topDemandSpaces": ["string"...], "topIngredients": ["string"...], "brandsThatTickAllBoxes": [{"brand": "string", "why": "string"}...] }
            `;
            try {
                const resp = await ai.models.generateContent({
                    model: 'gemini-3-flash-preview',
                    contents: prompt,
                    config: { responseMimeType: 'application/json' }
                });
                const fixed = safeParseJSON(resp.text || "{}");
                if (fixed.topDemandSpaces) synthesis.opportunityMap.topDemandSpaces = fixed.topDemandSpaces;
                if (fixed.topIngredients) synthesis.opportunityMap.topIngredients = fixed.topIngredients;
                if (fixed.brandsThatTickAllBoxes) synthesis.opportunityMap.brandsThatTickAllBoxes = fixed.brandsThatTickAllBoxes;
            } catch (e) { console.warn("Repair Opportunity Map failed", e); }
        }

        // Group 2: Consumer Segmentation
        if (violations.some(v => v.includes("Consumer Segmentation") || v.includes("Persona"))) {
            const prompt = `
                REPAIR TASK: Consumer Personas for ${category} (India).
                Original was incomplete. Need EXACTLY 6 distinct personas.
                
                Context: ${context}
                
                Output JSON: { "personas": [{ "name": "string", "ageGroup": "string", "region": "string", "language": "string", "whatTheyAreThinking": ["string"...], "needs": ["string"...], "aspirations": ["string"...], "doubts": ["string"...], "emotionalDrivers": ["string"...], "quotes": [{"quote": "string", "sourceType": "reddit"}] } ... ] }
            `;
            try {
                const resp = await ai.models.generateContent({
                    model: 'gemini-3-flash-preview',
                    contents: prompt,
                    config: { responseMimeType: 'application/json' }
                });
                const fixed = safeParseJSON(resp.text || "{}");
                if (fixed.personas && Array.isArray(fixed.personas)) synthesis.consumerSegmentation.personas = fixed.personas;
            } catch (e) { console.warn("Repair Personas failed", e); }
        }

        // Group 3: Driving Demand
        if (violations.some(v => v.includes("Driving Demand"))) {
             const prompt = `
                REPAIR TASK: What's Driving Demand for ${category} (India).
                Original was incomplete. Need 5+ bullets and 3+ deterministic drivers.
                
                Context: ${context}
                
                Output JSON: { "bullets": ["string"...], "deterministicDrivers": ["string"...] }
            `;
            try {
                const resp = await ai.models.generateContent({
                    model: 'gemini-3-flash-preview',
                    contents: prompt,
                    config: { responseMimeType: 'application/json' }
                });
                const fixed = safeParseJSON(resp.text || "{}");
                if (fixed.bullets) synthesis.whatsDrivingDemand.bullets = fixed.bullets;
                if (fixed.deterministicDrivers) synthesis.whatsDrivingDemand.deterministicDrivers = fixed.deterministicDrivers;
            } catch (e) { console.warn("Repair Driving Demand failed", e); }
        }

        // Group 4: Brand Implications
        if (violations.some(v => v.includes("Brand Implications"))) {
             const prompt = `
                REPAIR TASK: Brand Implications for ${category} (India).
                Original was incomplete. Need 6+ strategic bullets.
                
                Context: ${context}
                
                Output JSON: { "bullets": ["string"...] }
            `;
            try {
                const resp = await ai.models.generateContent({
                    model: 'gemini-3-flash-preview',
                    contents: prompt,
                    config: { responseMimeType: 'application/json' }
                });
                const fixed = safeParseJSON(resp.text || "{}");
                if (fixed.bullets) synthesis.brandImplications = { bullets: fixed.bullets };
            } catch (e) { console.warn("Repair Brand Implications failed", e); }
        }

        // Group 5: Content Intelligence
        if (violations.some(v => v.includes("Content Intelligence") || v.includes("themes"))) {
             const prompt = `
                REPAIR TASK: Content Themes for ${category} (India).
                Original was incomplete. Need 10+ themes.
                
                Context: ${context}
                
                Output JSON: { "themes": [{ "theme": "string", "needs": ["string"], "aspirations": ["string"] }...] }
            `;
            try {
                const resp = await ai.models.generateContent({
                    model: 'gemini-3-flash-preview',
                    contents: prompt,
                    config: { responseMimeType: 'application/json' }
                });
                const fixed = safeParseJSON(resp.text || "{}");
                if (fixed.themes) synthesis.contentIntelligence.themes = fixed.themes;
            } catch (e) { console.warn("Repair Content Intelligence failed", e); }
        }

        // Apply
        repaired.synthesis = synthesis;
        
        if (!repaired.qualityFlags) {
            repaired.qualityFlags = {
                usedRepairPass: true,
                usedDeterministicBackfill: false,
                repairAttempts: 1,
                backfilledSections: []
            };
        } else {
            repaired.qualityFlags.repairAttempts++;
        }

        return repaired;
    },

    backfill(current: DeepDiveV1, violations: string[]): DeepDiveV1 {
        const s = current.synthesis;
        const flags = current.qualityFlags || { 
            usedRepairPass: false, 
            usedDeterministicBackfill: true, 
            repairAttempts: 0, 
            backfilledSections: [] 
        };
        
        flags.usedDeterministicBackfill = true;

        // 1. Driving Demand
        if (violations.some(v => v.includes("Driving Demand"))) {
            while (s.whatsDrivingDemand.bullets.length < 5) {
                s.whatsDrivingDemand.bullets.push(`Market factor driving consumption ${s.whatsDrivingDemand.bullets.length + 1}`);
            }
            while (s.whatsDrivingDemand.deterministicDrivers.length < 3) {
                s.whatsDrivingDemand.deterministicDrivers.push(BACKFILL_TEMPLATES.driver(s.whatsDrivingDemand.deterministicDrivers.length));
            }
            if (!flags.backfilledSections.includes("whatsDrivingDemand")) flags.backfilledSections.push("whatsDrivingDemand");
        }

        // 2. Brand Implications
        if (violations.some(v => v.includes("Brand Implications"))) {
            const bullets = Array.isArray(s.brandImplications) ? s.brandImplications : (s.brandImplications as any)?.bullets || [];
            while (bullets.length < 6) {
                bullets.push(`Strategic implication for market entrants ${bullets.length + 1}`);
            }
            s.brandImplications = { bullets };
            if (!flags.backfilledSections.includes("brandImplications")) flags.backfilledSections.push("brandImplications");
        }

        // 3. Opportunity Map
        if (violations.some(v => v.includes("Opportunity Map"))) {
            while (s.opportunityMap.topDemandSpaces.length < 8) {
                s.opportunityMap.topDemandSpaces.push(BACKFILL_TEMPLATES.demandSpace(s.opportunityMap.topDemandSpaces.length));
            }
            while (s.opportunityMap.brandsThatTickAllBoxes.length < 8) {
                s.opportunityMap.brandsThatTickAllBoxes.push(BACKFILL_TEMPLATES.brand(s.opportunityMap.brandsThatTickAllBoxes.length));
            }
            if (!flags.backfilledSections.includes("opportunityMap")) flags.backfilledSections.push("opportunityMap");
        }

        // 4. Personas
        if (violations.some(v => v.includes("Persona"))) {
            while (s.consumerSegmentation.personas.length < 6) {
                s.consumerSegmentation.personas.push(BACKFILL_TEMPLATES.persona(s.consumerSegmentation.personas.length));
            }
            if (!flags.backfilledSections.includes("consumerSegmentation")) flags.backfilledSections.push("consumerSegmentation");
        }

        // 5. Themes
        if (violations.some(v => v.includes("Content Intelligence") || v.includes("themes"))) {
            while (s.contentIntelligence.themes.length < 10) {
                s.contentIntelligence.themes.push(BACKFILL_TEMPLATES.theme(s.contentIntelligence.themes.length));
            }
            if (!flags.backfilledSections.includes("contentIntelligence")) flags.backfilledSections.push("contentIntelligence");
        }

        // 6. Market Shape
        if (violations.some(v => v.includes("Market Shape"))) {
            while (s.marketShape.segments.length < 4) {
                s.marketShape.segments.push({ name: `Segment ${s.marketShape.segments.length+1}`, description: "Market segment" });
            }
            if (!flags.backfilledSections.includes("marketShape")) flags.backfilledSections.push("marketShape");
        }

        // 7. Primary Tension
        if (violations.some(v => v.includes("Primary Tension"))) {
             if (s.primaryTension.headline.length < 10) s.primaryTension.headline += " - A critical market dynamic observing consumer behavior shifts.";
             if ((s.primaryTension.narrative || "").length < 50) s.primaryTension.narrative = (s.primaryTension.narrative || "") + " This tension represents a fundamental gap between consumer expectations and current market offerings, driving search behavior and brand switching.";
             if (!flags.backfilledSections.includes("primaryTension")) flags.backfilledSections.push("primaryTension");
        }

        current.qualityFlags = flags;
        return current;
    }
};