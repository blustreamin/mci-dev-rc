/**
 * ProjectContext — Dynamic Runtime Configuration
 * 
 * Replaces all hardcoded CORE_CATEGORIES, country='IN', location=2356, language='en'
 * with a user-defined, AI-generated project scope.
 * 
 * This is the single source of truth for "what are we researching, where, and for whom."
 */

import { CategoryBaseline } from '../types';

// --- GEOGRAPHY ---

export interface GeoConfig {
    country: string;           // ISO 2-letter: 'IN', 'US', 'GB', 'AE', etc.
    countryName: string;       // 'India', 'United States', etc.
    locationCode: number;      // DataForSEO location code: 2356, 2840, etc.
    language: string;          // ISO: 'en', 'hi', 'ar', etc.
    languageName: string;      // 'English', 'Hindi', etc.
    marketTier?: string;       // Optional: 'All', 'Metro/Tier 1', 'Tier 2', 'Tier 3'
}

// --- INDUSTRY ---

export type IndustryId = 
    | 'fmcg-cpg'
    | 'beauty-personal-care'
    | 'consumer-electronics'
    | 'food-beverage'
    | 'health-wellness'
    | 'fashion-apparel'
    | 'automotive'
    | 'home-living'
    | 'financial-services'
    | 'technology-saas'
    | 'travel-hospitality'
    | 'education'
    | 'retail-d2c'
    | 'other';

export interface IndustryOption {
    id: IndustryId;
    label: string;
    icon: string;    // emoji for quick visual
    examples: string;
}

export const INDUSTRIES: IndustryOption[] = [
    { id: 'fmcg-cpg', label: 'FMCG / CPG', icon: '🧴', examples: 'Soaps, detergents, packaged foods, toiletries' },
    { id: 'beauty-personal-care', label: 'Beauty & Personal Care', icon: '💄', examples: 'Skincare, haircare, cosmetics, grooming' },
    { id: 'consumer-electronics', label: 'Consumer Electronics', icon: '📱', examples: 'Smartphones, laptops, wearables, audio' },
    { id: 'food-beverage', label: 'Food & Beverage', icon: '🍽️', examples: 'Snacks, beverages, dairy, health foods' },
    { id: 'health-wellness', label: 'Health & Wellness', icon: '💊', examples: 'Supplements, fitness, pharma OTC, mental health' },
    { id: 'fashion-apparel', label: 'Fashion & Apparel', icon: '👕', examples: 'Clothing, footwear, accessories, luxury' },
    { id: 'automotive', label: 'Automotive', icon: '🚗', examples: 'Cars, EVs, two-wheelers, aftermarket' },
    { id: 'home-living', label: 'Home & Living', icon: '🏠', examples: 'Furniture, appliances, home decor, kitchen' },
    { id: 'financial-services', label: 'Financial Services', icon: '💳', examples: 'Banking, insurance, lending, investments' },
    { id: 'technology-saas', label: 'Technology / SaaS', icon: '💻', examples: 'Software, cloud, dev tools, AI products' },
    { id: 'travel-hospitality', label: 'Travel & Hospitality', icon: '✈️', examples: 'Hotels, airlines, tourism, experiences' },
    { id: 'education', label: 'Education', icon: '📚', examples: 'EdTech, coaching, courses, universities' },
    { id: 'retail-d2c', label: 'Retail / D2C', icon: '🛒', examples: 'E-commerce, marketplace, direct-to-consumer' },
    { id: 'other', label: 'Other', icon: '🔍', examples: 'Custom category not listed above' },
];

// --- SUPPORTED COUNTRIES (Top markets with DFS location codes) ---

export interface CountryOption {
    code: string;
    name: string;
    locationCode: number;
    defaultLanguage: string;
    defaultLanguageName: string;
    languages: { code: string; name: string }[];
    flag: string;
}

export const COUNTRIES: CountryOption[] = [
    { code: 'IN', name: 'India', locationCode: 2356, defaultLanguage: 'en', defaultLanguageName: 'English', flag: '🇮🇳',
      languages: [{ code: 'en', name: 'English' }, { code: 'hi', name: 'Hindi' }, { code: 'ta', name: 'Tamil' }, { code: 'te', name: 'Telugu' }, { code: 'bn', name: 'Bengali' }, { code: 'mr', name: 'Marathi' }] },
    { code: 'US', name: 'United States', locationCode: 2840, defaultLanguage: 'en', defaultLanguageName: 'English', flag: '🇺🇸',
      languages: [{ code: 'en', name: 'English' }, { code: 'es', name: 'Spanish' }] },
    { code: 'GB', name: 'United Kingdom', locationCode: 2826, defaultLanguage: 'en', defaultLanguageName: 'English', flag: '🇬🇧',
      languages: [{ code: 'en', name: 'English' }] },
    { code: 'AE', name: 'United Arab Emirates', locationCode: 2784, defaultLanguage: 'en', defaultLanguageName: 'English', flag: '🇦🇪',
      languages: [{ code: 'en', name: 'English' }, { code: 'ar', name: 'Arabic' }] },
    { code: 'SA', name: 'Saudi Arabia', locationCode: 2682, defaultLanguage: 'ar', defaultLanguageName: 'Arabic', flag: '🇸🇦',
      languages: [{ code: 'ar', name: 'Arabic' }, { code: 'en', name: 'English' }] },
    { code: 'DE', name: 'Germany', locationCode: 2276, defaultLanguage: 'de', defaultLanguageName: 'German', flag: '🇩🇪',
      languages: [{ code: 'de', name: 'German' }, { code: 'en', name: 'English' }] },
    { code: 'FR', name: 'France', locationCode: 2250, defaultLanguage: 'fr', defaultLanguageName: 'French', flag: '🇫🇷',
      languages: [{ code: 'fr', name: 'French' }, { code: 'en', name: 'English' }] },
    { code: 'JP', name: 'Japan', locationCode: 2392, defaultLanguage: 'ja', defaultLanguageName: 'Japanese', flag: '🇯🇵',
      languages: [{ code: 'ja', name: 'Japanese' }, { code: 'en', name: 'English' }] },
    { code: 'AU', name: 'Australia', locationCode: 2036, defaultLanguage: 'en', defaultLanguageName: 'English', flag: '🇦🇺',
      languages: [{ code: 'en', name: 'English' }] },
    { code: 'CA', name: 'Canada', locationCode: 2124, defaultLanguage: 'en', defaultLanguageName: 'English', flag: '🇨🇦',
      languages: [{ code: 'en', name: 'English' }, { code: 'fr', name: 'French' }] },
    { code: 'BR', name: 'Brazil', locationCode: 2076, defaultLanguage: 'pt', defaultLanguageName: 'Portuguese', flag: '🇧🇷',
      languages: [{ code: 'pt', name: 'Portuguese' }] },
    { code: 'MX', name: 'Mexico', locationCode: 2484, defaultLanguage: 'es', defaultLanguageName: 'Spanish', flag: '🇲🇽',
      languages: [{ code: 'es', name: 'Spanish' }] },
    { code: 'SG', name: 'Singapore', locationCode: 2702, defaultLanguage: 'en', defaultLanguageName: 'English', flag: '🇸🇬',
      languages: [{ code: 'en', name: 'English' }, { code: 'zh', name: 'Chinese' }, { code: 'ms', name: 'Malay' }] },
    { code: 'ID', name: 'Indonesia', locationCode: 2360, defaultLanguage: 'id', defaultLanguageName: 'Indonesian', flag: '🇮🇩',
      languages: [{ code: 'id', name: 'Indonesian' }, { code: 'en', name: 'English' }] },
    { code: 'KR', name: 'South Korea', locationCode: 2410, defaultLanguage: 'ko', defaultLanguageName: 'Korean', flag: '🇰🇷',
      languages: [{ code: 'ko', name: 'Korean' }, { code: 'en', name: 'English' }] },
    { code: 'NG', name: 'Nigeria', locationCode: 2566, defaultLanguage: 'en', defaultLanguageName: 'English', flag: '🇳🇬',
      languages: [{ code: 'en', name: 'English' }] },
    { code: 'ZA', name: 'South Africa', locationCode: 2710, defaultLanguage: 'en', defaultLanguageName: 'English', flag: '🇿🇦',
      languages: [{ code: 'en', name: 'English' }, { code: 'af', name: 'Afrikaans' }] },
    { code: 'PH', name: 'Philippines', locationCode: 2608, defaultLanguage: 'en', defaultLanguageName: 'English', flag: '🇵🇭',
      languages: [{ code: 'en', name: 'English' }, { code: 'tl', name: 'Filipino' }] },
    { code: 'TH', name: 'Thailand', locationCode: 2764, defaultLanguage: 'th', defaultLanguageName: 'Thai', flag: '🇹🇭',
      languages: [{ code: 'th', name: 'Thai' }, { code: 'en', name: 'English' }] },
    { code: 'IT', name: 'Italy', locationCode: 2380, defaultLanguage: 'it', defaultLanguageName: 'Italian', flag: '🇮🇹',
      languages: [{ code: 'it', name: 'Italian' }, { code: 'en', name: 'English' }] },
    { code: 'ES', name: 'Spain', locationCode: 2724, defaultLanguage: 'es', defaultLanguageName: 'Spanish', flag: '🇪🇸',
      languages: [{ code: 'es', name: 'Spanish' }, { code: 'en', name: 'English' }] },
    { code: 'TR', name: 'Turkey', locationCode: 2792, defaultLanguage: 'tr', defaultLanguageName: 'Turkish', flag: '🇹🇷',
      languages: [{ code: 'tr', name: 'Turkish' }, { code: 'en', name: 'English' }] },
    { code: 'EG', name: 'Egypt', locationCode: 2818, defaultLanguage: 'ar', defaultLanguageName: 'Arabic', flag: '🇪🇬',
      languages: [{ code: 'ar', name: 'Arabic' }, { code: 'en', name: 'English' }] },
    { code: 'MY', name: 'Malaysia', locationCode: 2458, defaultLanguage: 'en', defaultLanguageName: 'English', flag: '🇲🇾',
      languages: [{ code: 'en', name: 'English' }, { code: 'ms', name: 'Malay' }] },
    { code: 'VN', name: 'Vietnam', locationCode: 2704, defaultLanguage: 'vi', defaultLanguageName: 'Vietnamese', flag: '🇻🇳',
      languages: [{ code: 'vi', name: 'Vietnamese' }, { code: 'en', name: 'English' }] },
];

// --- AI-GENERATED CATEGORY CONFIG ---

export interface AiGeneratedCategory {
    id: string;                // slug: 'premium-pet-food', 'electric-scooters', etc.
    category: string;          // Display name: 'Premium Pet Food'
    consumerDescription: string;
    anchors: string[];
    subCategories: { name: string; anchors: string[] }[];
    defaultKeywords: string[];
    keyBrands: string[];
    generatedAt: string;       // ISO timestamp
}

// --- PROJECT DEFINITION (the full scope) ---

export interface ProjectDefinition {
    projectId: string;         // Unique ID: 'proj_<timestamp>'
    projectName: string;       // User-facing: 'Premium Pet Food — India'
    
    // Step 1: Market
    industry: IndustryId;
    categoryInput: string;     // Raw user input: 'premium dog food'
    generatedCategory: AiGeneratedCategory | null;
    
    // Step 2: Geography
    geo: GeoConfig;
    
    // Metadata
    createdAt: string;
    status: 'DRAFTING' | 'GENERATING' | 'READY' | 'FAILED';
}

// --- ADAPTER: Convert ProjectDefinition → CategoryBaseline ---
// This is the bridge that lets all existing downstream gears work unchanged.

export function projectToCategories(project: ProjectDefinition): CategoryBaseline[] {
    if (!project.generatedCategory) return [];
    
    const gen = project.generatedCategory;
    return [{
        id: gen.id,
        category: gen.category,
        demandIndex: 0,          // Will be computed by demand sweep
        engagementReadiness: 'Unknown',
        demandSpread: 'Unknown',
        shortlist: true,
        consumerDescription: gen.consumerDescription,
        anchors: gen.anchors,
        subCategories: gen.subCategories,
        defaultKeywords: gen.defaultKeywords,
        kantarMapping: { status: 'Not Applicable', mappedSubCategories: [] },
        nielsenMapping: { status: 'Not Applicable', mappedSubCategories: [] },
        coverageNotes: `AI-generated category for ${project.geo.countryName}. Created ${gen.generatedAt}.`,
        keyBrands: gen.keyBrands,
    }];
}

// --- DEFAULT PROJECT (for backwards compatibility) ---

export function createDefaultProject(): ProjectDefinition {
    return {
        projectId: `proj_${Date.now()}`,
        projectName: '',
        industry: 'other',
        categoryInput: '',
        generatedCategory: null,
        geo: {
            country: 'IN',
            countryName: 'India',
            locationCode: 2356,
            language: 'en',
            languageName: 'English',
        },
        createdAt: new Date().toISOString(),
        status: 'DRAFTING',
    };
}
