/**
 * ScopeDefinition V2 — Self-Serve Project Setup
 * 
 * Two-step flow:
 * Step 1: Define your market (industry + free-text category → AI generates config)
 * Step 2: Select geography (country + language)
 * 
 * Outputs a ProjectDefinition that replaces hardcoded CORE_CATEGORIES.
 */

import React, { useState, useEffect } from 'react';
import { 
    ArrowRight, ArrowLeft, Sparkles, Globe, Loader2, Check, AlertTriangle, CheckCircle2,
    Search, ChevronDown, X, BarChart3, Tag, Building2, MapPin, Languages
} from 'lucide-react';
import { 
    INDUSTRIES, COUNTRIES, IndustryId, CountryOption,
    ProjectDefinition, createDefaultProject, GeoConfig
} from '../config/projectContext';
import { generateCategoryConfig, GenerationProgress } from '../services/categoryGenerationService';
import { AiGeneratedCategory } from '../config/projectContext';

interface ScopeDefinitionV2Props {
    onProjectReady: (project: ProjectDefinition) => void;
}

export const ScopeDefinitionV2: React.FC<ScopeDefinitionV2Props> = ({ onProjectReady }) => {
    const [step, setStep] = useState<1 | 2>(1);
    const [project, setProject] = useState<ProjectDefinition>(createDefaultProject());
    
    // Step 1 state
    const [selectedIndustry, setSelectedIndustry] = useState<IndustryId | null>(null);
    const [categoryText, setCategoryText] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [generationError, setGenerationError] = useState<string | null>(null);
    const [generatedCategory, setGeneratedCategory] = useState<AiGeneratedCategory | null>(null);
    const [genTelemetry, setGenTelemetry] = useState<string[]>([]);
    const [genProgress, setGenProgress] = useState<GenerationProgress | null>(null);
    
    // Step 2 state
    const [countrySearch, setCountrySearch] = useState('');
    const [showCountryDropdown, setShowCountryDropdown] = useState(false);
    const [selectedCountry, setSelectedCountry] = useState<CountryOption>(COUNTRIES[0]); // Default: India
    const [selectedLanguages, setSelectedLanguages] = useState<Set<string>>(new Set(['en']));

    // --- STEP 1: AI Category Generation ---
    const handleGenerate = async () => {
        if (!categoryText.trim() || !selectedIndustry) return;
        
        setIsGenerating(true);
        setGenerationError(null);
        setGeneratedCategory(null);
        setGenProgress(null);
        setGenTelemetry([]);

        const langNames = Array.from(selectedLanguages)
            .map(code => selectedCountry.languages.find(l => l.code === code)?.name || code)
            .join(', ');

        setGenTelemetry(prev => [...prev, `Market: ${selectedCountry.name} | Languages: ${langNames}`]);

        const result = await generateCategoryConfig({
            categoryText: categoryText.trim(),
            industry: selectedIndustry,
            countryName: selectedCountry.name,
            countryCode: selectedCountry.code,
            language: langNames,
        }, (progress) => {
            setGenProgress(progress);
            setGenTelemetry(prev => {
                const line = `[${progress.step}/${progress.totalSteps}] ${progress.phase}`;
                if (prev.length > 0 && prev[prev.length - 1].startsWith(`[${progress.step}/`)) {
                    return [...prev.slice(0, -1), line];
                }
                return [...prev, line];
            });
        });

        if (result.ok && result.category) {
            setGenTelemetry(prev => [...prev, `Done: ${result.category!.defaultKeywords.length} keywords | ${result.category!.anchors.length} anchors | ${result.category!.keyBrands.length} brands`]);
            setGeneratedCategory(result.category);
            setProject(prev => ({
                ...prev,
                industry: selectedIndustry,
                categoryInput: categoryText.trim(),
                generatedCategory: result.category!,
                projectName: `${result.category!.category} — ${selectedCountry.name}`,
                status: 'READY',
            }));
        } else {
            setGenTelemetry(prev => [...prev, `FAILED: ${result.error}`]);
            setGenerationError(result.error || 'Generation failed. Please try again.');
        }
        
        setIsGenerating(false);
    };

    // --- STEP 2: Geography ---
    const filteredCountries = COUNTRIES.filter(c => 
        c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
        c.code.toLowerCase().includes(countrySearch.toLowerCase())
    );

    const handleCountrySelect = (country: CountryOption) => {
        setSelectedCountry(country);
        setSelectedLanguages(new Set([country.defaultLanguage]));
        setShowCountryDropdown(false);
        setCountrySearch('');
        
        // If we already generated a category, we might want to regenerate for the new country
        // For now, just update the geo config
        setProject(prev => ({
            ...prev,
            geo: {
                country: country.code,
                countryName: country.name,
                locationCode: country.locationCode,
                language: country.defaultLanguage,
                languageName: country.defaultLanguageName,
                languages: country.languages.filter(l => l.code === country.defaultLanguage),
            },
            projectName: prev.generatedCategory 
                ? `${prev.generatedCategory.category} — ${country.name}`
                : prev.projectName,
        }));
    };

    const handleProceed = async () => {
        const primaryLang = Array.from(selectedLanguages)[0] || selectedCountry.defaultLanguage;
        const selectedLangObjects = selectedCountry.languages.filter(l => selectedLanguages.has(l.code));
        
        const finalProject: ProjectDefinition = {
            ...project,
            geo: {
                country: selectedCountry.code,
                countryName: selectedCountry.name,
                locationCode: selectedCountry.locationCode,
                language: primaryLang,
                languageName: selectedCountry.languages.find(l => l.code === primaryLang)?.name || primaryLang,
                languages: selectedLangObjects,
            },
        };
        
        // Persist to IndexedDB
        try {
            const { PlatformDB } = await import('../services/platformDB');
            await PlatformDB.saveProject(finalProject);
            if (finalProject.generatedCategory) {
                await PlatformDB.saveCategory(finalProject.generatedCategory.id, finalProject.generatedCategory);
                // Write seed corpus with correct SnapshotKeywordRow schema — DFS will overwrite
                const gen = finalProject.generatedCategory!;
                const subs = gen.subCategories || [];
                const corpus = gen.defaultKeywords.map((kw: string, idx: number) => {
                    const kwLower = kw.toLowerCase();
                    // Intent classification
                    let intent = 'NAVIGATIONAL';
                    if (/\b(buy|price|cost|cheap|deal|discount|shop|order|where to buy|near me|online|delivery)\b/.test(kwLower)) intent = 'TRANSACTIONAL';
                    else if (/\b(best|top|vs|versus|compare|review|rating|recommend|which)\b/.test(kwLower)) intent = 'COMMERCIAL';
                    else if (/\b(how|what|why|when|guide|tips|does|can|should|is it|benefits|difference|calories|nutrition|protein|healthy)\b/.test(kwLower)) intent = 'INFORMATIONAL';
                    // Anchor assignment — cycle through sub-categories
                    const sub = subs[idx % Math.max(subs.length, 1)];
                    const anchorId = sub?.name?.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 30) || 'general';
                    return {
                        keyword_id: `seed_${gen.id}__${idx}`,
                        keyword_text: kw,
                        volume: null,
                        anchor_id: anchorId,
                        intent_bucket: intent,
                        status: 'UNVERIFIED',
                        active: false,
                        language_code: finalProject.geo.language,
                        country_code: finalProject.geo.country,
                        category_id: gen.id,
                        created_at_iso: new Date().toISOString(),
                        validation_tier: 'AI_SEED',
                    };
                });
                // Only write seed corpus if no DFS-verified corpus exists yet
                const existingCorpus = await PlatformDB.getCorpus(gen.id);
                const hasVerifiedData = existingCorpus?.rows?.some((r: any) => r.status === 'VALID' || r.volume > 0);
                if (!hasVerifiedData) {
                    await PlatformDB.saveCorpus(gen.id, corpus);
                    console.log(`[ScopeV2] Seed corpus: ${corpus.length} keywords (UNVERIFIED, pending DFS)`);
                } else {
                    console.log(`[ScopeV2] Existing DFS-verified corpus found (${existingCorpus.rows.length} rows) — skipping seed overwrite`);
                }
            }
        } catch (e) {
            console.warn('[ScopeV2] IndexedDB persist failed, continuing anyway', e);
        }
        
        onProjectReady(finalProject);
    };

    // --- RENDER ---
    return (
        <div className="max-w-4xl mx-auto px-4 pb-32">
            {/* Header */}
            <div className="mb-10">
                <h1 className="text-3xl font-black text-[#0F172A] tracking-tight mb-2">New Research Project</h1>
                <p className="text-slate-500 text-lg">Define what you want to research and where. Our AI will set up the intelligence framework.</p>
            </div>

            {/* Progress Indicator */}
            <div className="flex items-center gap-3 mb-10">
                <div className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-blue-600 text-white shadow-lg">
                    <Building2 className="w-4 h-4" />
                    <span>Define Market & Geography</span>
                </div>
                {generatedCategory && (
                    <>
                        <div className="w-8 h-px bg-emerald-300" />
                        <div className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-emerald-50 text-emerald-700">
                            <CheckCircle2 className="w-4 h-4" />
                            <span>Framework Generated</span>
                        </div>
                    </>
                )}
            </div>

            {/* ============ STEP 1: MARKET DEFINITION ============ */}
            {step === 1 && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    
                    {/* Industry Selection */}
                    <div>
                        <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-3">Industry</label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                            {INDUSTRIES.map(ind => (
                                <button
                                    key={ind.id}
                                    onClick={() => setSelectedIndustry(ind.id)}
                                    className={`text-left p-3 rounded-xl border-2 transition-all ${
                                        selectedIndustry === ind.id 
                                            ? 'border-blue-600 bg-blue-50 shadow-md' 
                                            : 'border-slate-200 hover:border-slate-300 bg-white'
                                    }`}
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-lg">{ind.icon}</span>
                                        <span className="font-bold text-sm text-[#0F172A] leading-tight">{ind.label}</span>
                                    </div>
                                    <p className="text-[10px] text-slate-400 leading-tight">{ind.examples}</p>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Category Free Text */}
                    <div>
                        <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-3">
                            What specific category do you want to research?
                        </label>
                        <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input
                                type="text"
                                value={categoryText}
                                onChange={e => { setCategoryText(e.target.value); setGeneratedCategory(null); setGenerationError(null); }}
                                onKeyDown={e => { if (e.key === 'Enter' && categoryText.trim() && selectedIndustry) handleGenerate(); }}
                                placeholder="e.g. premium dog food, electric scooters, men's beard care, plant-based snacks..."
                                className="w-full pl-12 pr-4 py-4 text-lg border-2 border-slate-200 rounded-xl focus:border-blue-500 focus:outline-none transition-colors bg-white placeholder:text-slate-300"
                            />
                        </div>
                        <p className="mt-2 text-xs text-slate-400">Be specific. Include the product type, positioning (premium/mass), or target consumer if relevant.</p>
                    </div>

                    {/* Geography — inline on Step 1 */}
                    {selectedIndustry && categoryText.trim() && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Country */}
                            <div>
                                <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-3">
                                    <MapPin className="w-3 h-3 inline mr-1" /> Country / Market
                                </label>
                                <div className="relative">
                                    <button
                                        onClick={() => setShowCountryDropdown(!showCountryDropdown)}
                                        className="w-full flex items-center justify-between p-4 border-2 border-slate-200 rounded-xl bg-white hover:border-slate-300 transition-colors text-left"
                                    >
                                        <div className="flex items-center gap-3">
                                            <span className="text-2xl">{selectedCountry.flag}</span>
                                            <div>
                                                <p className="font-bold text-[#0F172A]">{selectedCountry.name}</p>
                                                <p className="text-xs text-slate-400">{selectedCountry.code} · {selectedCountry.locationCode}</p>
                                            </div>
                                        </div>
                                        <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${showCountryDropdown ? 'rotate-180' : ''}`} />
                                    </button>
                                    {showCountryDropdown && (
                                        <div className="absolute top-full left-0 right-0 mt-2 bg-white border-2 border-slate-200 rounded-xl shadow-xl z-50 max-h-60 overflow-y-auto">
                                            <div className="p-2 border-b border-slate-100 sticky top-0 bg-white">
                                                <input type="text" value={countrySearch} onChange={e => setCountrySearch(e.target.value)} placeholder="Search countries..." className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" autoFocus />
                                            </div>
                                            {filteredCountries.map(c => (
                                                <button key={c.code} onClick={() => handleCountrySelect(c)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 text-left transition-colors">
                                                    <span className="text-lg">{c.flag}</span>
                                                    <span className="font-bold text-sm text-slate-800">{c.name}</span>
                                                    <span className="text-xs text-slate-400 ml-auto">{c.code}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                            {/* Languages */}
                            <div>
                                <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-3">
                                    <Languages className="w-3 h-3 inline mr-1" /> Research Languages
                                </label>
                                <div className="flex flex-wrap gap-2">
                                    {selectedCountry.languages.map(lang => {
                                        const isSelected = selectedLanguages.has(lang.code);
                                        return (
                                            <button key={lang.code} onClick={() => {
                                                setSelectedLanguages(prev => {
                                                    const next = new Set(prev);
                                                    if (isSelected && next.size > 1) next.delete(lang.code);
                                                    else next.add(lang.code);
                                                    return next;
                                                });
                                            }} className={`px-4 py-3 rounded-xl border-2 font-bold text-sm transition-all ${isSelected ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}>
                                                {isSelected && <span className="mr-1">✓</span>}{lang.name}
                                                {lang.code === selectedCountry.defaultLanguage && <span className="ml-1 text-[9px] text-slate-400">Primary</span>}
                                            </button>
                                        );
                                    })}
                                </div>
                                <p className="mt-2 text-[10px] text-slate-400">Select all languages relevant to your research. Keywords generated across selected languages.</p>
                            </div>
                        </div>
                    )}

                    {/* Generate Button */}
                    {selectedIndustry && categoryText.trim() && !generatedCategory && (
                        <div>
                            <button
                                onClick={handleGenerate}
                                disabled={isGenerating}
                                className="w-full py-4 bg-gradient-to-r from-blue-600 to-teal-500 text-white rounded-xl font-black text-sm uppercase tracking-widest hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-3 shadow-lg transition-all active:scale-[0.98]"
                            >
                                {isGenerating ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        Generating Category Intelligence Framework...
                                    </>
                                ) : (
                                    <>
                                        <Sparkles className="w-5 h-5" />
                                        Generate Research Framework
                                    </>
                                )}
                            </button>
                            
                            {/* Progress + Telemetry Panel */}
                            {(genTelemetry.length > 0 || genProgress) && (
                                <div className="mt-4 bg-slate-900 rounded-xl overflow-hidden">
                                    {/* Progress Header with ETA */}
                                    {genProgress && isGenerating && (
                                        <div className="px-4 pt-4 pb-3">
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-2">
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                                                    <span className="text-xs font-bold text-white">Step {genProgress.step} of {genProgress.totalSteps}</span>
                                                </div>
                                                <div className="flex items-center gap-3 text-[10px]">
                                                    <span className="text-slate-400">{genProgress.elapsedSec}s elapsed</span>
                                                    <span className="text-indigo-400 font-bold">~{genProgress.estimatedRemainingSec}s remaining</span>
                                                    <span className="text-emerald-400 font-bold">{genProgress.keywords} keywords</span>
                                                </div>
                                            </div>
                                            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                                <div className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-full transition-all duration-700" style={{ width: `${(genProgress.step / genProgress.totalSteps) * 100}%` }} />
                                            </div>
                                        </div>
                                    )}
                                    {/* Completed state */}
                                    {genProgress && !isGenerating && (
                                        <div className="px-4 pt-4 pb-2 flex items-center gap-2">
                                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                            <span className="text-xs font-bold text-emerald-400">Complete in {genProgress.elapsedSec}s — {genProgress.keywords} keywords generated</span>
                                        </div>
                                    )}
                                    {/* Log Lines */}
                                    <div className="px-4 pb-3 font-mono text-[10px] max-h-28 overflow-y-auto">
                                        {genTelemetry.map((line, i) => (
                                            <div key={i} className={`py-0.5 ${line.includes('FAILED') ? 'text-red-400' : line.includes('Complete') ? 'text-emerald-400' : 'text-slate-500'}`}>
                                                {line}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Generation Error */}
                    {generationError && (
                        <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
                            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                            <div>
                                <p className="font-bold text-red-700 text-sm">Generation Failed</p>
                                <p className="text-red-600 text-sm mt-1">{generationError}</p>
                                <button onClick={handleGenerate} className="mt-2 text-xs font-bold text-red-700 underline">Retry</button>
                            </div>
                        </div>
                    )}

                    {/* Generated Category Preview */}
                    {generatedCategory && (
                        <div className="bg-white border-2 border-emerald-200 rounded-2xl p-6 shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                                    <Check className="w-5 h-5 text-emerald-600" />
                                </div>
                                <div>
                                    <h3 className="font-black text-lg text-[#0F172A]">{generatedCategory.category}</h3>
                                    <p className="text-xs text-emerald-600 font-bold">AI-Generated Research Framework</p>
                                </div>
                            </div>
                            
                            <p className="text-sm text-slate-600 mb-5 leading-relaxed">{generatedCategory.consumerDescription}</p>
                            
                            {/* Research Pillars */}
                            <div className="mb-5">
                                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Research Pillars</h4>
                                <div className="flex flex-wrap gap-2">
                                    {generatedCategory.anchors.map((a, i) => (
                                        <span key={i} className="px-3 py-1.5 bg-blue-50 text-blue-700 text-xs font-bold rounded-lg border border-blue-100">{a}</span>
                                    ))}
                                </div>
                            </div>

                            {/* Sub-categories */}
                            <div className="mb-5">
                                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Sub-Categories</h4>
                                <div className="space-y-2">
                                    {generatedCategory.subCategories.map((sc, i) => (
                                        <div key={i} className="p-3 bg-slate-50 rounded-lg">
                                            <p className="font-bold text-sm text-slate-700 mb-1">{sc.name}</p>
                                            <div className="flex flex-wrap gap-1.5">
                                                {sc.anchors.map((a, j) => (
                                                    <span key={j} className="px-2 py-0.5 bg-white text-slate-500 text-[10px] font-bold rounded border border-slate-200">{a}</span>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Key Brands */}
                            <div className="mb-5">
                                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Key Brands to Track</h4>
                                <div className="flex flex-wrap gap-2">
                                    {generatedCategory.keyBrands.map((b, i) => (
                                        <span key={i} className="px-2.5 py-1 bg-amber-50 text-amber-700 text-xs font-bold rounded-lg border border-amber-100">{b}</span>
                                    ))}
                                </div>
                            </div>

                            {/* Seed Keywords Preview */}
                            <div>
                                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                                    Seed Keywords ({generatedCategory.defaultKeywords.length})
                                </h4>
                                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                                    {generatedCategory.defaultKeywords.slice(0, 20).map((k, i) => (
                                        <span key={i} className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] rounded">{k}</span>
                                    ))}
                                    {generatedCategory.defaultKeywords.length > 20 && (
                                        <span className="px-2 py-0.5 bg-slate-200 text-slate-600 text-[10px] font-bold rounded">
                                            +{generatedCategory.defaultKeywords.length - 20} more
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Regenerate option */}
                            <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
                                <button 
                                    onClick={() => { setGeneratedCategory(null); }}
                                    className="text-xs text-slate-400 hover:text-slate-600 font-bold"
                                >
                                    Edit category input
                                </button>
                                <button
                                    onClick={handleGenerate}
                                    disabled={isGenerating}
                                    className="text-xs text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1"
                                >
                                    <Sparkles className="w-3 h-3" /> Regenerate
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ============ STEP 2: GEOGRAPHY ============ */}
            {step === 2 && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    
                    {/* Project Summary from Step 1 */}
                    {generatedCategory && (
                        <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-3">
                            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white flex-shrink-0">
                                <BarChart3 className="w-5 h-5" />
                            </div>
                            <div>
                                <p className="font-black text-sm text-blue-900">{generatedCategory.category}</p>
                                <p className="text-xs text-blue-600">{generatedCategory.anchors.length} research pillars · {generatedCategory.defaultKeywords.length} seed keywords · {generatedCategory.keyBrands.length} brands</p>
                            </div>
                        </div>
                    )}

                    {/* Country Selection */}
                    <div>
                        <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-3">
                            <MapPin className="w-3 h-3 inline mr-1" />
                            Country / Market
                        </label>
                        <div className="relative">
                            <button
                                onClick={() => setShowCountryDropdown(!showCountryDropdown)}
                                className="w-full flex items-center justify-between p-4 border-2 border-slate-200 rounded-xl bg-white hover:border-slate-300 transition-colors text-left"
                            >
                                <div className="flex items-center gap-3">
                                    <span className="text-2xl">{selectedCountry.flag}</span>
                                    <div>
                                        <p className="font-bold text-[#0F172A]">{selectedCountry.name}</p>
                                        <p className="text-xs text-slate-400">Location code: {selectedCountry.locationCode} · {selectedCountry.code}</p>
                                    </div>
                                </div>
                                <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${showCountryDropdown ? 'rotate-180' : ''}`} />
                            </button>

                            {showCountryDropdown && (
                                <div className="absolute top-full left-0 right-0 mt-2 bg-white border-2 border-slate-200 rounded-xl shadow-xl z-50 max-h-80 overflow-y-auto">
                                    <div className="p-3 border-b border-slate-100 sticky top-0 bg-white">
                                        <div className="relative">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                            <input
                                                type="text"
                                                value={countrySearch}
                                                onChange={e => setCountrySearch(e.target.value)}
                                                placeholder="Search countries..."
                                                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none"
                                                autoFocus
                                            />
                                        </div>
                                    </div>
                                    {filteredCountries.map(c => (
                                        <button
                                            key={c.code}
                                            onClick={() => handleCountrySelect(c)}
                                            className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors ${
                                                selectedCountry.code === c.code ? 'bg-blue-50' : ''
                                            }`}
                                        >
                                            <span className="text-xl">{c.flag}</span>
                                            <div className="flex-1">
                                                <p className="font-bold text-sm text-[#0F172A]">{c.name}</p>
                                                <p className="text-[10px] text-slate-400">{c.languages.map(l => l.name).join(', ')}</p>
                                            </div>
                                            {selectedCountry.code === c.code && <Check className="w-4 h-4 text-blue-600" />}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Language Selection (Multi) */}
                    <div>
                        <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-3">
                            <Languages className="w-3 h-3 inline mr-1" />
                            Research Languages <span className="text-slate-400 font-normal">(select all that apply)</span>
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {selectedCountry.languages.map(lang => {
                                const isSelected = selectedLanguages.has(lang.code);
                                return (
                                    <button
                                        key={lang.code}
                                        onClick={() => {
                                            setSelectedLanguages(prev => {
                                                const next = new Set(prev);
                                                if (isSelected && next.size > 1) {
                                                    next.delete(lang.code);
                                                } else {
                                                    next.add(lang.code);
                                                }
                                                return next;
                                            });
                                        }}
                                        className={`px-4 py-3 rounded-xl border-2 font-bold text-sm transition-all ${
                                            isSelected
                                                ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-md'
                                                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                                        }`}
                                    >
                                        {isSelected && <span className="mr-1.5">✓</span>}
                                        {lang.name}
                                        {lang.code === selectedCountry.defaultLanguage && (
                                            <span className="ml-2 text-[10px] text-slate-400 font-normal">Primary</span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                        <p className="mt-2 text-xs text-slate-400">Keywords will be generated across all selected languages. Primary language is used for DFS volume lookup.</p>
                    </div>

                    {/* Project Summary */}
                    <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl">
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Project Summary</h4>
                        <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-500">Category</span>
                                <span className="font-bold text-[#0F172A]">{generatedCategory?.category || '—'}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-500">Market</span>
                                <span className="font-bold text-[#0F172A]">{selectedCountry.flag} {selectedCountry.name}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-500">Languages</span>
                                <span className="font-bold text-[#0F172A]">{Array.from(selectedLanguages).map(code => selectedCountry.languages.find(l => l.code === code)?.name || code).join(', ')}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-500">Research Pillars</span>
                                <span className="font-bold text-[#0F172A]">{generatedCategory?.anchors.length || 0}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-500">Seed Keywords</span>
                                <span className="font-bold text-[#0F172A]">{generatedCategory?.defaultKeywords.length || 0}</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ============ BOTTOM BAR ============ */}
            <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/90 backdrop-blur-md border-t border-slate-200 flex justify-end items-center z-40 shadow-[0_-4px_12px_rgba(0,0,0,0.05)]">
                <div className="flex items-center gap-4">
                    {generatedCategory && (
                        <button
                            onClick={handleProceed}
                            className="bg-gradient-to-r from-blue-600 to-teal-500 text-white px-8 py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:opacity-90 flex items-center gap-2 shadow-lg transition-all active:scale-95"
                        >
                            <Sparkles className="w-4 h-4" /> Launch Project <ArrowRight className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
