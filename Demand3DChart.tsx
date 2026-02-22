
import React, { useRef, useEffect, useState, useMemo } from 'react';
import { CategoryBaseline, FetchableData, SweepResult } from './types';

interface Demand3DChartProps {
    categories: CategoryBaseline[];
    results: Record<string, FetchableData<SweepResult>>;
    activeCategoryId: string | null;
    onCategorySelect: (id: string) => void;
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
}

export const Demand3DChart: React.FC<Demand3DChartProps> = ({
    categories, results, activeCategoryId, onCategorySelect
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [rotation, setRotation] = useState({ x: 0.2, y: 0.5 });
    const [isDragging, setIsDragging] = useState(false);
    const [lastMouse, setLastMouse] = useState({ x: 0, y: 0 });
    const [hoveredId, setHoveredId] = useState<string | null>(null);

    // Data Preparation
    const points: Point3D[] = useMemo(() => {
        return categories
            .filter(cat => results[cat.id]?.status === 'Success' && results[cat.id]?.data)
            .map(cat => {
                const r = results[cat.id].data!;
                const demand = r.demand_index_mn;
                const readiness = r.metric_scores.readiness;
                const spread = r.metric_scores.spread;
                const trend = r.trend_5y.value_percent;

                // Normalization (Assumptions: Demand max ~25, Scores 0-10)
                // X: Demand Spread (-1 to 1)
                // Y: Engagement Readiness (-1 to 1)
                // Z: Demand Index (-1 to 1)
                
                const normX = (spread - 5) / 5; 
                const normY = (readiness - 5) / 5;
                const normZ = Math.min(Math.max((demand - 12.5) / 12.5, -1), 1); 

                // Color based on Trend
                let color = '#94a3b8'; // Stable (Slate)
                if (trend >= 2) color = '#10b981'; // Growing (Emerald)
                if (trend <= -2) color = '#ef4444'; // Declining (Red)

                return {
                    x: normX * 200,
                    y: -normY * 200, // Flip Y for standard graph intuition (Up is positive)
                    z: normZ * 200,
                    color,
                    data: { id: cat.id, label: cat.category, demand, readiness, spread, trend }
                };
            });
    }, [categories, results]);

    // Animation Loop
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationFrameId: number;

        const render = () => {
            // Resize logic
            const { width, height } = canvas.getBoundingClientRect();
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
            }

            const centerX = width / 2;
            const centerY = height / 2;
            const focalLength = 400;

            ctx.clearRect(0, 0, width, height);

            // 1. Calculate Projections
            const projectedPoints = points.map(p => {
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

                // Perspective Push
                const zOffset = z2 + 600; // Camera distance
                const scale = focalLength / zOffset;
                
                return {
                    ...p,
                    screenX: centerX + x1 * scale,
                    screenY: centerY + y2 * scale,
                    scale,
                    zIndex: z2
                };
            });

            // Sort by Z for painter's algorithm
            projectedPoints.sort((a, b) => b.zIndex - a.zIndex);

            // 2. Draw Axes (Simplistic Box)
            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 1;
            
            const drawLine = (p1: any, p2: any) => {
                ctx.beginPath();
                ctx.moveTo(p1.screenX, p1.screenY);
                ctx.lineTo(p2.screenX, p2.screenY);
                ctx.stroke();
            };

            // Helper to project raw coords
            const project = (x: number, y: number, z: number) => {
                const cosY = Math.cos(rotation.y);
                const sinY = Math.sin(rotation.y);
                let x1 = x * cosY - z * sinY;
                let z1 = z * cosY + x * sinY;
                const cosX = Math.cos(rotation.x);
                const sinX = Math.sin(rotation.x);
                let y2 = y * cosX - z1 * sinX;
                let z2 = z1 * cosX + y * sinX;
                const zOffset = z2 + 600;
                const scale = focalLength / zOffset;
                return { screenX: centerX + x1 * scale, screenY: centerY + y2 * scale };
            };

            // Draw bounding box / axes
            const axisSize = 200;
            const corners = [
                [-axisSize, -axisSize, -axisSize], [axisSize, -axisSize, -axisSize],
                [axisSize, axisSize, -axisSize], [-axisSize, axisSize, -axisSize],
                [-axisSize, -axisSize, axisSize], [axisSize, -axisSize, axisSize],
                [axisSize, axisSize, axisSize], [-axisSize, axisSize, axisSize]
            ].map(c => project(c[0], c[1], c[2]));

            ctx.strokeStyle = 'rgba(203, 213, 225, 0.4)';
            // Draw connections
            drawLine(corners[0], corners[1]); drawLine(corners[1], corners[2]);
            drawLine(corners[2], corners[3]); drawLine(corners[3], corners[0]); // Back face
            drawLine(corners[4], corners[5]); drawLine(corners[5], corners[6]);
            drawLine(corners[6], corners[7]); drawLine(corners[7], corners[4]); // Front face
            drawLine(corners[0], corners[4]); drawLine(corners[1], corners[5]);
            drawLine(corners[2], corners[6]); drawLine(corners[3], corners[7]); // Connecting lines

            // 3. Draw Points
            projectedPoints.forEach(p => {
                if (!p.screenX || !p.screenY) return;

                const isHovered = hoveredId === p.data.id;
                const isActive = activeCategoryId === p.data.id;
                const radius = (isActive || isHovered ? 12 : 6) * p.scale!;

                // Shadow
                ctx.beginPath();
                ctx.arc(p.screenX, p.screenY + (20 * p.scale!), radius, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0,0,0,0.1)';
                ctx.fill();

                // Point
                ctx.beginPath();
                ctx.arc(p.screenX, p.screenY, radius, 0, Math.PI * 2);
                ctx.fillStyle = p.color;
                ctx.fill();
                ctx.lineWidth = isActive || isHovered ? 2 : 1;
                ctx.strokeStyle = '#ffffff';
                ctx.stroke();

                // Label (if close to front or hovered)
                if (p.zIndex > -100 || isHovered || isActive) {
                    ctx.fillStyle = '#1e293b';
                    ctx.font = `${isHovered ? 'bold ' : ''}${Math.max(10, 12 * p.scale!)}px Inter`;
                    ctx.textAlign = 'center';
                    ctx.fillText(p.data.label, p.screenX, p.screenY - radius - 5);
                }
            });

            animationFrameId = requestAnimationFrame(render);
        };

        render();

        return () => cancelAnimationFrame(animationFrameId);
    }, [points, rotation, hoveredId, activeCategoryId]);

    // Interaction Handlers
    const handleMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true);
        setLastMouse({ x: e.clientX, y: e.clientY });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        // Hover detection (Naive approx)
        // We need to re-calculate projection for hit testing or share state.
        // For simplicity in this constrained env, we'll do a quick check against the last rendered frame's assumed positions
        // Actually, let's just rotate. Hover requires projecting in the event handler which is expensive, 
        // or storing projected points in a ref.
        // We'll skip precise hover for rotation logic first.
        
        if (isDragging) {
            const deltaX = e.clientX - lastMouse.x;
            const deltaY = e.clientY - lastMouse.y;
            setRotation({
                x: rotation.x + deltaY * 0.01,
                y: rotation.y + deltaX * 0.01
            });
            setLastMouse({ x: e.clientX, y: e.clientY });
        } else {
            // Simple proximity check for hover (needs access to projected points, using a simplified approach)
            // Ideally we'd store projected coords in a ref.
        }
    };

    const handleMouseUp = () => setIsDragging(false);

    return (
        <div className="relative bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-8 group">
            <div className="absolute top-4 left-4 z-10 pointer-events-none">
                <h3 className="font-bold text-slate-900 text-lg">3D Demand Landscape</h3>
                <div className="text-xs text-slate-500 space-y-1 mt-1">
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> Growing (>2%)</div>
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-slate-400"></span> Stable</div>
                    <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-500"></span> Declining (&lt;-2%)</div>
                </div>
            </div>
            
            <div className="absolute bottom-4 left-4 z-10 pointer-events-none text-[10px] text-slate-400 bg-white/80 p-2 rounded border border-slate-100">
                <div>X-Axis: Spread (Fragmentation)</div>
                <div>Y-Axis: Engagement Readiness</div>
                <div>Z-Axis: Demand Volume (Depth)</div>
                <div>Color: 5Y Trend</div>
            </div>

            <canvas
                ref={canvasRef}
                className="w-full h-[450px] cursor-move active:cursor-grabbing"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            />
            
            <div className="absolute top-4 right-4 flex flex-col gap-2">
                <button 
                    onClick={() => setRotation({ x: 0.2, y: 0.5 })}
                    className="p-2 bg-white border border-slate-200 rounded shadow text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                    Reset View
                </button>
            </div>
        </div>
    );
};
