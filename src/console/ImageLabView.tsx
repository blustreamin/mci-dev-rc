import React, { useState, useRef } from 'react';
import { Upload, Wand2, Image as ImageIcon, CheckCircle2, Loader2, Sparkles, RefreshCcw } from 'lucide-react';
import { editImage } from '../services/geminiService';

export const ImageLabView: React.FC = () => {
    const [originalImage, setOriginalImage] = useState<string | null>(null);
    const [editedImage, setEditedImage] = useState<string | null>(null);
    const [prompt, setPrompt] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            setOriginalImage(ev.target?.result as string);
            setEditedImage(null);
        };
        reader.readAsDataURL(file);
    };

    const handleEdit = async () => {
        if (!originalImage || !prompt.trim()) return;
        setIsProcessing(true);
        try {
            // Remove data:image/png;base64, prefix
            const base64 = originalImage.split(',')[1];
            const result = await editImage(base64, prompt);
            if (result) setEditedImage(result);
        } catch (e) {
            alert("Image transformation failed.");
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="max-w-5xl mx-auto px-4 pb-20">
            <div className="mb-10 text-center">
                <h1 className="text-3xl font-black text-slate-900 tracking-tight mb-2">Image Intelligence Lab</h1>
                <p className="text-slate-500 max-w-lg mx-auto">Use Gemini 2.5 Flash Image to transform product visuals or lifestyle shots with natural language prompts.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                {/* Control Panel */}
                <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/50 space-y-8">
                    <div>
                        <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2">
                            <ImageIcon className="w-3.5 h-3.5"/> Source Visual
                        </h3>
                        <div 
                            onClick={() => fileInputRef.current?.click()}
                            className="aspect-video bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl flex flex-col items-center justify-center cursor-pointer hover:bg-slate-100 transition-all overflow-hidden relative"
                        >
                            {originalImage ? (
                                <img src={originalImage} className="w-full h-full object-cover" alt="Original" />
                            ) : (
                                <>
                                    <Upload className="w-8 h-8 text-slate-300 mb-2" />
                                    <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Upload or Capture</p>
                                </>
                            )}
                            <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*" />
                        </div>
                    </div>

                    <div>
                        <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2">
                            <Wand2 className="w-3.5 h-3.5"/> Transformation Prompt
                        </h3>
                        <textarea 
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="e.g. 'Add a retro filter', 'Remove the person in the background', 'Make it look professional'..."
                            className="w-full bg-slate-50 border border-slate-200 p-4 rounded-2xl text-xs font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none h-32"
                        />
                        <div className="flex flex-wrap gap-2 mt-3">
                            {['Add retro filter', 'Remove background', 'Enhance lighting', 'Clean finish'].map(suggestion => (
                                <button 
                                    key={suggestion}
                                    onClick={() => setPrompt(suggestion)}
                                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-full text-[10px] font-bold text-slate-600 transition-all"
                                >
                                    {suggestion}
                                </button>
                            ))}
                        </div>
                    </div>

                    <button 
                        onClick={handleEdit}
                        disabled={isProcessing || !originalImage || !prompt.trim()}
                        className="w-full bg-slate-900 text-white py-5 rounded-2xl font-black text-xs hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xl flex items-center justify-center gap-3 uppercase tracking-widest"
                    >
                        {isProcessing ? <Loader2 className="w-5 h-5 animate-spin"/> : <Sparkles className="w-5 h-5 fill-current text-amber-400"/>}
                        {isProcessing ? 'Processing Pixels...' : 'Apply Intelligent Edit'}
                    </button>
                </div>

                {/* Result Preview */}
                <div className="space-y-6">
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500"/> Transformed Output
                    </h3>
                    <div className="aspect-[4/5] bg-slate-900 rounded-[3rem] shadow-2xl overflow-hidden flex items-center justify-center relative border-[12px] border-white ring-1 ring-slate-200">
                        {editedImage ? (
                            <img src={editedImage} className="w-full h-full object-cover animate-in fade-in zoom-in-95 duration-700" alt="Result" />
                        ) : (
                            <div className="text-center p-12">
                                <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <Sparkles className="w-8 h-8 text-slate-700" />
                                </div>
                                <p className="text-xs font-black text-slate-600 uppercase tracking-widest">Waiting for Input</p>
                            </div>
                        )}
                        
                        {isProcessing && (
                            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-10">
                                <div className="text-center">
                                    <Loader2 className="w-12 h-12 text-white animate-spin mx-auto mb-4" />
                                    <p className="text-white text-xs font-black uppercase tracking-widest animate-pulse">Gemini 2.5 Image Rendering...</p>
                                </div>
                            </div>
                        )}
                    </div>
                    {editedImage && (
                        <div className="flex gap-4">
                            <button 
                                onClick={() => setEditedImage(null)}
                                className="flex-1 bg-white border border-slate-200 py-4 rounded-2xl font-black text-[10px] text-slate-600 hover:bg-slate-50 transition-all uppercase tracking-widest flex items-center justify-center gap-2"
                            >
                                <RefreshCcw className="w-4 h-4"/> Start New Edit
                            </button>
                            <a 
                                href={editedImage} 
                                download="mc-intel-edit.png"
                                className="flex-1 bg-indigo-600 text-white py-4 rounded-2xl font-black text-[10px] hover:bg-indigo-700 transition-all uppercase tracking-widest flex items-center justify-center gap-2"
                            >
                                Download Result
                            </a>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};