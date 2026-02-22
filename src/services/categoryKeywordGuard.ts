
// Category Knowledge Base (additive for guard logic)

export const HEAD_TERMS: Record<string, string[]> = {
    'shaving': ["shaving", "shave", "razor", "blade", "cartridge", "trimmer", "foam", "gel", "cream", "lather", "safety razor", "electric shaver", "aftershave", "pre shave"],
    'beard': ["beard", "mustache", "moustache", "stubble", "goatee", "growth oil", "trimmer", "softener", "wash", "wax", "balm", "beard color"],
    'hair-styling': ["hair wax", "hair gel", "pomade", "styling", "clay", "putty", "paste", "hair spray", "hair cream", "mousse", "volumizer", "styling wax"],
    'sexual-wellness': ["condom", "lube", "lubricant", "delay spray", "climax", "stamina", "erection", "performance", "protection", "contraceptive"],
    'intimate-hygiene': ["intimate wash", "hygiene wash", "balls", "groin", "pubic", "anti chafing", "sweat powder", "fungal", "itch", "private part", "intimate hygiene"],
    'hair-colour': ["hair colour", "hair color", "hair dye", "grey", "gray", "root touch up", "shampoo colour", "black hair", "brown hair", "grey coverage", "ammonia free"],
    'face-care': ["face wash", "moisturizer", "sunscreen", "scrub", "serum", "acne", "pimple", "face cream", "cleanser", "exfoliator", "tan removal", "face mask", "face gel"],
    'deodorants': ["deodorant", "deo", "perfume", "body spray", "fragrance", "scent", "cologne", "roll on", "antiperspirant", "oud", "musk", "body mist"],
    'hair-oil': ["hair oil", "scalp oil", "hair growth", "hair fall", "dandruff", "coconut oil", "almond oil", "onion oil", "ayurvedic oil", "anti hair fall", "hair tonic"],
    'fragrance-premium': ["perfume", "parfum", "edt", "edp", "fragrance", "scent", "luxury", "designer", "gift set", "cologne", "attar"],
    'skincare-spec': ["serum", "retinol", "vitamin c", "niacinamide", "hyaluronic", "eye cream", "dark circle", "pigmentation", "anti aging", "face serum"],
    'shampoo': ["shampoo", "conditioner", "cleanser", "scalp", "dandruff", "hair wash", "hair fall shampoo", "keratin", "anti dandruff"],
    'soap': ["soap", "body wash", "shower gel", "bathing bar", "cleansing bar", "bath soap", "body cleanser"],
    'body-lotion': ["body lotion", "body cream", "moisturizer", "vaseline", "cocoa butter", "shea butter", "winter cream", "skin lotion", "body milk"],
    'talcum': ["talcum", "talc", "powder", "cool powder", "prickly heat", "dusting powder", "body powder", "sweat powder"],
    'oral-care': ["toothpaste", "toothbrush", "mouthwash", "floss", "breath", "whitening", "gum", "tooth brush", "oral care", "fresh breath"]
};

export const BRAND_PACKS: Record<string, string[]> = {
    'shaving': ["gillette", "philips", "panasonic", "syska", "braun", "havells", "bombay shaving company", "beardo", "the man company", "park avenue", "supermax", "denver", "vi john", "old spice", "set wet", "ustraa", "zlade", "spruce"],
    'beard': ["beardo", "bombay shaving company", "the man company", "ustraa", "park avenue", "vi john", "set wet", "denver", "wild stone", "garnier men", "streax", "indica men", "just for men", "loreal men", "urban gabru"],
    'hair-styling': ["set wet", "park avenue", "garnier men", "loreal men", "denver", "wild stone", "beardo", "ustraa", "gatsby", "streax", "schwarzkopf", "nivea men", "arata", "urban gabru"],
    'sexual-wellness': ["manforce", "durex", "skore", "kamasutra", "bold care", "muscle blaze", "himalaya wellness", "healthkart", "moods", "playgard"],
    'intimate-hygiene': ["pee safe", "sirona", "man matters", "the man company", "ustraa", "bombay shaving company", "wow skin science", "svish", "nuutjob", "skin elements"],
    'hair-colour': ["loreal", "garnier", "streax", "indica", "godrej expert", "revlon", "schwarzkopf", "bigen", "just for men", "matrix", "parachute", "vatika", "blunt"],
    'face-care': ["nivea men", "garnier men", "loreal men", "ponds men", "the man company", "beardo", "ustraa", "bombay shaving company", "wow skin science", "mamaearth", "plum", "mcb", "cetaphil", "minimalist", "derma co"],
    'deodorants': ["axe", "park avenue", "fogg", "wild stone", "denver", "engage", "yardley", "nivea men", "old spice", "set wet", "villain", "he", "cobra", "brut"],
    'hair-oil': ["parachute", "indulekha", "bajaj almond drops", "kesh king", "vatika", "dabur amla", "wow skin science", "khadi", "biotique", "navratna", "emami", "himalaya"],
    'fragrance-premium': ["titan skinn", "villain", "beardo", "ustraa", "the man company", "ajmal", "armaf", "rasasi", "davidoff", "calvin klein", "versace", "bellavita", "wild stone edge", "embark"],
    'skincare-spec': ["minimalist", "derma co", "ordinary", "biotique", "plum", "wow", "mcaffeine", "dot & key", "chemist at play", "pilgrim", "dr sheth", "neutrogena"],
    'shampoo': ["head and shoulders", "loreal", "tresemme", "clinic plus", "pantene", "wow skin science", "biotique", "khadi", "dove", "nivea men", "beer shampoo", "park avenue"],
    'soap': ["dove", "lux", "pears", "nivea men", "yardley", "fiama", "dettol", "lifebuoy", "park avenue", "cinthol", "medimix", "mysore sandal", "wild stone"],
    'body-lotion': ["nivea men", "vaseline", "ponds", "dove", "joy", "biotique", "wow skin science", "plum", "himalaya", "cocoa butter", "boroplus", "parachute"],
    'talcum': ["ponds", "yardley", "park avenue", "wild stone", "denver", "engage", "nivea men", "fiama", "cinthol", "navratna", "dermicool", "nycil"],
    'oral-care': ["colgate", "pepsodent", "closeup", "sensodyne", "oral b", "dabur red", "patanjali", "vicco", "meswak", "himalaya", "listerine", "clove"]
};

// Aliases for export
export const CATEGORY_HEAD_TERMS = HEAD_TERMS;

const GENERIC_BLACKLIST = new Set([
    "india", "online", "price", "review", "reviews", "offer", "offers", "benefit", "benefits", 
    "best", "top", "cheap", "buy", "sale", "near me", "shop", "store", "cost", "how to", "what is",
    "2023", "2024", "2025", "2026", "2027", "vs", "compare", "list", "guide", "men", "for men", "shopping", "products"
]);

const FEMALE_EXCLUSIONS = new Set([
    "women", "womens", "woman", "female", "ladies", "girl", "girls", "she", "her",
    "bridal", "bride", "maternity", "pregnancy", "mom", "mother", "sister", "wife",
    "saree", "kurta", "lehenga", "makeup", "lipstick", "mascara", "foundation", "eyeliner", "blush",
    "bra", "panty", "lingerie", "sanitary", "period", "menstrual", "vagina", "vaginal"
]);

export const CategoryKeywordGuard = {
    /**
     * isSpecific (v3 Strict + Female Guard)
     * Rules:
     * 1. Token count >= 2 (Exceptions for known Head Terms/Brands)
     * 2. No pure generic words
     * 3. No year tokens
     * 4. No female-specific terms
     * 5. MUST contain a category HEAD_TERM or (BRAND + NON-GENERIC)
     */
    isSpecific(keyword: string, categoryId: string): { ok: boolean; reason: string; matchedToken?: string } {
        if (!keyword) return { ok: false, reason: "Empty" };
        const norm = keyword.toLowerCase().trim();
        const tokens = norm.split(/\s+/);
        
        if (norm.length < 3) return { ok: false, reason: "Too Short (Min 3 chars)" };
        if (/\b(2023|2024|2025|2026|2027)\b/.test(norm)) return { ok: false, reason: "Contains Year Token" };

        const hasFemale = tokens.some(t => FEMALE_EXCLUSIONS.has(t));
        if (hasFemale) return { ok: false, reason: "Female-Specific Intent" };

        const heads = HEAD_TERMS[categoryId] || [];
        const brands = BRAND_PACKS[categoryId] || [];

        // SINGLE-TOKEN: allow known head terms and brands
        if (tokens.length === 1) {
            if (heads.some(h => norm === h)) return { ok: true, reason: "OK", matchedToken: "HEAD_SINGLE" };
            if (brands.some(b => norm === b)) return { ok: true, reason: "OK", matchedToken: "BRAND_SINGLE" };
            return { ok: false, reason: "Single token, not a known head term or brand" };
        }

        // MULTI-TOKEN
        const isAllGeneric = tokens.every(t => GENERIC_BLACKLIST.has(t) || ['in', 'for', 'the', 'and', 'to', 'with', 'of', 'on', 'at', 'by'].includes(t));
        if (isAllGeneric) return { ok: false, reason: "Generic Composition" };
        
        const hasHead = heads.some(h => norm.includes(h));
        if (hasHead) return { ok: true, reason: "OK", matchedToken: "HEAD" };

        const hasBrand = brands.some(b => norm.includes(b));
        if (hasBrand) {
            let remainder = norm;
            brands.forEach(b => { if (remainder.includes(b)) remainder = remainder.replace(b, '').trim(); });
            const remainderTokens = remainder.split(/\s+/).filter(t => t.length > 0);
            
            if (remainderTokens.length === 0) return { ok: true, reason: "OK", matchedToken: "BRAND" };

            const COMMERCE = new Set(['price','cost','buy','online','review','reviews','offer','offers','sale','shop','store','best','top','products','range','combo','kit','new','latest','compare','vs','alternative', 'near me']);
            if (remainderTokens.some(t => COMMERCE.has(t))) return { ok: true, reason: "OK", matchedToken: "BRAND_COMMERCE" };

            const isRemainderGeneric = remainderTokens.every(t => GENERIC_BLACKLIST.has(t) || ['in','for','the','and','to','with','of','on'].includes(t));
            if (isRemainderGeneric) return { ok: false, reason: "Brand + Generic (Low Value)" };

            return { ok: true, reason: "OK", matchedToken: "BRAND" };
        }

        return { ok: false, reason: "Not Category-Specific (Missing Head Term or Qualified Brand)" };
    }
};
