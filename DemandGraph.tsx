
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { CategoryBaseline, FetchableData, SweepResult } from './types';

// --- Types ---

interface DemandGraphProps {
    categories: CategoryBaseline[];
    results: Record<string, FetchableData<SweepResult>>;
    activeCategoryId: string | null;
    onCategorySelect: (id: string) => void;
}

interface DataPoint {
    id: string;
    label: string;
    demandIndex: number; // X-Axis
    readiness: number;   // Y-Axis
    spread: number;      // Size
    trend: number;       // Color
}

interface LabelPos {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

// --- Helpers ---

// Muted Professional Palette (McKinsey-style)
const COLORS = {
    grid: '#f1f5f9', // slate-100
    axisText: '#94a3b8', // slate-400
    labelText: '#334155', // slate-700
    bubbleStroke: '#ffffff',
    activeStroke: '#1e293b', // slate-800
    trendGradient: {
        low: '#ef4444',   // red-500
        mid: '#cbd5e1',   // slate-300
        high: '#10b981'   // emerald-500
    }
};

const getTrendColor = (trend: number): string => {
    // Gradient logic: -5 (Red) ... 0 (Gray) ... +10 (Green)
    // Simple clamped linear interpolation
    if (trend <= -2) return COLORS.trendGradient.low;
    if (trend >= 5) return COLORS.trendGradient.high;
    
    // Slight interpolation for the middle ground could be nice, 
    // but distinct buckets often read better for executives.
    // Let's stick to the prompt's "Red -> Neutral -> Green"
    if (trend < 0) return '#f87171'; // red-400
    if (trend > 2) return '#34d399'; // emerald-400
    return COLORS.trendGradient.mid;
};

// --- Hook: Resize Observer ---

function useContainerSize() {
    const ref = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    useEffect(() => {
        if (!ref.current) return;
        const observer = new ResizeObserver((entries) => {
            if (!entries || entries.length === 0) return;
            const { width, height } = entries[0].contentRect;
            setSize({ width, height });
        });
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, []);

    return { ref, size };
}

// --- Label Layout Solver (Simulated Annealing-ish) ---
function computeLabelLayout(
    nodes: { id: string, cx: number, cy: number, r: number, label: string }[],
    width: number,
    height: number,
    padding: { top: number, right: number, bottom: number, left: number }
) {
    const labels: LabelPos[] = nodes.map(n => ({
        id: n.id,
        x: n.cx,
        y: n.cy - n.r - 12, // Initial guess: top
        w: n.label.length * 6 + 10, // Approx text width
        h: 14
    }));

    const iterations = 50;
    const force = 2;

    for (let i = 0; i < iterations; i++) {
        for (let j = 0; j < labels.length; j++) {
            const l1 = labels[j];
            const n1 = nodes[j];

            // 1. Avoid Bubbles
            const dx = l1.x - n1.cx;
            const dy = l1.y - n1.cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const minDist = n1.r + 10;
            if (dist < minDist) {
                const angle = Math.atan2(dy, dx);
                l1.x = n1.cx + Math.cos(angle) * minDist;
                l1.y = n1.cy + Math.sin(angle) * minDist;
            }

            // 2. Avoid Other Labels
            for (let k = j + 1; k < labels.length; k++) {
                const l2 = labels[k];
                if (
                    l1.x < l2.x + l2.w &&
                    l1.x + l1.w > l2.x &&
                    l1.y < l2.y + l2.h &&
                    l1.y + l1.h > l2.y
                ) {
                    // Overlap detected - push apart
                    const overlapX = Math.min(l1.x + l1.w, l2.x + l2.w) - Math.max(l1.x, l2.x);
                    const overlapY = Math.min(l1.y + l1.h, l2.y + l2.h) - Math.max(l1.y, l2.y);

                    if (overlapX < overlapY) {
                        const move = overlapX / 2 + 1;
                        if (l1.x < l2.x) { l1.x -= move; l2.x += move; }
                        else { l1.x += move; l2.x -= move; }
                    } else {
                        const move = overlapY / 2 + 1;
                        if (l1.y < l2.y) { l1.y -= move; l2.y += move; }
                        else { l1.y += move; l2.y -= move; }
                    }
                }
            }

            // 3. Keep in Bounds
            l1.x = Math.max(padding.left, Math.min(width - padding.right - l1.w, l1.x));
            l1.y = Math.max(padding.top, Math.min(height - padding.bottom - l1.h, l1.y));
        }
    }
    return labels;
}

export const DemandGraph: React.FC<DemandGraphProps> = ({ 
    categories, results, activeCategoryId, onCategorySelect 
}) => {
    const { ref, size } = useContainerSize();
    const [hoveredId, setHoveredId] = useState<string | null>(null);

    // 1. Transform Data
    const data: DataPoint[] = useMemo(() => {
        return categories
            .filter(cat => results[cat.id]?.status === 'Success' && results[cat.id]?.data)
            .map(cat => {
                const r = results[cat.id].data!;
                return {
                    id: cat.id,
                    label: cat.category,
                    demandIndex: r.demand_index_mn,
                    readiness: r.metric_scores.readiness,
                    spread: r.metric_scores.spread,
                    trend: r.trend_5y.value_percent
                };
            })
            .sort((a, b) => b.spread - a.spread); // Draw large bubbles first (or last? SVG painters alg: last is top. We want small on top.)
            // Re-sort: Large first means large at bottom. Correct.
    }, [categories, results]);

    // 2. Compute Scales
    const padding = { top: 40, right: 60, bottom: 60, left: 60 };
    const chartWidth = Math.max(0, size.width - padding.left - padding.right);
    const chartHeight = Math.max(0, size.height - padding.top - padding.bottom);

    // X-Axis: Demand Index (0 to Max + Buffer)
    const maxDemand = Math.max(...data.map(d => d.demandIndex), 1);
    const xDomain = [0, maxDemand * 1.15];
    const xScale = (val: number) => padding.left + (val / xDomain[1]) * chartWidth;

    // Y-Axis: Readiness (0 to 10)
    const yDomain = [0, 10];
    const yScale = (val: number) => padding.top + chartHeight - ((val - yDomain[0]) / (yDomain[1] - yDomain[0])) * chartHeight;

    // Size: Spread (1 to 10) -> Radius
    const rScale = (val: number) => {
        // Area proportional to value
        // Min radius 5, Max radius 35
        const norm = (val) / 10; 
        return 8 + Math.sqrt(norm) * 25; 
    };

    // 3. Layout Labels
    const nodes = useMemo(() => data.map(d => ({
        id: d.id,
        cx: xScale(d.demandIndex),
        cy: yScale(d.readiness),
        r: rScale(d.spread),
        label: d.label
    })), [data, size, xScale, yScale]); // Recalc layout when size changes

    const labelLayout = useMemo(() => {
        if (size.width === 0) return [];
        return computeLabelLayout(nodes, size.width, size.height, padding);
    }, [nodes, size]);

    // 4. Interaction
    const handleHover = (id: string | null) => setHoveredId(id);

    // Tooltip
    const hoveredData = data.find(d => d.id === hoveredId);
    let tooltipPos = { left: 0, top: 0 };
    if (hoveredData && size.width > 0) {
        const cx = xScale(hoveredData.demandIndex);
        const cy = yScale(hoveredData.readiness);
        const r = rScale(hoveredData.spread);
        tooltipPos = {
            left: cx + r + 10 > size.width - 200 ? cx - r - 220 : cx + r + 10,
            top: cy - 40 < 0 ? cy + r + 10 : cy - 40
        };
    }

    if (data.length === 0) return <div ref={ref} className="h-[450px] bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-center text-slate-400 font-medium">No Data Available</div>;

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-8 overflow-hidden relative font-sans group">
            <div ref={ref} className="w-full h-[450px] relative">
                <svg width={size.width} height={size.height} className="block cursor-crosshair">
                    <defs>
                         <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
                            <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#000000" floodOpacity="0.1"/>
                        </filter>
                    </defs>

                    {/* Gridlines X */}
                    {[0, 2, 4, 6, 8, 10].map(tick => (
                        <g key={`y-${tick}`}>
                            <line 
                                x1={padding.left} y1={yScale(tick)} 
                                x2={size.width - padding.right} y2={yScale(tick)} 
                                stroke={COLORS.grid} strokeWidth="1" 
                            />
                            <text 
                                x={padding.left - 10} y={yScale(tick)} 
                                dy="0.32em" textAnchor="end" 
                                className="text-[10px] fill-slate-400 font-medium"
                            >
                                {tick}
                            </text>
                        </g>
                    ))}

                    {/* Gridlines Y */}
                    {Array.from({ length: 6 }).map((_, i) => {
                        const tick = (xDomain[1] / 5) * i;
                        return (
                            <g key={`x-${i}`}>
                                <line 
                                    x1={xScale(tick)} y1={padding.top} 
                                    x2={xScale(tick)} y2={size.height - padding.bottom} 
                                    stroke={COLORS.grid} strokeWidth="1" 
                                />
                                <text 
                                    x={xScale(tick)} y={size.height - padding.bottom + 15} 
                                    textAnchor="middle" 
                                    className="text-[10px] fill-slate-400 font-medium"
                                >
                                    {tick.toFixed(1)}M
                                </text>
                            </g>
                        );
                    })}

                    {/* Axes Labels */}
                    <text 
                        x={size.width / 2} y={size.height - 15} 
                        textAnchor="middle" className="text-xs font-bold fill-slate-500 uppercase tracking-widest"
                    >
                        Demand Volume (Monthly Searches)
                    </text>
                    <text 
                        x={20} y={size.height / 2} 
                        textAnchor="middle" transform={`rotate(-90, 20, ${size.height / 2})`} 
                        className="text-xs font-bold fill-slate-500 uppercase tracking-widest"
                    >
                        Engagement Readiness (1-10)
                    </text>

                    {/* Bubbles */}
                    {data.map((d, i) => {
                        const cx = xScale(d.demandIndex);
                        const cy = yScale(d.readiness);
                        const r = rScale(d.spread);
                        const isActive = d.id === activeCategoryId;
                        const isHovered = d.id === hoveredId;
                        const isDimmed = hoveredId && !isHovered;

                        return (
                            <g 
                                key={d.id} 
                                onClick={() => onCategorySelect(d.id)}
                                onMouseEnter={() => handleHover(d.id)}
                                onMouseLeave={() => handleHover(null)}
                                className="transition-opacity duration-200 cursor-pointer"
                                style={{ opacity: isDimmed ? 0.3 : 1 }}
                            >
                                <circle 
                                    cx={cx} cy={cy} r={r} 
                                    fill={getTrendColor(d.trend)}
                                    fillOpacity={0.85}
                                    stroke={isActive ? COLORS.activeStroke : COLORS.bubbleStroke}
                                    strokeWidth={isActive ? 2 : 1}
                                    filter={isActive || isHovered ? "url(#shadow)" : ""}
                                    className="transition-all duration-300 ease-out origin-center hover:scale-105"
                                    style={{ transformBox: 'fill-box' }}
                                />
                            </g>
                        );
                    })}

                    {/* Labels */}
                    {labelLayout.map((l) => {
                        const d = data.find(item => item.id === l.id);
                        if (!d) return null;
                        const isHovered = hoveredId === l.id;
                        const isActive = activeCategoryId === l.id;
                        const isDimmed = hoveredId && !isHovered;

                        return (
                            <g 
                                key={`lbl-${l.id}`} 
                                style={{ opacity: isDimmed ? 0.2 : 1 }}
                                className="pointer-events-none transition-opacity duration-200"
                            >
                                <text 
                                    x={l.x} y={l.y} 
                                    className={`text-[10px] font-medium transition-all duration-200 ${isHovered || isActive ? 'fill-slate-900 font-bold' : 'fill-slate-600'}`}
                                >
                                    {d.label}
                                </text>
                                {/* Optional Leader Line if far from bubble? */}
                            </g>
                        );
                    })}
                </svg>

                {/* Legend Overlay */}
                <div className="absolute top-4 right-4 bg-white/90 backdrop-blur border border-slate-100 p-2 rounded-lg shadow-sm text-[10px] text-slate-500 space-y-1.5 pointer-events-none">
                    <div className="font-bold text-slate-700 mb-1">5Y Trend</div>
                    <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500"/> Growing (>2%)</div>
                    <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-slate-300"/> Stable</div>
                    <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-red-400"/> Declining (&lt;-2%)</div>
                    <div className="h-px bg-slate-100 my-1"/>
                    <div className="font-bold text-slate-700">Bubble Size</div>
                    <div className="flex items-center gap-2">Demand Spread</div>
                </div>

                {/* Tooltip */}
                {hoveredData && (
                    <div 
                        className="absolute bg-slate-900 text-white p-4 rounded-xl shadow-2xl z-50 pointer-events-none w-56 animate-in fade-in zoom-in-95 duration-100"
                        style={{ left: tooltipPos.left, top: tooltipPos.top }}
                    >
                        <div className="font-bold text-base mb-2 border-b border-slate-700 pb-2">{hoveredData.label}</div>
                        <div className="space-y-1.5 text-xs">
                            <div className="flex justify-between">
                                <span className="text-slate-400">Demand:</span>
                                <span className="font-mono font-bold">{hoveredData.demandIndex.toFixed(1)} Mn</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-400">Readiness:</span>
                                <span className="font-mono font-bold">{hoveredData.readiness.toFixed(1)}/10</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-400">Spread:</span>
                                <span className="font-mono font-bold">{hoveredData.spread.toFixed(1)}/10</span>
                            </div>
                            <div className="flex justify-between items-center pt-1 mt-1 border-t border-slate-800">
                                <span className="text-slate-400">5Y Trend:</span>
                                <span className={`font-mono font-bold px-1.5 py-0.5 rounded ${
                                    hoveredData.trend > 2 ? 'bg-emerald-900 text-emerald-400' :
                                    hoveredData.trend < -2 ? 'bg-red-900 text-red-400' :
                                    'bg-slate-800 text-slate-300'
                                }`}>
                                    {hoveredData.trend > 0 ? '+' : ''}{hoveredData.trend}%
                                </span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
