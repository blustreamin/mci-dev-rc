
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Import Contracts
import { CATEGORY_ANCHORS_V1 } from '../src/contracts/categoryAnchorsV1';
// We also import CORE_CATEGORIES to use as a fallback seed source if the V1 contract is empty of keywords
import { CORE_CATEGORIES } from '../src/constants';

declare const process: any;

// --- Configuration ---
const OUTPUT_DIR = path.join(process.cwd(), 'public', 'data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'corpus_semantic_v1.jsonl');

interface CorpusItem {
    keyword_id: string;
    keyword_text: string;
    intent_tag: 'Buy' | 'Research' | 'Browse';
    anchor_tag: string;
    category_id: string;
}

// --- Logic ---

function normalize(text: string): string {
    return text
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s]/g, '') // Strict alpha-numeric + space
        .replace(/\s+/g, ' ');
}

function generateHash(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
}

function inferIntent(text: string): 'Buy' | 'Research' | 'Browse' {
    if (/\b(price|buy|cost|shop|order|online)\b/.test(text)) return 'Buy';
    if (/\b(best|review|vs|compare|top|rating)\b/.test(text)) return 'Research';
    return 'Browse';
}

async function main() {
    console.log(`[CORPUS] Starting build...`);

    // Ensure output dir exists
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const stream = fs.createWriteStream(OUTPUT_FILE, { flags: 'w' });
    let count = 0;
    const seen = new Set<string>();

    // Flatten nested structure
    for (const [catId, catDef] of Object.entries(CATEGORY_ANCHORS_V1)) {
        const anchors = (catDef as any).anchors || [];
        
        // Find default keywords for this category to seed if contract is purely structural
        const coreCat = CORE_CATEGORIES.find(c => c.id === catId);
        const seedKeywords = coreCat ? coreCat.defaultKeywords : [];

        for (const anchor of anchors) {
            const anchorName = anchor.name;
            // Use keywords from contract if available, otherwise use seed list for the first anchor
            // This ensures we generate a valid artifact even if the contract file itself is just definitions
            const keywords: string[] = anchor.keywords || (anchor === anchors[0] ? seedKeywords : []);

            for (const kw of keywords) {
                const norm = normalize(kw);
                if (!norm || seen.has(norm)) continue;
                seen.add(norm);

                const item: CorpusItem = {
                    keyword_id: generateHash(norm),
                    keyword_text: norm,
                    intent_tag: inferIntent(norm),
                    anchor_tag: anchorName,
                    category_id: catId
                };

                stream.write(JSON.stringify(item) + '\n');
                count++;
            }
        }
    }

    stream.end();
    console.log(`[CORPUS] Build complete.`);
    console.log(`[CORPUS] Wrote ${count} records to ${OUTPUT_FILE}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
