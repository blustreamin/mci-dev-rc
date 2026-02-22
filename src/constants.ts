import { CategoryBaseline } from './types';
import { CANONICAL_ANCHORS } from './contracts/canonicalAnchors';

/**
 * Internal System Metadata
 * @traceability: v1.0-rc
 */
export const INTERNAL_VERSION_TAG = "LKG-20260115-STABLE";
export const INTERNAL_VERSION_STATUS = "BLESSED";
export const INTERNAL_VERSION_NOTES = "Last Known Good — Fingerprint matching intentionally disabled/ignored.";

export const TRUTH_STORE_DEPRECATED = true;

// Helper to get anchors safely
const getAnchors = (id: string) => CANONICAL_ANCHORS[id] || [];

export const CORE_CATEGORIES: CategoryBaseline[] = [
  { 
    id: 'shaving', category: 'Shaving', demandIndex: 2.8, engagementReadiness: 'Medium', demandSpread: 'Medium', shortlist: false, 
    consumerDescription: "Achieve a clean, smooth look without nicks or burns. Essential tools and prep for daily grooming.",
    anchors: getAnchors('shaving'),
    subCategories: [{ name: 'Strategic Pillars', anchors: getAnchors('shaving') }],
    defaultKeywords: ['razor for men', 'shaving cream', 'after shave balm', 'electric shaver', 'razor burn solution'],
    kantarMapping: { status: 'Partially Covered', mappedSubCategories: ['Depilatories', 'Hot/Cold Wax', 'Razors', 'Creams', 'Lotion', 'Blades'] },
    nielsenMapping: { status: 'Fully Covered', mappedSubCategories: ['Safty Razor blades & twin blads', 'Shaving Preprations', 'Razors (Manual/Electric)', 'Shaving Crème', 'Post shave balm'] },
    coverageNotes: 'KANTAR clubs under generic "Depilatories". Nielsen has deeper split for tools and preparations.',
    keyBrands: ['Gillette', 'Bombay Shaving Co.', 'Beardo', 'Ustraa', 'Philips', 'The Man Company']
  },
  { 
    id: 'beard', category: 'Beard Care & Beard Colour', demandIndex: 7.3, engagementReadiness: 'High', demandSpread: 'High', shortlist: true, 
    consumerDescription: "Maintain a healthy, styled beard. Soften bristles, promote growth, and cover greys effectively.",
    anchors: getAnchors('beard'),
    subCategories: [{ name: 'Strategic Pillars', anchors: getAnchors('beard') }],
    defaultKeywords: ['beard oil', 'beard wash', 'beard trimmer', 'grey beard cover', 'beard styling wax'],
    kantarMapping: { status: 'Not Covered', mappedSubCategories: [] },
    nielsenMapping: { status: 'Fully Covered', mappedSubCategories: ['Beard Grooming (Skin Creams)', 'Beard / Moustache Colorants', 'Beard Oil', 'Beard Wash'] },
    coverageNotes: 'Major gap in KANTAR. Nielsen classifies under "Skin Creams" but identifies beard-specific usage.',
    keyBrands: ['Gillette', 'Bombay Shaving Co.', 'Beardo', 'Ustraa', 'Philips', 'The Man Company', 'Godrej Expert']
  },
  { 
    id: 'hair-styling', category: 'Hair Styling', demandIndex: 24.4, engagementReadiness: 'High', demandSpread: 'High', shortlist: true, 
    consumerDescription: "Create defined, lasting hairstyles. From spikes to slick-backs using gels, waxes, and sprays.",
    anchors: getAnchors('hair-styling'),
    subCategories: [{ name: 'Strategic Pillars', anchors: getAnchors('hair-styling') }],
    defaultKeywords: ['hair wax', 'hair gel', 'men hairstyles 2024', 'hair pomade', 'matte hair wax'],
    kantarMapping: { status: 'Not Covered', mappedSubCategories: [] },
    nielsenMapping: { status: 'Partially Covered', mappedSubCategories: ['Hair Care Oils', 'Hair Gels'] },
    coverageNotes: 'Limited coverage of specialized styling formats (wax, clay, sprays) in both panels.',
    keyBrands: ['Set Wet (Marico)', 'Gatsby', 'Park Avenue', 'Brylcreem', 'Beardo', 'Ustraa']
  },
  { 
    id: 'sexual-wellness', category: 'Sexual Wellness', demandIndex: 4.6, engagementReadiness: 'High', demandSpread: 'Medium', shortlist: true, 
    consumerDescription: "Ensure pleasure, protection, and performance. Discrete solutions for intimacy and stamina.",
    anchors: getAnchors('sexual-wellness'),
    subCategories: [{ name: 'Strategic Pillars', anchors: getAnchors('sexual-wellness') }],
    defaultKeywords: ['condoms', 'delay spray', 'sexual health for men', 'stamina booster', 'lubricant'],
    kantarMapping: { status: 'Not Covered', mappedSubCategories: [] },
    nielsenMapping: { status: 'Fully Covered', mappedSubCategories: ['Condoms', 'Delay Sprays', 'Lubricants', 'Performance Supplements'] },
    coverageNotes: 'Nielsen tracks this as a distinct wellness block. KANTAR misses it entirely.',
    keyBrands: ['Durex', 'Manforce', 'Moods', 'KamaSutra', 'Bold Care', 'Man Matters', 'Misters']
  },
  { 
    id: 'intimate-hygiene', category: 'Intimate Hygiene (Men)', demandIndex: 1.75, engagementReadiness: 'Medium', demandSpread: 'Medium', shortlist: false, 
    consumerDescription: "Stay fresh and comfortable. Prevent itch, sweat, and odor in intimate areas.",
    anchors: getAnchors('intimate-hygiene'),
    subCategories: [{ name: 'Strategic Pillars', anchors: getAnchors('intimate-hygiene') }],
    defaultKeywords: ['intimate wash', 'groin sweat control', 'thigh chafing cream', 'private part itching'],
    kantarMapping: { status: 'Not Covered', mappedSubCategories: [] },
    nielsenMapping: { status: 'Partially Covered', mappedSubCategories: ['Intimate Hygiene (Liq Toilet soaps)', 'Tissue Papers', 'Anti Fungle Powders'] },
    coverageNotes: 'Emerging male category. Nielsen captures via liquid toilet soap/tissue clubbing.',
    keyBrands: ['Bold Care', 'Man Matters', 'Misters', 'Ustraa']
  },
  { 
    id: 'hair-colour', category: 'Hair Colour (Head)', demandIndex: 2.3, engagementReadiness: 'Medium', demandSpread: 'Medium', shortlist: false, 
    consumerDescription: "Restore natural black hair or experiment with style. Quick, easy grey coverage solutions.",
    anchors: getAnchors('hair-colour'),
    subCategories: [{ name: 'Strategic Pillars', anchors: getAnchors('hair-colour') }],
    defaultKeywords: ['hair colour for men', 'grey hair treatment', 'ammonia free hair colour', 'shampoo hair colour'],
    kantarMapping: { status: 'Fully Covered', mappedSubCategories: ['Hair Colour', 'Hair Colorant', 'Mehendi', 'Men', 'Ayurvedic'] },
    nielsenMapping: { status: 'Fully Covered', mappedSubCategories: ['Hair Colours', 'Shampoo Hair Colour', 'Crème Hair Colour', 'Powders', 'Paste'] },
    coverageNotes: 'Well-covered by both. KANTAR has specific "Men" segment flag.',
    keyBrands: ['Godrej Expert Rich Crème', 'Garnier Men', 'Indica Herbal', 'Revlon Men']
  },
  { 
    id: 'face-care', category: 'Face Care', demandIndex: 11.9, engagementReadiness: 'High', demandSpread: 'High', shortlist: true, 
    consumerDescription: "Combat oil, acne, and pollution. Brighten skin and maintain a healthy, youthful glow.",
    anchors: getAnchors('face-care'),
    subCategories: [{ name: 'Strategic Pillars', anchors: getAnchors('face-care') }],
    defaultKeywords: ['face wash for men', 'sunscreen for men', 'pimple cream', 'face cream for men'],
    kantarMapping: { status: 'Fully Covered', mappedSubCategories: ['Facewash', 'Skin Creams', 'Face Scrub', 'Anti Ageing', 'Fairness', 'Oil Control', 'Moisturising'] },
    nielsenMapping: { status: 'Fully Covered', mappedSubCategories: ['Skin Creams', 'Face Care (Segment covered)'] },
    coverageNotes: 'Very granular in KANTAR. Nielsen clubs more under generic Skin Creams.',
    keyBrands: ['Nivea Men', 'L’Oréal Men Expert', 'Garnier Men', 'The Man Company', 'Beardo', 'Ustraa']
  },
  { 
    id: 'deodorants', category: 'Deodorants / Body Sprays / Perfumes', demandIndex: 5.9, engagementReadiness: 'High', demandSpread: 'High', shortlist: true, 
    consumerDescription: "Stay fresh and odor-free all day. Fragrances for confidence in social and professional settings.",
    anchors: getAnchors('deodorants'),
    subCategories: [{ name: 'Strategic Pillars', anchors: getAnchors('deodorants') }],
    defaultKeywords: ['best perfume for men', 'deodorant', 'body spray', 'long lasting fragrance'],
    kantarMapping: { status: 'Fully Covered', mappedSubCategories: ['Deodorant', 'Men', 'Women', 'Aerosol', 'Roll On', 'Pocket', 'No Gas'] },
    nielsenMapping: { status: 'Fully Covered', mappedSubCategories: ['Deodorant & Perfumes', 'Deos (Gas / No Gas)', 'Roll ons', 'EDTs', 'Colognes'] },
    coverageNotes: 'High fidelity coverage in both panels. Key split is Gas vs Non-Gas.',
    keyBrands: ['Fogg', 'Wild Stone', 'Axe', 'Engage', 'Park Avenue']
  },
  { 
    id: 'hair-oil', category: 'Hair Oil', demandIndex: 4.98, engagementReadiness: 'High', demandSpread: 'High', shortlist: true, 
    consumerDescription: "Nourish scalp and strengthen hair roots. Traditional and modern solutions for hair health.",
    anchors: getAnchors('hair-oil'),
    subCategories: [{ name: 'Strategic Pillars', anchors: getAnchors('hair-oil') }],
    defaultKeywords: ['hair oil for men', 'onion hair oil', 'ayurvedic hair oil', 'non sticky hair oil'],
    kantarMapping: { status: 'Fully Covered', mappedSubCategories: ['Hair Oil', 'Heavy Amla', 'Coconut Oils', 'Light hair oils', 'Ayurvedic', 'Serums'] },
    nielsenMapping: { status: 'Fully Covered', mappedSubCategories: ['Hair Care Oils', 'Heavy Amla', 'Coconut Oils', 'Coconut Based light hair oils', 'Ayurvedic', 'Cooling'] },
    coverageNotes: 'Dominant category in India. Strong split between Coconut, Ayurvedic and Light oils.',
    keyBrands: ['Marico (Parachute Advansed Men)', 'Indulekha', 'Emami Navratna', 'Beardo', 'Dabur']
  },
  { 
    id: 'fragrance-premium', category: 'Fragrances (Premium)', demandIndex: 3.2, engagementReadiness: 'Medium-High', demandSpread: 'Medium', shortlist: false, 
    consumerDescription: "Make a lasting impression with sophisticated scents. Luxury perfumes for special occasions.",
    anchors: getAnchors('fragrance-premium'),
    subCategories: [{ name: 'Strategic Pillars', anchors: getAnchors('fragrance-premium') }],
    defaultKeywords: ['luxury perfume men', 'oud fragrance', 'wedding perfume for men', 'designer fragrance'],
    kantarMapping: { status: 'Not Covered', mappedSubCategories: [] },
    nielsenMapping: { status: 'Partially Covered', mappedSubCategories: ['Deodorant & Perfumes'] },
    coverageNotes: 'Panel gaps in premium lifestyle. Clubs with mass deodorants.',
    keyBrands: ['Skinn Titan', 'Villain', 'Beardo', 'Ustraa', 'The Man Company', 'Ajmal']
  },
  { 
    id: 'skincare-spec', category: 'Skincare Specialist', demandIndex: 9.2, engagementReadiness: 'High', demandSpread: 'High', shortlist: true, 
    consumerDescription: "Target specific concerns like aging and dark circles. Advanced care for refined skin health.",
    anchors: getAnchors('skincare-spec'),
    subCategories: [{ name: 'Strategic Pillars', anchors: getAnchors('skincare-spec') }],
    defaultKeywords: ['vitamin c serum', 'under eye cream', 'anti aging for men', 'dark spot removal'],
    kantarMapping: { status: 'Partially Covered', mappedSubCategories: ['Skin Creams', 'Face Scrub', 'Anti Ageing', 'Sunscreen'] },
    nielsenMapping: { status: 'Partially Covered', mappedSubCategories: ['Skin Creams', 'Face Care'] },
    coverageNotes: 'Usually clubbed under face care. Hard to peel out "specialist" (Serums/Treatments).',
    keyBrands: ['The Man Company', 'Man Matters', 'Beardo', 'Clinique Men', 'Olay Men']
  },
  { 
    id: 'shampoo', category: 'Shampoo / Conditioner', demandIndex: 0.9, engagementReadiness: 'Medium-High', demandSpread: 'Low', shortlist: false, 
    consumerDescription: "Cleanse scalp and fight dandruff. Essential routine for strong, problem-free hair.",
    anchors: getAnchors('shampoo'),
    subCategories: [{ name: 'Strategic Pillars', anchors: getAnchors('shampoo') }],
    defaultKeywords: ['anti dandruff shampoo', 'hair fall control shampoo', 'conditioner for men'],
    kantarMapping: { status: 'Fully Covered', mappedSubCategories: ['Shampoo & Conditioners', 'Sachet', 'Bottles', 'Anti Dandruff', 'Anti Hairfall', 'Damage Repair'] },
    nielsenMapping: { status: 'Fully Covered', mappedSubCategories: ['Shampoo & Conditioners', 'Sachet', 'Bottles', 'Anti Dandruff', 'Anti Hairfall', 'Maintenance'] },
    coverageNotes: 'Mass category. High fidelity coverage.',
    keyBrands: ['Head & Shoulders', 'Clear Men', 'Beardo', 'Man Matters']
  },
  { 
    id: 'soap', category: 'Soap / Body Wash / Shower Gel', demandIndex: 1.4, engagementReadiness: 'High', demandSpread: 'Medium-Low', shortlist: false, 
    consumerDescription: "Refresh and energize daily. Deep cleansing to remove dirt, sweat, and germs.",
    anchors: getAnchors('soap'),
    subCategories: [{ name: 'Strategic Pillars', anchors: getAnchors('soap') }],
    defaultKeywords: ['body wash for men', 'shower gel', 'bathing soap', 'charcoal body wash'],
    kantarMapping: { status: 'Fully Covered', mappedSubCategories: ['Bar Soaps', 'Body Wash', 'Beauty', 'Herbal', 'Anti Bacterial', 'Freshness', 'Baby'] },
    nielsenMapping: { status: 'Fully Covered', mappedSubCategories: ['Toilet Soaps', 'Liq Toilet Soaps', 'Bars', 'Body wash', 'shower gels'] },
    coverageNotes: 'Transitioning from Bars to Body Wash. Well tracked.',
    keyBrands: ['Lifebuoy', 'Cinthol', 'Park Avenue', 'Fiama Men', 'Nivea Men']
  },
  { 
    id: 'body-lotion', category: 'Body Lotion / Cream', demandIndex: 2.6, engagementReadiness: 'Medium', demandSpread: 'Medium', shortlist: false, 
    consumerDescription: "Hydrate and protect skin from dryness. Non-sticky moisture for rough male skin.",
    anchors: getAnchors('body-lotion'),
    subCategories: [{ name: 'Strategic Pillars', anchors: getAnchors('body-lotion') }],
    defaultKeywords: ['body lotion for men', 'winter cream', 'non greasy lotion', 'spf body lotion'],
    kantarMapping: { status: 'Partially Covered', mappedSubCategories: ['Skin Creams'] },
    nielsenMapping: { status: 'Fully Covered', mappedSubCategories: ['Creams and Lotion', 'Moisturizing lotions', 'cooling gels', 'non-sticky creams'] },
    coverageNotes: 'KANTAR clubs with skin creams. Nielsen has better sub-format visibility.',
    keyBrands: ['Nivea Men', 'Vaseline Men', 'Pond’s Men', 'The Man Company']
  },
  { 
    id: 'talcum', category: 'Talcum Powder', demandIndex: 0.014, engagementReadiness: 'Low', demandSpread: 'Low', shortlist: false, 
    consumerDescription: "Beat the heat and stay dry. Cooling relief from sweat and prickly heat.",
    anchors: getAnchors('talcum'),
    subCategories: [{ name: 'Strategic Pillars', anchors: getAnchors('talcum') }],
    defaultKeywords: ['cooling powder', 'prickly heat powder', 'talcum powder men'],
    kantarMapping: { status: 'Fully Covered', mappedSubCategories: ['Talcum Powder', 'Men', 'Baby', 'Woman', 'Floral', 'Prickly & Cooling'] },
    nielsenMapping: { status: 'Fully Covered', mappedSubCategories: ['Talcum Powder', 'Baby & Non baby', 'Talcum', 'Preekly'] },
    coverageNotes: 'Declining but still massive for mass India summer. Well covered.',
    keyBrands: ['Cinthol', 'Park Avenue', 'Navratna', 'Engage']
  },
  { 
    id: 'oral-care', category: 'Oral Care', demandIndex: 0.9, engagementReadiness: 'Low', demandSpread: 'Low', shortlist: false, 
    consumerDescription: "Ensure fresh breath and healthy teeth. Confidence in every smile and conversation.",
    anchors: getAnchors('oral-care'),
    subCategories: [{ name: 'Strategic Pillars', anchors: getAnchors('oral-care') }],
    defaultKeywords: ['whitening toothpaste', 'bad breath solution', 'mouthwash men'],
    kantarMapping: { status: 'Fully Covered', mappedSubCategories: ['Oral Care', 'Whitening', 'Freshness', 'Sensetive', 'Herbal', 'Toothpowders'] },
    nielsenMapping: { status: 'Fully Covered', mappedSubCategories: ['Oral Care', 'Whitening', 'Freshness', 'Sensetive', 'Herbal', 'Toothpowders'] },
    coverageNotes: 'Pure commodity play for men. High panel fidelity.',
    keyBrands: ['Colgate', 'Pepsodent', 'Close-Up', 'Sensodyne', 'Dabur', 'Lal dant manjan']
  }
];