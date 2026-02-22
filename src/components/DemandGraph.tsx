
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { CategoryBaseline, FetchableData, SweepResult } from '../types';
import { DemandMetricsAdapter } from '../services/demandMetricsAdapter';
import { safeNum, safeStr } from '../utils/safety';
import { TrendingUp, TrendingDown, Minus, CheckCircle2 } from 'lucide-react';

interface DemandGraphProps {
    categories: CategoryBaseline[];
    results: Record<string, FetchableData<SweepResult>>;
    activeCategoryId: string | null;
    onCategorySelect: (id: string) => void;
    sortKey: 'demand' | 'readiness' | 'spread' | 'trend';
}

const COLORS = {
    grid: '#f1f5f9',
    growing: '#10b981', 
    stable: '#94a3b8',  
    declining: '#ef4444',
    highlight: '#4f46e5'
};

export const DemandGraph: React.FC<DemandGraphProps> = ({ 
    categories, results, activeCategoryId, onCategorySelect, sortKey 
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);

    useEffect(() => {
        if (!containerRef.current) return;
        const obs = new ResizeObserver(entries => {
            if (entries[0]) {
                setWidth(entries[0].contentRect.width);
            }
        });
        obs.observe(containerRef.current);
        return () => obs.disconnect();
    }, []);

    const data = useMemo(() => {
        return categories
            .map(cat => {
                const r = results[cat.id]?.data;
                return {
                    id: cat.id,
                    label: cat.category,
                    demand: r ? safeNum(DemandMetricsAdapter.getDemandIndexMn(r)) : 0,
                    readiness: r ? safeNum(r.metric_scores?.readiness) : 0,
                    spread: r ? safeNum(r.metric_scores?.spread) : 0,
                    trend: r ? safeNum(r.trend_5y?.value_percent, 0) : 0,
                    trendLabel: r?.trend_5y?.trend_label || 'Stable',
                    isReady: results[cat.id]?.status === 'Success'
                };
            })
            .sort((a, b) => {
                if (sortKey === 'demand') return b.demand - a.demand;
                if (sortKey === 'readiness') return b.readiness - a.readiness;
                if (sortKey === 'spread') return b.spread - a.spread;
                if (sortKey === 'trend') return b.trend - a.trend;
                return 0;
            });
    }, [categories, results, sortKey]);

    const maxDemand = useMemo(() => Math.max(...data.map(d => d.demand), 1), [data]);
    
    // Layout Constants
    const rowHeight = 48;
    const labelWidth = 180;
    const metricsWidth = 240;
    const plotPadding = 40;
    const plotWidth = Math.max(0, width - labelWidth - metricsWidth - (plotPadding * 2));

    const getTrendIcon = (val: number) => {
        if (val >= 5) return <TrendingUp className="w-3 h-3 text-emerald-500" />;
        if (val <= -5) return <TrendingDown className="w-3 h-3 text-red-500" />;
        return <Minus className="w-3 h-3 text-slate-300" />;
    };

    const getTrendColor = (val: number) => {
        if (val >= 5) return COLORS.growing;
        if (val <= -5) return COLORS.declining;
        return COLORS.stable;
    };

    return (
        <div ref={containerRef} className="w-full bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            {/* Legend / Header */}
            <div className="px-6 py-3 bg-slate-50 border-b border-slate-100 flex items-center text-[10px] font-black uppercase tracking-widest text-slate-400">
                <div style={{ width: labelWidth }}>Category & Readiness</div>
                <div className="flex-1 text-center">Demand Plot (X = Mn Searches)</div>
                <div style={{ width: metricsWidth }} className="text-right">Key Metrics</div>
            </div>

            <div className="divide-y divide-slate-50">
                {data.map((p, idx) => {
                    const isActive = p.id === activeCategoryId;
                    const xPos = (p.demand / maxDemand) * plotWidth;
                    const trendColor = getTrendColor(p.trend);
                    
                    // Spread encoded as radius (min 4, max 10)
                    const radius = 4 + (p.spread / 10) * 6;

                    return (
                        <div 
                            key={p.id}
                            onClick={() => onCategorySelect(p.id)}
                            className={`flex items-center px-6 transition-all cursor-pointer group ${isActive ? 'bg-indigo-50/50' : 'hover:bg-slate-50/80'}`}
                            style={{ height: rowHeight }}
                        >
                            {/* Left: Label & Readiness */}
                            <div style={{ width: labelWidth }} className="flex flex-col justify-center min-w-0 pr-4">
                                <div className="flex items-center gap-2">
                                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? 'bg-indigo-600' : 'bg-slate-200'}`} />
                                    <span className={`text-xs font-bold truncate ${isActive ? 'text-indigo-900' : 'text-slate-700'}`}>
                                        {p.label}
                                    </span>
                                </div>
                                <div className="mt-1 flex items-center gap-2">
                                    <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden max-w-[80px]">
                                        <div 
                                            className="h-full bg-indigo-400" 
                                            style={{ width: `${(p.readiness / 10) * 100}%` }}
                                        />
                                    </div>
                                    <span className="text-[9px] font-bold text-slate-400 whitespace-nowrap">{p.readiness.toFixed(1)}/10</span>
                                </div>
                            </div>

                            {/* Middle: Dot Plot */}
                            <div className="flex-1 h-full relative border-x border-slate-100/50">
                                {/* Grid Line */}
                                <div className="absolute inset-y-0 left-0 w-px bg-slate-100" />
                                
                                {/* The Dot */}
                                <div 
                                    className="absolute top-1/2 -translate-y-1/2 transition-all duration-500 ease-out flex flex-col items-center"
                                    style={{ left: plotPadding + xPos }}
                                >
                                    <div 
                                        className="relative transition-transform group-hover:scale-125"
                                        style={{ 
                                            width: radius * 2, 
                                            height: radius * 2, 
                                            backgroundColor: trendColor,
                                            borderRadius: '50%',
                                            border: `2px solid ${isActive ? COLORS.highlight : 'white'}`,
                                            boxShadow: isActive ? '0 0 12px rgba(79, 70, 229, 0.4)' : '0 1px 3px rgba(0,0,0,0.1)'
                                        }}
                                    />
                                    {/* Small floating volume label on hover/active */}
                                    {(isActive || p.demand > maxDemand * 0.8) && (
                                        <span className="absolute -bottom-4 text-[8px] font-black text-slate-400 whitespace-nowrap">
                                            {p.demand.toFixed(2)}M
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Right: Metrics Chips */}
                            <div style={{ width: metricsWidth }} className="flex items-center justify-end gap-2 pl-4">
                                <div className="flex flex-col items-end">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] font-mono font-bold text-slate-900">{DemandMetricsAdapter.formatMn(p.demand)}</span>
                                        <div className="h-3 w-px bg-slate-200" />
                                        <span className="text-[10px] font-mono font-bold text-slate-500">S:{p.spread.toFixed(1)}</span>
                                    </div>
                                    <div className="flex items-center gap-1 mt-0.5">
                                        {getTrendIcon(p.trend)}
                                        <span className={`text-[9px] font-black ${p.trend >= 5 ? 'text-emerald-600' : p.trend <= -5 ? 'text-red-600' : 'text-slate-400'}`}>
                                            {p.trend > 0 ? '+' : ''}{p.trend.toFixed(1)}%
                                        </span>
                                    </div>
                                </div>
                                {p.isReady && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 ml-2" />}
                            </div>
                        </div>
                    );
                })}
            </div>
            
            {/* Axis Footer */}
            <div className="px-6 py-2 bg-slate-50/50 border-t border-slate-100 flex justify-between text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-500"/> Growing</div>
                    <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-slate-300"/> Stable</div>
                    <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-red-500"/> Declining</div>
                </div>
                <div className="flex items-center gap-4">
                    <span>Dot Position = Demand Index</span>
                    <span>Dot Size = Market Spread</span>
                </div>
            </div>
        </div>
    );
};
