
import React, { useRef, useEffect, useState, useMemo } from 'react';
import { CategoryBaseline, FetchableData, SweepResult } from '../types';
import { DemandMetricsAdapter } from '../services/demandMetricsAdapter';
import { safeNum } from '../utils/safety';
import { BarChart3, Filter, Search, Check, ZoomIn, X } from 'lucide-react';

interface DemandIndexVsReadinessChartProps {
    categories: CategoryBaseline[];
    results: Record<string, FetchableData<SweepResult>>;
    activeCategoryId: string | null;
    onCategorySelect: (id: string) => void;
}

interface PlotPoint {
    id: string;
    label: string;
    valReadiness: number; // Y Axis (0-10)
    valDemand: number;    // X Axis (Mn) - Log Scale
    color: string;
    isActive: boolean;
    isFocused: boolean;
}

interface LayoutPoint extends PlotPoint {
    cx: number;
    cy: number;
    r: number;
    opacity: number;
    labelY: number; // Adjusted for collision
}

export const DemandIndexVsReadinessChart: React.FC<DemandIndexVsReadinessChartProps> = ({
    categories, results, activeCategoryId, onCategorySelect
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [dims, setDims] = useState({ width: 0, height: 450 });
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    
    // Focus Mode State
    const [focusIds, setFocusIds] = useState<Set<string>>(new Set());
    const [isFocusMenuOpen, setIsFocusMenuOpen] = useState(false);
    const [filterText, setFilterText] = useState("");
    const [zoomToFocus, setZoomToFocus] = useState(false);

    useEffect(() => {
        if (!containerRef.current) return;
        const obs = new ResizeObserver(entries => {
            if (entries[0]) {
                setDims({ width: entries[0].contentRect.width, height: 450 });
            }
        });
        obs.observe(containerRef.current);
        return () => obs.disconnect();
    }, []);

    // 1. Prepare Raw Data
    const rawPoints: PlotPoint[] = useMemo(() => {
        return categories.map(cat => {
            const r = results[cat.id]?.data;
            if (!r) return null;

            // X = Demand (Log), Y = Readiness
            const demand = safeNum(DemandMetricsAdapter.getDemandIndexMn(r));
            const readiness = safeNum(r.metric_scores?.readiness);

            if (readiness <= 0) return null; // Demand can be 0, handled by log(x+1)

            let color = '#94a3b8'; // Stable
            const trend = r.trend_5y?.trend_label || 'Stable';
            if (trend.toLowerCase().includes('growing') || trend.toLowerCase().includes('rising')) color = '#10b981';
            if (trend.toLowerCase().includes('declining')) color = '#ef4444';

            return {
                id: cat.id,
                label: cat.category,
                valReadiness: readiness,
                valDemand: demand,
                color,
                isActive: cat.id === activeCategoryId,
                isFocused: focusIds.has(cat.id)
            };
        }).filter(Boolean) as PlotPoint[];
    }, [categories, results, activeCategoryId, focusIds]);

    // 2. Compute Layout (Log Scale X)
    const layout = useMemo(() => {
        if (dims.width === 0 || rawPoints.length === 0) return null;

        const padding = { top: 40, right: 40, bottom: 50, left: 60 };
        const chartW = Math.max(0, dims.width - padding.left - padding.right);
        const chartH = dims.height - padding.top - padding.bottom;

        // Domain Calculation
        let minD = 0;
        let maxD = Math.max(...rawPoints.map(p => p.valDemand), 1) * 1.2;
        let minR = 0;
        let maxR = 10;

        // Zoom Logic
        if (zoomToFocus && focusIds.size > 0) {
            const focused = rawPoints.filter(p => p.isFocused);
            if (focused.length > 0) {
                const fDemands = focused.map(p => p.valDemand);
                const fReadiness = focused.map(p => p.valReadiness);
                
                // Add 10% padding
                const rangeD = Math.max(...fDemands) - Math.min(...fDemands) || 1;
                minD = Math.max(0, Math.min(...fDemands) - rangeD * 0.1);
                maxD = Math.max(...fDemands) + rangeD * 0.1;

                const rangeR = Math.max(...fReadiness) - Math.min(...fReadiness) || 1;
                minR = Math.max(0, Math.min(...fReadiness) - rangeR * 0.1);
                maxR = Math.min(10, Math.max(...fReadiness) + rangeR * 0.1);
            }
        }

        // Transform Functions
        // X: Log Scale -> log10(val + 1)
        const logMin = Math.log10(minD + 1);
        const logMax = Math.log10(maxD + 1);
        const xScale = (d: number) => {
            const logVal = Math.log10(d + 1);
            return padding.left + ((logVal - logMin) / (logMax - logMin)) * chartW;
        };

        // Y: Linear Scale
        const yScale = (r: number) => {
            return padding.top + chartH - ((r - minR) / (maxR - minR)) * chartH;
        };

        // Generate Points
        const points: LayoutPoint[] = rawPoints.map(p => {
            const isFaded = focusIds.size > 0 && !p.isFocused;
            
            // Bounds check for zoom
            let cx = xScale(p.valDemand);
            let cy = yScale(p.valReadiness);
            
            // Clamp for safety if zoomed in tight
            // (SVG will clip via overflow-hidden on div, but lines might look weird if not handled. 
            // Simple clamping suffices for dot placement).
            
            return {
                ...p,
                cx,
                cy,
                r: p.isActive || p.isFocused ? 6 : 4,
                opacity: isFaded ? 0.2 : 1,
                labelY: cy - 12
            };
        });

        // Smart Label Collision (Deterministic Vertical Shift for Focused items)
        if (focusIds.size > 0) {
            // Sort by Y visually (top to bottom)
            const focused = points.filter(p => p.isFocused).sort((a, b) => a.cy - b.cy);
            for (let i = 1; i < focused.length; i++) {
                const prev = focused[i - 1];
                const curr = focused[i];
                // Check vertical overlap (text height approx 14px)
                if (curr.labelY - prev.labelY < 14) {
                    // Overlap detected, push down if possible, or push prev up?
                    // Let's push current down
                    curr.labelY = prev.labelY + 14;
                }
            }
        }

        // Ticks Generation (Log Aware)
        const xTicks = [0, 1, 10, 100, 1000].filter(t => t >= minD && t <= maxD);
        if (maxD > 1 && xTicks.length < 2) xTicks.push(maxD); // Ensure at least 2 ticks
        
        return { points, xScale, yScale, xTicks, yDomain: [minR, maxR] };
    }, [rawPoints, dims, zoomToFocus, focusIds]);

    // Handlers
    const toggleFocus = (id: string) => {
        setFocusIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const clearFocus = () => {
        setFocusIds(new Set());
        setZoomToFocus(false);
    };

    const filteredCats = categories.filter(c => 
        c.category.toLowerCase().includes(filterText.toLowerCase())
    );

    // Proof Log
    useEffect(() => {
        console.log(`[DEMAND_SCATTER] points=${rawPoints.length} selected=${focusIds.size} xScale=LOG`);
    }, [rawPoints.length, focusIds.size]);

    if (!layout) {
        return (
            <div ref={containerRef} className="h-[450px] bg-white rounded-xl border border-slate-200 flex items-center justify-center text-slate-400">
                <BarChart3 className="w-8 h-8 mb-2 opacity-50" />
                <p className="text-xs font-medium">Loading Chart...</p>
            </div>
        );
    }

    return (
        <div ref={containerRef} className="bg-white rounded-xl border border-slate-200 shadow-sm mb-8 relative font-sans group">
            {/* Header Controls */}
            <div className="absolute top-4 left-6 right-6 z-20 flex justify-between items-start pointer-events-none">
                <div>
                    <h3 className="font-bold text-slate-900 text-sm">Engagement Readiness vs Demand Volume</h3>
                    <p className="text-xs text-slate-500">Log-Scale Demand (X) vs Maturity (Y)</p>
                </div>

                <div className="flex gap-2 pointer-events-auto">
                    {/* Focus Menu */}
                    <div className="relative">
                        <button 
                            onClick={() => setIsFocusMenuOpen(!isFocusMenuOpen)}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm transition-all ${
                                focusIds.size > 0 
                                ? 'bg-indigo-600 text-white border-indigo-700' 
                                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                            }`}
                        >
                            <Filter className="w-3.5 h-3.5" />
                            {focusIds.size > 0 ? `Focus (${focusIds.size})` : 'Filter'}
                        </button>

                        {isFocusMenuOpen && (
                            <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-200 p-2 z-50 animate-in fade-in zoom-in-95 duration-200">
                                <div className="flex items-center gap-2 px-2 pb-2 border-b border-slate-100">
                                    <Search className="w-3.5 h-3.5 text-slate-400" />
                                    <input 
                                        type="text" 
                                        placeholder="Search categories..." 
                                        className="w-full text-xs outline-none font-medium"
                                        value={filterText}
                                        onChange={(e) => setFilterText(e.target.value)}
                                        autoFocus
                                    />
                                </div>
                                <div className="max-h-48 overflow-y-auto py-1 custom-scrollbar">
                                    {filteredCats.map(cat => (
                                        <button 
                                            key={cat.id}
                                            onClick={() => toggleFocus(cat.id)}
                                            className="w-full flex items-center justify-between px-2 py-1.5 hover:bg-slate-50 rounded text-left"
                                        >
                                            <span className="text-xs text-slate-700 truncate">{cat.category}</span>
                                            {focusIds.has(cat.id) && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                                        </button>
                                    ))}
                                </div>
                                <div className="pt-2 border-t border-slate-100 flex justify-between px-1">
                                    <button 
                                        onClick={clearFocus}
                                        disabled={focusIds.size === 0}
                                        className="text-[10px] font-bold text-slate-400 hover:text-slate-600 disabled:opacity-50"
                                    >
                                        Clear
                                    </button>
                                    <button 
                                        onClick={() => setIsFocusMenuOpen(false)}
                                        className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800"
                                    >
                                        Done
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Zoom Toggle */}
                    {focusIds.size > 0 && (
                        <button 
                            onClick={() => setZoomToFocus(!zoomToFocus)}
                            className={`p-1.5 rounded-lg border transition-all ${
                                zoomToFocus 
                                ? 'bg-indigo-50 border-indigo-200 text-indigo-700' 
                                : 'bg-white border-slate-200 text-slate-400 hover:text-slate-600'
                            }`}
                            title="Zoom to selection"
                        >
                            <ZoomIn className="w-4 h-4" />
                        </button>
                    )}

                    {focusIds.size > 0 && (
                        <button onClick={clearFocus} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
                            <X className="w-4 h-4"/>
                        </button>
                    )}
                </div>
            </div>

            <svg width="100%" height={dims.height} className="block overflow-visible" style={{ minWidth: '100%' }}>
                <defs>
                    <filter id="shadow-sm" x="-50%" y="-50%" width="200%" height="200%">
                        <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#000000" floodOpacity="0.15"/>
                    </filter>
                </defs>

                {/* Y Axis Grid */}
                {[0, 2, 4, 6, 8, 10].map(tick => {
                    const y = layout.yScale(tick);
                    if (y < 0 || y > dims.height) return null;
                    return (
                        <g key={`y-${tick}`}>
                            <line x1={60} y1={y} x2={dims.width - 40} y2={y} stroke="#f1f5f9" strokeWidth="1" />
                            <text x={50} y={y} dy="0.32em" textAnchor="end" className="text-[10px] fill-slate-400 font-medium">{tick}</text>
                        </g>
                    );
                })}
                
                {/* X Axis Grid (Log Ticks) */}
                {layout.xTicks.map(val => {
                    const x = layout.xScale(val);
                    if (x < 0 || x > dims.width) return null;
                    return (
                        <g key={`x-${val}`}>
                            <line x1={x} y1={40} x2={x} y2={dims.height - 50} stroke="#f1f5f9" strokeWidth="1" strokeDasharray="4 4" />
                            <text x={x} y={dims.height - 35} textAnchor="middle" className="text-[10px] fill-slate-400 font-medium">{val}M</text>
                        </g>
                    );
                })}

                {/* Labels */}
                <text x={20} y={dims.height/2} transform={`rotate(-90, 20, ${dims.height/2})`} textAnchor="middle" className="text-xs font-bold fill-slate-400 uppercase tracking-widest">
                    Readiness Score
                </text>
                <text x={dims.width/2} y={dims.height - 15} textAnchor="middle" className="text-xs font-bold fill-slate-400 uppercase tracking-widest">
                    Demand Volume (Mn) {zoomToFocus ? '(Zoomed)' : '(Log Scale)'}
                </text>

                {/* Points */}
                {layout.points.map(p => {
                    const isHovered = p.id === hoveredId;
                    const showLabel = p.isActive || p.isFocused || isHovered;
                    
                    return (
                        <g 
                            key={p.id} 
                            onClick={() => onCategorySelect(p.id)}
                            onMouseEnter={() => setHoveredId(p.id)}
                            onMouseLeave={() => setHoveredId(null)}
                            style={{ opacity: p.opacity, cursor: 'pointer', transition: 'opacity 0.3s' }}
                        >
                            {/* Point */}
                            <circle 
                                cx={p.cx} cy={p.cy} r={p.r} 
                                fill={p.color} 
                                stroke={p.isFocused ? '#312e81' : 'white'} 
                                strokeWidth={p.isFocused ? 2 : 2} 
                                className="transition-all duration-300"
                                filter={showLabel ? "url(#shadow-sm)" : ""}
                            />

                            {/* Label */}
                            {showLabel && (
                                <g className="pointer-events-none animate-in fade-in zoom-in-95 duration-200">
                                    {/* Line connecting label if shifted */}
                                    {p.labelY !== p.cy - 12 && (
                                        <line x1={p.cx} y1={p.cy - p.r} x2={p.cx} y2={p.labelY + 8} stroke={p.color} strokeWidth="1" opacity="0.5" />
                                    )}
                                    
                                    <text 
                                        x={p.cx} 
                                        y={p.labelY} 
                                        textAnchor="middle" 
                                        className={`text-[10px] font-bold ${p.isFocused ? 'fill-indigo-900' : 'fill-slate-700'}`}
                                        style={{ textShadow: '0px 0px 8px rgba(255,255,255,1)' }}
                                    >
                                        {p.label}
                                    </text>
                                    
                                    {/* Metrics Subtitle (Only on Hover) */}
                                    {isHovered && !p.isFocused && (
                                        <text x={p.cx} y={p.labelY + 12} textAnchor="middle" className="text-[9px] font-mono fill-slate-500">
                                            D:{p.valDemand.toFixed(2)}M / R:{p.valReadiness.toFixed(1)}
                                        </text>
                                    )}
                                </g>
                            )}

                            {/* Hit Area */}
                            <circle cx={p.cx} cy={p.cy} r={15} fill="transparent" /> 
                        </g>
                    );
                })}
            </svg>
        </div>
    );
};
