
import React, { useState, useMemo } from 'react';
import { Search, Filter, Hash, X } from 'lucide-react';
import { PreSweepData } from '../types';

interface KeywordExplorerProps {
    keywords: PreSweepData['selected_keywords'];
    onClose: () => void;
}

export const KeywordExplorer: React.FC<KeywordExplorerProps> = ({ keywords, onClose }) => {
    const [search, setSearch] = useState('');
    const [filterIntent, setFilterIntent] = useState<string>('ALL');
    const [filterSubCat, setFilterSubCat] = useState<string>('ALL');
    const [page, setPage] = useState(1);
    const ITEMS_PER_PAGE = 50;

    const intents = useMemo(() => Array.from(new Set(keywords.map(k => k.intentBucket))).sort(), [keywords]);
    const subCats = useMemo(() => Array.from(new Set(keywords.map(k => k.subCategory))).sort(), [keywords]);

    const filtered = useMemo(() => {
        return keywords.filter(k => {
            if (search && !k.keyword.toLowerCase().includes(search.toLowerCase())) return false;
            if (filterIntent !== 'ALL' && k.intentBucket !== filterIntent) return false;
            if (filterSubCat !== 'ALL' && k.subCategory !== filterSubCat) return false;
            return true;
        });
    }, [keywords, search, filterIntent, filterSubCat]);

    const paginated = filtered.slice(0, page * ITEMS_PER_PAGE);

    return (
        <div className="fixed inset-0 z-[100] flex justify-end">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
                <div className="p-6 border-b border-slate-100 flex justify-between items-start bg-slate-50">
                    <div>
                        <h3 className="text-xl font-black text-slate-900 flex items-center gap-2">
                            <Hash className="w-5 h-5 text-indigo-600"/> Keyword Explorer
                        </h3>
                        <p className="text-xs text-slate-500 mt-1 font-medium">{filtered.length} matches found</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full text-slate-500 transition-colors"><X className="w-5 h-5" /></button>
                </div>

                <div className="p-4 border-b border-slate-100 space-y-4 bg-white">
                    <div className="relative">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3"/>
                        <input 
                            type="text" 
                            placeholder="Search keywords..." 
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                    </div>
                    <div className="flex gap-3">
                        <div className="relative flex-1">
                            <Filter className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3"/>
                            <select 
                                value={filterIntent}
                                onChange={(e) => setFilterIntent(e.target.value)}
                                className="w-full pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 appearance-none focus:border-indigo-500 outline-none"
                            >
                                <option value="ALL">All Intents</option>
                                {intents.map(i => <option key={i} value={i}>{i}</option>)}
                            </select>
                        </div>
                        <div className="relative flex-1">
                            <Filter className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3"/>
                            <select 
                                value={filterSubCat}
                                onChange={(e) => setFilterSubCat(e.target.value)}
                                className="w-full pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 appearance-none focus:border-indigo-500 outline-none"
                            >
                                <option value="ALL">All Sub-Categories</option>
                                {subCats.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                    <div className="space-y-2">
                        {paginated.map((k, i) => (
                            <div key={i} className="p-4 rounded-xl border border-slate-100 hover:border-indigo-200 hover:shadow-sm transition-all bg-white group">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="font-bold text-slate-800 text-sm break-words">{k.keyword}</span>
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                                        k.intentBucket === 'Decision' ? 'bg-emerald-100 text-emerald-700' :
                                        k.intentBucket === 'Discovery' ? 'bg-blue-100 text-blue-700' :
                                        'bg-slate-100 text-slate-600'
                                    }`}>{k.intentBucket}</span>
                                </div>
                                <div className="grid grid-cols-2 gap-4 text-[10px] text-slate-500">
                                    <div className="flex flex-col">
                                        <span className="uppercase tracking-wider font-bold text-slate-400">Anchor</span>
                                        <span className="font-medium text-slate-700 truncate">{k.anchor}</span>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="uppercase tracking-wider font-bold text-slate-400">Rationale</span>
                                        <span className="font-medium text-slate-600 line-clamp-2">{k.rationale}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                    {paginated.length < filtered.length && (
                        <button 
                            onClick={() => setPage(p => p + 1)}
                            className="w-full py-4 mt-4 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-colors"
                        >
                            Load More ({filtered.length - paginated.length} remaining)
                        </button>
                    )}
                    {filtered.length === 0 && (
                        <div className="text-center py-20 text-slate-400">
                            <Search className="w-12 h-12 mx-auto mb-2 opacity-20"/>
                            <p>No keywords found matching filters.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
