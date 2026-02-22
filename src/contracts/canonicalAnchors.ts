import { CanonicalCategory, CanonicalAnchor } from '../types';

/**
 * CANONICAL ANCHORS - Spread-Proportional
 * 
 * Anchor count is proportional to Demand Spread:
 * - High Spread (7+): 8-12 anchors (diverse search landscape)
 * - Medium Spread (5.5-7): 6-8 anchors
 * - Low Spread (<5.5): 4-6 anchors
 * 
 * This ensures categories with fragmented demand get deeper analysis
 * while concentrated categories stay focused.
 */
export const CANONICAL_ANCHORS: Record<string, string[]> = {

  // DEODORANTS — Spread: 8.3 → 10 anchors
  'deodorants': [
    "Odour Protection",
    "All-Day Longevity",
    "Fragrance Identity & Signature Scent",
    "Skin Safety & No Stains",
    "Sweat Control & Antiperspirant",
    "Daily Use Convenience",
    "Occasion & Context Fit",
    "Brand Loyalty & Switching",
    "Natural & Aluminium-Free",
    "Value Packs & Multi-Buy"
  ],

  // ORAL CARE — Spread: 8.0 → 10 anchors
  'oral-care': [
    "Fresh Breath Confidence",
    "Whitening & Stain Removal",
    "Sensitivity Relief",
    "Gum Health & Bleeding",
    "Daily Hygiene Routine",
    "Dentist Recommendation",
    "Electric vs Manual Choice",
    "Cavity Prevention",
    "Herbal & Ayurvedic Trust",
    "Kids & Family Products"
  ],

  // FACE CARE — Spread: 7.9 → 10 anchors
  'face-care': [
    "Acne & Oil Control",
    "Pollution & Sun Protection",
    "Brightening & Glow",
    "Anti-Ageing & Fine Lines",
    "Hydration & Moisturizing",
    "Dermatological Trust",
    "Active Ingredients (Vitamin C, Niacinamide)",
    "Dark Spots & Pigmentation",
    "Skincare Routine Building",
    "Budget-Friendly Skincare"
  ],

  // SHAMPOO — Spread: 7.6 → 9 anchors
  'shampoo': [
    "Dandruff Control",
    "Hair Fall Reduction",
    "Scalp Health & Itch Relief",
    "Daily Gentle Cleansing",
    "Ingredient Safety (Sulphate-Free)",
    "Value Packs & Family Size",
    "Conditioning & Softness",
    "Oily vs Dry Scalp Solutions",
    "Herbal & Natural Formulas"
  ],

  // SOAP — Spread: 7.3 → 9 anchors
  'soap': [
    "Germ Protection & Antibacterial",
    "Daily Freshness & Fragrance",
    "Skin Safety & Sensitivity",
    "Family Use & Multi-Purpose",
    "Value Pricing & Combos",
    "Brand Trust & Heritage",
    "Body Wash vs Bar Soap",
    "Moisturizing & Skin Care",
    "Natural & Organic Options"
  ],

  // HAIR COLOUR — Spread: 7.1 → 8 anchors
  'hair-colour': [
    "Grey Coverage Speed",
    "Natural Look & Finish",
    "Damage & Chemical Avoidance",
    "Ease of Home Application",
    "Colour Longevity",
    "Ingredient Safety (Ammonia-Free)",
    "Brand Trust & Salon Quality",
    "Beard Colour Specific"
  ],

  // HAIR OIL — Spread: 6.9 → 8 anchors
  'hair-oil': [
    "Hair Fall Control",
    "Scalp Nourishment & Dandruff",
    "Non-Sticky Lightweight Feel",
    "Cooling & Relaxation Ritual",
    "Ayurvedic & Herbal Trust",
    "Multi-Use Value",
    "Onion & Trending Ingredients",
    "Overnight Treatment & Deep Care"
  ],

  // SHAVING — Spread: 6.3 → 7 anchors
  'shaving': [
    "Hardware & Tools",
    "Skin Protection & Sensitivity",
    "Pre-Shave Preparation",
    "Post-Shave Care",
    "Speed & Convenience",
    "Cost & Refill Value",
    "Body Grooming & Manscaping"
  ],

  // BODY LOTION — Spread: 6.1 → 7 anchors
  'body-lotion': [
    "Deep Moisturization",
    "Non-Greasy Lightweight Feel",
    "Winter & Seasonal Protection",
    "Skin Repair & Healing",
    "Fragrance & Mildness",
    "Daily Routine Fit",
    "SPF & Sun Protection"
  ],

  // TALCUM — Spread: 5.9 → 7 anchors
  'talcum': [
    "Sweat Control",
    "Cooling Relief & Comfort",
    "Odour Masking",
    "Summer & Seasonal Need",
    "Skin Sensitivity & Safety",
    "Habitual Daily Usage",
    "Talc-Free Alternatives"
  ],

  // HAIR STYLING — Spread: 5.9 → 7 anchors
  'hair-styling': [
    "Hold & Control Strength",
    "Texture & Matte/Glossy Finish",
    "Daily Styling Convenience",
    "Damage & Hair Fall Avoidance",
    "Trend & Occasion Styling",
    "Washability & Residue-Free",
    "Hairstyle Discovery & Inspiration"
  ],

  // INTIMATE HYGIENE — Spread: 5.6 → 6 anchors
  'intimate-hygiene': [
    "Odour & Sweat Control",
    "Itch & Fungal Prevention",
    "Daily Freshness & Hygiene",
    "Skin Sensitivity & pH Balance",
    "Chafing & Rash Prevention",
    "Product Discovery & Awareness"
  ],

  // FRAGRANCES — Spread: 5.3 → 6 anchors
  'fragrance-premium': [
    "Status Signalling & Identity",
    "Longevity & Projection",
    "Occasion & Season Fit",
    "Brand Prestige & Luxury",
    "Clone & Affordable Alternatives",
    "Gifting & Presentation"
  ],

  // BEARD — Spread: 5.2 → 6 anchors
  'beard': [
    "Growth & Density",
    "Styling & Shape Control",
    "Grey Coverage",
    "Skin & Beard Health",
    "Maintenance Convenience",
    "Premium Grooming Identity"
  ],

  // SKINCARE SPECIALIST — Spread: 4.9 → 5 anchors
  'skincare-spec': [
    "Problem-Solution Urgency",
    "Active Ingredient Knowledge",
    "Visible Results & Before-After",
    "Routine Building & Layering",
    "Dermatologist & Expert Trust"
  ],

  // SEXUAL WELLNESS — Spread: 4.3 → 5 anchors
  'sexual-wellness': [
    "Performance & Stamina",
    "Protection & Safety",
    "Pleasure Enhancement",
    "Discretion & Privacy",
    "Health & Medical Trust"
  ]
};

export const CanonicalUtils = {
    getSchema(categoryId: string): CanonicalCategory {
        const anchors = CANONICAL_ANCHORS[categoryId] || [];
        const canonicalAnchors: CanonicalAnchor[] = anchors.map(name => ({
            id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            name: name,
            intent: 'Discovery', 
            subCategory: 'Strategic Pillars',
            fingerprint: { include: [name.toLowerCase()] }
        }));
        
        return {
            id: categoryId,
            anchors: canonicalAnchors
        };
    }
};
