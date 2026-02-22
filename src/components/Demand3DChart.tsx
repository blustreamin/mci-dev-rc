
import React, { useRef, useEffect, useState, useMemo } from 'react';
import { CategoryBaseline, FetchableData, SweepResult, CertifiedBenchmarkV3 } from '../types';
import { Maximize2, Minimize2, ZoomIn, Info, ShieldCheck, AlertTriangle } from 'lucide-react';
import { DemandMetricsAdapter } from '../services/demandMetricsAdapter';

interface Demand3DChartProps {
    categories: CategoryBaseline[];
    results: Record<string, FetchableData<SweepResult>>;
    activeCategoryId: string | null;
    onCategorySelect: (id: string) => void;
    benchmark?: CertifiedBenchmarkV3 | null;
}

interface Point3D {
    x: number;
    y: number;
    z: number;
    data: any;
    color: string;
    screenX?: number;
    screenY?: number;
    scale?: number;
    zIndex?: number;
}

export const Demand3DChart: React.FC<Demand3DChartProps> = ({
    categories, results, activeCategoryId, onCategorySelect, benchmark
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [rotation, setRotation] = useState({ x: 0.3, y: 0.6 });
    const [isDragging, setIsDragging] = useState(false);
    const [lastMouse, setLastMouse] = useState({ x: 0, y: 0 });
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    
    // Store projected points for hit testing without re-calculation
    const projectedPointsRef = useRef<Point3D[]>([]);

    // Data Preparation
    const points: Point3D[] = useMemo(() => {
        return categories
            .filter(cat => results[cat.id]?.status === 'Success' && results[cat.id]?.data)
            .map(cat => {
                const r = results[cat.id].data!;
                
                // Use Canonical Adapter
                const demand = DemandMetricsAdapter.getDemandIndexMn(r);
                
                const readiness = r.metric_scores.readiness;
                const spread = r.metric_scores.spread;
                const trendLabel = r.trend_5y.trend_label || 'Stable';
                const contractStatus = r.forensic?.contract_status || 'UNKNOWN';

                // Benchmark Variance Calculation
                let variance = null;
                if (benchmark && benchmark.categories[cat.id]) {
                    const b = benchmark.categories[cat.id].median;
                    variance = {
                        demand: ((demand - b.demandIndexMn) / b.demandIndexMn) * 100,
                        readiness: ((readiness - b.readinessScore) / b.readinessScore) * 100,
                        spread: ((spread - b.spreadScore) / b.spreadScore) * 100
                    };
                }

                // Normalization (Assumptions for visual cube: Demand 0-25, Scores 0-10)
                const normX = (spread - 5) / 5; 
                const normY = (readiness - 5) / 5;
                const normZ = Math.min(Math.max((demand - 5) / 10, -1), 1); 

                // Color based on Trend Label (Strict)
                let color = '#94a3b8'; // Stable (Slate)
                const tLower = trendLabel.toLowerCase();
                if (tLower.includes('growing') || tLower.includes('rising') || tLower.includes('up')) color = '#10b981'; // Emerald
                if (tLower.includes('declining') || tLower.includes('down')) color = '#ef4444'; // Red

                return {
                    x: normX * 250, // Wider spread
                    y: -normY * 250, 
                    z: normZ * 250, 
                    color,
                    data: { 
                        id: cat.id, 
                        label: cat.category, 
                        demand, 
                        readiness, 
                        spread, 
                        trendLabel,
                        variance,
                        contractStatus
                    }
                };
            });
    }, [categories, results, benchmark]);

    // Animation Loop
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationFrameId: number;

        const render = () => {
            const { width, height } = canvas.getBoundingClientRect();
            // Handle high DPI
            const dpr = window.devicePixelRatio || 1;
            if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
                canvas.width = width * dpr;
                canvas.height = height * dpr;
                ctx.scale(dpr, dpr);
            }

            const centerX = width / 2;
            const centerY = height / 2;
            const focalLength = isFullscreen ? 800 : 500; // Adjust FOV based on mode

            ctx.clearRect(0, 0, width, height);

            // Project Points
            const projected: Point3D[] = points.map(p => {
                // Rotate Y
                const cosY = Math.cos(rotation.y);
                const sinY = Math.sin(rotation.y);
                let x1 = p.x * cosY - p.z * sinY;
                let z1 = p.z * cosY + p.x * sinY;

                // Rotate X
                const cosX = Math.cos(rotation.x);
                const sinX = Math.sin(rotation.x);
                let y2 = p.y * cosX - z1 * sinX;
                let z2 = z1 * cosX + p.y * sinX;

                // Perspective
                const zOffset = z2 + (isFullscreen ? 1000 : 700); 
                const scale = focalLength / zOffset;
                
                return {
                    ...p,
                    screenX: centerX + x1 * scale,
                    screenY: centerY + y2 * scale,
                    scale,
                    zIndex: z2
                };
            });

            // Store for hit testing
            projectedPointsRef.current = projected;

            // Sort by Z for painter's algorithm
            projected.sort((a, b) => b.zIndex - a.zIndex);

            // Draw Axes Grid (Box)
            const boxSize = 250;
            const projectRaw = (x: number, y: number, z: number) => {
                // Duplicate rotation logic for grid points
                const cosY = Math.cos(rotation.y);
                const sinY = Math.sin(rotation.y);
                let x1 = x * cosY - z * sinY;
                let z1 = z * cosY + x * sinY;
                const cosX = Math.cos(rotation.x);
                const sinX = Math.sin(rotation.x);
                let y2 = y * cosX - z1 * sinX;
                let z2 = z1 * cosX + y * sinX;
                const zOffset = z2 + (isFullscreen ? 1000 : 700);
                const scale = focalLength / zOffset;
                return { x: centerX + x1 * scale, y: centerY + y2 * scale };
            };

            const corners = [
                [-boxSize, -boxSize, -boxSize], [boxSize, -boxSize, -boxSize],
                [boxSize, boxSize, -boxSize], [-boxSize, boxSize, -boxSize],
                [-boxSize, -boxSize, boxSize], [boxSize, -boxSize, boxSize],
                [boxSize, boxSize, boxSize], [-boxSize, boxSize, boxSize]
            ].map(c => projectRaw(c[0], c[1], c[2]));

            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 1;
            const drawLine = (i: number, j: number) => {
                ctx.beginPath();
                ctx.moveTo(corners[i].x, corners[i].y);
                ctx.lineTo(corners[j].x, corners[j].y);
                ctx.stroke();
            };

            // Draw Box Lines
            drawLine(0, 1); drawLine(1, 2); drawLine(2, 3); drawLine(3, 0);
            drawLine(4, 5); drawLine(5, 6); drawLine(6, 7); drawLine(7, 4);
            drawLine(0, 4); drawLine(1, 5); drawLine(2, 6); drawLine(3, 7);

            // Axis Labels
            ctx.fillStyle = '#94a3b8';
            ctx.font = 'bold 12px Inter, sans-serif';
            ctx.textAlign = 'center';
            // Simple placement approximation
            ctx.fillText("Readiness (Y)", (corners[0].x + corners[4].x)/2 - 20, (corners[0].y + corners[4].y)/2);
            ctx.fillText("Spread (X)", (corners[4].x + corners[5].x)/2, (corners[4].y + corners[5].y)/2 + 20);
            ctx.fillText("Volume (Z)", (corners[5].x + corners[1].x)/2 + 20, (corners[5].y + corners[1].y)/2);

            // Draw Points
            projected.forEach(p => {
                if (!p.screenX || !p.screenY) return;

                const isHovered = hoveredId === p.data.id;
                const isActive = activeCategoryId === p.data.id;
                
                // Dynamic Sizing: Min 6, Max 18 (plus hover/active boost)
                const baseSize = 8; 
                const size = (baseSize + (p.scale || 1) * 6) * (isHovered || isActive ? 1.4 : 1);

                // Shadow
                ctx.beginPath();
                ctx.ellipse(p.screenX, p.screenY + (size * 2), size, size * 0.4, 0, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0,0,0,0.1)';
                ctx.fill();

                // Connecting Line
                if (isActive || isHovered) {
                    ctx.beginPath();
                    ctx.moveTo(p.screenX, p.screenY);
                    ctx.lineTo(p.screenX, p.screenY + (size * 2));
                    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }

                // Bubble
                ctx.beginPath();
                ctx.arc(p.screenX, p.screenY, size, 0, Math.PI * 2);
                ctx.fillStyle = p.color;
                ctx.fill();
                
                // Stroke
                ctx.lineWidth = isActive || isHovered ? 3 : 1.5;
                ctx.strokeStyle = '#ffffff';
                ctx.stroke();

                // Label (always show in Fullscreen or if Hovered/Active)
                if (isFullscreen || isHovered || isActive) {
                    ctx.fillStyle = '#1e293b';
                    ctx.font = `${isHovered ? 'bold ' : ''}11px Inter`;
                    ctx.textAlign = 'center';
                    
                    // Label Background for readability
                    const textW = ctx.measureText(p.data.label).width;
                    ctx.fillStyle = 'rgba(255,255,255,0.7)';
                    ctx.fillRect(p.screenX - textW/2 - 4, p.screenY - size - 18, textW + 8, 14);
                    
                    ctx.fillStyle = '#0f172a';
                    ctx.fillText(p.data.label, p.screenX, p.screenY - size - 8);
                }
            });

            // Re-render if dragging for smoothness
            if (isDragging) {
                animationFrameId = requestAnimationFrame(render);
            }
        };

        render();
        // One-time render listener for updates
        animationFrameId = requestAnimationFrame(render);

        return () => cancelAnimationFrame(animationFrameId);
    }, [points, rotation, hoveredId, activeCategoryId, isDragging, isFullscreen]);

    // Interaction Handlers
    const handleStart = (clientX: number, clientY: number) => {
        setIsDragging(true);
        setLastMouse({ x: clientX, y: clientY });
    };

    const handleMove = (clientX: number, clientY: number) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        // Tooltip Hit Test (using projected points)
        if (!isDragging) {
            const mx = clientX - rect.left;
            const my = clientY - rect.top;
            let hit: string | null = null;
            
            // Reverse iterate (front to back)
            for (let i = projectedPointsRef.current.length - 1; i >= 0; i--) {
                const p = projectedPointsRef.current[i];
                if (!p.screenX || !p.screenY) continue;
                const dx = mx - p.screenX;
                const dy = my - p.screenY;
                // Hit radius ~20px
                if (dx*dx + dy*dy < 400) {
                    hit = p.data.id;
                    break;
                }
            }
            setHoveredId(hit);
        }

        if (isDragging) {
            const deltaX = clientX - lastMouse.x;
            const deltaY = clientY - lastMouse.y;
            setRotation({
                x: Math.max(-0.8, Math.min(0.8, rotation.x + deltaY * 0.005)),
                y: rotation.y + deltaX * 0.005
            });
            setLastMouse({ x: clientX, y: clientY });
        }
    };

    const toggleFullscreen = () => setIsFullscreen(!isFullscreen);

    // Current Tooltip Data
    const tooltipData = points.find(p => p.data.id === hoveredId)?.data;
    
    // Active Data for Overlay
    const activeData = points.find(p => p.data.id === activeCategoryId)?.data;

    return (
        <div 
            ref={containerRef}
            className={`relative bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-8 group transition-all duration-300 ${
                isFullscreen 
                ? 'fixed inset-0 z-[1000] m-0 rounded-none w-screen h-screen' 
                : 'h-[500px]'
            }`}
        >
            {/* HUD / Controls */}
            <div className="absolute top-4 left-6 z-10 pointer-events-none">
                <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
                    Demand Landscape (3D)
                    {isFullscreen && <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full uppercase tracking-wider">Fullscreen</span>}
                </h3>
                {/* Contract Overlay Badge */}
                <div className="mt-2">
                    {activeData ? (
                        <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest border w-fit ${activeData.contractStatus === 'VALID' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
                            {activeData.contractStatus === 'VALID' ? <ShieldCheck className="w-3 h-3"/> : <AlertTriangle className="w-3 h-3"/>}
                            Demand Contract: {activeData.contractStatus}
                        </div>
                    ) : (
                        <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest bg-slate-50 px-2 py-1 rounded border border-slate-100 w-fit">
                            Demand Contract: —
                        </div>
                    )}
                </div>
            </div>
            
            {/* Axis Legend Overlay */}
            <div className="absolute bottom-6 left-6 z-10 pointer-events-none bg-white/90 backdrop-blur p-4 rounded-xl border border-slate-100 shadow-sm">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Axis Mapping</div>
                <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-slate-600"><span className="font-bold text-slate-800 w-3">X</span> Demand Spread (Fragmentation)</div>
                    <div className="flex items-center gap-2 text-xs text-slate-600"><span className="font-bold text-slate-800 w-3">Y</span> Engagement Readiness (Intent)</div>
                    <div className="flex items-center gap-2 text-xs text-slate-600"><span className="font-bold text-slate-800 w-3">Z</span> Demand Index (Volume)</div>
                </div>
            </div>

            {/* Right Controls */}
            <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
                <button 
                    onClick={toggleFullscreen}
                    className="p-2 bg-white border border-slate-200 rounded-lg shadow-sm hover:bg-slate-50 transition-all text-slate-600"
                    title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                >
                    {isFullscreen ? <Minimize2 className="w-5 h-5"/> : <Maximize2 className="w-5 h-5"/>}
                </button>
                <button 
                    onClick={() => setRotation({ x: 0.3, y: 0.6 })}
                    className="p-2 bg-white border border-slate-200 rounded-lg shadow-sm hover:bg-slate-50 transition-all text-slate-600"
                    title="Reset View"
                >
                    <ZoomIn className="w-5 h-5"/>
                </button>
            </div>

            <canvas
                ref={canvasRef}
                className="w-full h-full cursor-move touch-none"
                onMouseDown={(e) => handleStart(e.clientX, e.clientY)}
                onMouseMove={(e) => handleMove(e.clientX, e.clientY)}
                onMouseUp={() => setIsDragging(false)}
                onMouseLeave={() => { setIsDragging(false); setHoveredId(null); }}
                onTouchStart={(e) => handleStart(e.touches[0].clientX, e.touches[0].clientY)}
                onTouchMove={(e) => handleMove(e.touches[0].clientX, e.touches[0].clientY)}
                onTouchEnd={() => setIsDragging(false)}
                onClick={() => hoveredId && onCategorySelect(hoveredId)}
            />

            {/* Tooltip Overlay */}
            {tooltipData && (
                <div className="absolute top-20 right-6 z-20 pointer-events-none animate-in fade-in zoom-in-95 duration-200">
                    <div className="bg-slate-900/95 text-white p-5 rounded-2xl shadow-2xl backdrop-blur border border-slate-700 w-64">
                        <div className="flex justify-between items-start mb-3 border-b border-slate-700 pb-2">
                            <h4 className="font-bold text-lg">{tooltipData.label}</h4>
                            <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${
                                tooltipData.trendLabel === 'Growing' ? 'bg-emerald-500 text-emerald-950' : 
                                tooltipData.trendLabel === 'Declining' ? 'bg-red-500 text-white' : 'bg-slate-600 text-slate-200'
                            }`}>
                                {tooltipData.trendLabel}
                            </span>
                        </div>
                        <div className="space-y-2 text-xs font-mono">
                            <div className="flex justify-between">
                                <span className="text-slate-400">Volume:</span>
                                <span className="font-bold">{DemandMetricsAdapter.formatMn(tooltipData.demand)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-400">Readiness:</span>
                                <span className="font-bold">{tooltipData.readiness.toFixed(1)}/10</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-400">Spread:</span>
                                <span className="font-bold">{tooltipData.spread.toFixed(1)}/10</span>
                            </div>
                            
                            {/* Variance Section */}
                            {tooltipData.variance && (
                                <div className="mt-3 pt-2 border-t border-slate-700">
                                    <div className="text-[10px] font-black uppercase text-slate-500 mb-1 flex items-center gap-1">
                                        <Info className="w-3 h-3"/> vs Benchmark
                                    </div>
                                    <div className="grid grid-cols-3 gap-1 text-[10px] text-center">
                                        <div className={`p-1 rounded ${tooltipData.variance.demand > 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                                            D: {tooltipData.variance.demand > 0 ? '+' : ''}{tooltipData.variance.demand.toFixed(1)}%
                                        </div>
                                        <div className={`p-1 rounded ${tooltipData.variance.readiness > 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                                            R: {tooltipData.variance.readiness > 0 ? '+' : ''}{tooltipData.variance.readiness.toFixed(1)}%
                                        </div>
                                        <div className={`p-1 rounded ${tooltipData.variance.spread > 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                                            S: {tooltipData.variance.spread > 0 ? '+' : ''}{tooltipData.variance.spread.toFixed(1)}%
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
