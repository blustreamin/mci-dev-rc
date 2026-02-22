
export type McCategoryId = string;

const COMMON_NEGATIVES = ["tooth", "teeth", "whitening", "dentist", "mouth", "gum", "toothpaste", "oral"];

export const SIGNAL_CATEGORY_ALIASES: Record<McCategoryId, string[]> = {
  "intimate-hygiene": [
    "intimate-hygiene", "intimate-hygiene-men", "intimate-hygiene-(men)", 
    "intimate-hygiene-men’s", "sexual-wellness", "personal-hygiene", "hygiene", "mens-hygiene",
    "groin-hygiene", "intimate-wash", "intimate-care", "private-parts-hygiene", 
    "jock-itch", "itching", "bad-odor", "sweat-odor", "body-odor", "inner-thigh-rash",
    "groin", "sweat", "fungal", "chafing", "private parts"
  ],
  "shaving": ["shave", "shaving", "razor", "razors", "gillette", "blade", "blades", "cartridge", "cartridges", "foam", "gel", "aftershave", "stubble", "clean shave", "shaving-care", "mens-shaving"],
  "beard": ["beard", "beard-care", "beard-grooming", "beard-oil", "trimmer", "trimmers", "facial-hair"],
  "hair-styling": ["hair", "hairstyling", "hair-gel", "hair-wax", "pomade", "hair-styling"],
  "face-care": ["face", "skincare", "face-wash", "skin", "mens-grooming", "acne"],
  "deodorants": ["deodorants", "deo", "perfume", "fragrance", "body-spray", "scent", "cologne"],
  "sexual-wellness": ["sexual-wellness", "sexual-health", "condoms", "lubes", "wellness", "intimacy"],
  "hair-colour": ["hair-colour", "hair-color", "hair-dye", "grey-coverage", "hair-coloring"],
  "hair-oil": ["hair-oil", "hair-care", "oil", "scalp-care", "hair-fall"],
  "oral-care": ["oral-care", "toothpaste", "mouthwash", "dental", "teeth", "breath"]
};

export const CATEGORY_NEGATIVES: Record<McCategoryId, string[]> = {
  "intimate-hygiene": COMMON_NEGATIVES
};

export function getSignalCategoryAliases(categoryId: string): string[] {
  return SIGNAL_CATEGORY_ALIASES[categoryId] || [categoryId];
}

export function getCategoryNegatives(categoryId: string): string[] {
    return CATEGORY_NEGATIVES[categoryId] || [];
}
