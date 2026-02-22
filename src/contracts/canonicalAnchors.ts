import { CanonicalCategory, CanonicalAnchor } from '../types';

export const CANONICAL_ANCHORS: Record<string, string[]> = {
  'shaving': [
    "Hardware & Tools",
    "Skin Protection & Sensitivity",
    "Pre-Shave Preparation",
    "Post-Shave Care",
    "Speed & Convenience",
    "Cost & Refill Value"
  ],

  'beard': [
    "Growth & Density",
    "Styling & Shape Control",
    "Grey Coverage",
    "Skin & Beard Health",
    "Maintenance Convenience",
    "Premium Grooming Identity"
  ],

  'hair-styling': [
    "Hold & Control",
    "Texture & Finish",
    "Daily Styling Convenience",
    "Damage Avoidance",
    "Trend & Occasion Styling",
    "Washability & Residue"
  ],

  'sexual-wellness': [
    "Performance Anxiety",
    "Pleasure Enhancement",
    "Protection & Safety",
    "Discretion & Privacy",
    "Relationship Confidence",
    "Medical Trust"
  ],

  'intimate-hygiene': [
    "Odour & Sweat Control",
    "Itch & Fungal Prevention",
    "Daily Freshness",
    "Skin Sensitivity",
    "Discretion",
    "Doctor Recommendation"
  ],

  'hair-colour': [
    "Grey Coverage Speed",
    "Natural Look",
    "Damage Avoidance",
    "Ease of Application",
    "Longevity",
    "Ingredient Safety"
  ],

  'face-care': [
    "Acne & Oil Control",
    "Pollution Protection",
    "Brightening & Glow",
    "Anti-Ageing",
    "Hydration",
    "Dermatological Trust"
  ],

  'deodorants': [
    "Odour Protection",
    "Longevity",
    "Fragrance Identity",
    "Skin Safety",
    "Sweat Control",
    "Daily Use Convenience"
  ],

  'hair-oil': [
    "Hair Fall Control",
    "Scalp Nourishment",
    "Non-Sticky Feel",
    "Cooling & Relaxation",
    "Ayurvedic Trust",
    "Multi-Use Value"
  ],

  'fragrance-premium': [
    "Status Signalling",
    "Longevity & Projection",
    "Occasion Fit",
    "Ingredient Quality",
    "Brand Prestige",
    "Gifting Value"
  ],

  'skincare-spec': [
    "Problem-Solution Urgency",
    "Clinical Ingredients",
    "Visible Results",
    "Dermatologist Endorsement",
    "Routine Compatibility",
    "Premium Perception"
  ],

  'shampoo': [
    "Dandruff Control",
    "Hair Fall Reduction",
    "Scalp Health",
    "Daily Maintenance",
    "Ingredient Familiarity",
    "Value Packs"
  ],

  'soap': [
    "Germ Protection",
    "Daily Freshness",
    "Skin Safety",
    "Family Use",
    "Value Pricing",
    "Brand Trust"
  ],

  'body-lotion': [
    "Deep Moisturization",
    "Non-Greasy Feel",
    "Seasonal Protection",
    "Skin Repair",
    "Fragrance Mildness",
    "Daily Routine Fit"
  ],

  'talcum': [
    "Sweat Control",
    "Cooling Relief",
    "Odour Masking",
    "Summer Comfort",
    "Skin Sensitivity",
    "Habitual Usage"
  ],

  'oral-care': [
    "Fresh Breath",
    "Whitening",
    "Sensitivity Relief",
    "Gum Health",
    "Daily Hygiene",
    "Doctor Recommendation"
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