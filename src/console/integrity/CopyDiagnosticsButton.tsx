
import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface CopyDiagnosticsButtonProps {
    data: any;
    label?: string;
    className?: string;
}

export const CopyDiagnosticsButton: React.FC<CopyDiagnosticsButtonProps> = ({ 
    data, 
    label = "Copy Diagnostics", 
    className = "" 
}) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        try {
            const text = JSON.stringify(data, null, 2);
            navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (e) {
            console.error("Copy failed", e);
            alert("Failed to copy to clipboard");
        }
    };

    return (
        <button 
            onClick={handleCopy}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95 ${
                copied 
                ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' 
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:text-slate-900'
            } ${className}`}
        >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied!' : label}
        </button>
    );
};
