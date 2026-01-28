import React, { useState, useRef, useEffect } from 'react';
import {
    Box as BoxIcon,
    RotateCw,
    Trash2,
    Maximize,
    Wifi,
    WifiOff,
    RefreshCw,
    Plus,
    Settings,
    Database,
    ArrowDownCircle,
    ArrowUpCircle,
    CheckCircle2,
    AlertCircle,
    ZoomIn,
    ZoomOut,
    Grid
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// --- Types ---
type Rotation = 0 | 90;

interface BoxData {
    id: number;
    x: number;
    y: number;
    w: number;
    d: number;
    rot: Rotation;
}

interface PalletConfig {
    width: number;
    depth: number;
    grid: number;
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';
type OperationState = 'idle' | 'reading' | 'writing' | 'success' | 'error';

// --- Constants ---
const MAX_BOXES = 20;
const DB_NAME = '"GDB_Palletizing"';

// --- Helper Functions ---
const snap = (val: number, step: number) => step <= 1 ? val : Math.round(val / step) * step;
const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));

// --- Custom Hook: Optimized PLC Communication ---
const usePlcCommunication = () => {
    const [connectionStatus, setConnectionStatus] = useState<ConnectionState>('disconnected');
    const [opStatus, setOpStatus] = useState<OperationState>('idle');
    const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

    const connect = async (ip: string, user: string, pass: string) => {
        setConnectionStatus('connecting');
        return new Promise<boolean>((resolve) => {
            setTimeout(() => {
                setConnectionStatus('connected');
                resolve(true);
            }, 800);
        });
    };

    const disconnect = () => {
        setConnectionStatus('disconnected');
        setLastSyncTime(null);
    };

    const writePattern = async (boxes: BoxData[]) => {
        if (connectionStatus !== 'connected') return false;
        setOpStatus('writing');
        try {
            // Simulation
            await new Promise(resolve => setTimeout(resolve, 600));
            setOpStatus('success');
            setLastSyncTime(new Date());
            setTimeout(() => setOpStatus('idle'), 2000);
            return true;
        } catch (e) {
            console.error(e);
            setOpStatus('error');
            return false;
        }
    };

    const readPattern = async (): Promise<BoxData[] | null> => {
        if (connectionStatus !== 'connected') return null;
        setOpStatus('reading');
        try {
            await new Promise(resolve => setTimeout(resolve, 600));
            const mockPlcResponse = [
                { x: 200, y: 200, w: 300, l: 200, rot: 0 },
                { x: 550, y: 200, w: 300, l: 200, rot: 90 },
                { x: 200, y: 450, w: 300, l: 200, rot: 0 },
            ];
            const parsedBoxes: BoxData[] = mockPlcResponse.map((raw, index) => ({
                id: index + 1,
                x: raw.x, y: raw.y, w: raw.w, d: raw.l, rot: raw.rot as Rotation
            }));
            setOpStatus('success');
            setLastSyncTime(new Date());
            setTimeout(() => setOpStatus('idle'), 2000);
            return parsedBoxes;
        } catch (e) {
            console.error(e);
            setOpStatus('error');
            return null;
        }
    };

    return { connectionStatus, opStatus, lastSyncTime, connect, disconnect, writePattern, readPattern };
};

// --- Main Component ---
export default function PalletEditor() {
    const [config, setConfig] = useState<PalletConfig>({ width: 1200, depth: 800, grid: 50 });
    const [defaultBoxDims, setDefaultBoxDims] = useState({ w: 300, d: 200 });
    const [boxes, setBoxes] = useState<BoxData[]>([]);
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [nextId, setNextId] = useState(1);

    // Viewport state
    const [view, setView] = useState({ x: -100, y: -100, w: 1400, h: 1000 });

    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState<{ x: number, y: number } | null>(null);
    const [dragOffset, setDragOffset] = useState<{ x: number, y: number } | null>(null);

    const svgRef = useRef<SVGSVGElement>(null);
    const plc = usePlcCommunication();

    const [showLogin, setShowLogin] = useState(false);
    const [loginCreds, setLoginCreds] = useState({ ip: '192.168.0.1', user: 'Admin', pass: '' });
    const [isDirty, setIsDirty] = useState(false);

    useEffect(() => { if (boxes.length > 0) setIsDirty(true); }, [boxes]);
    useEffect(() => { if (plc.opStatus === 'success') setIsDirty(false); }, [plc.opStatus]);

    // --- Interaction Logic ---

    const getMousePos = (e: React.PointerEvent) => {
        if (!svgRef.current) return { x: 0, y: 0 };
        const CTM = svgRef.current.getScreenCTM();
        if (!CTM) return { x: 0, y: 0 };
        return { x: (e.clientX - CTM.e) / CTM.a, y: (e.clientY - CTM.f) / CTM.d };
    };

    const addBox = () => {
        if (boxes.length >= MAX_BOXES) return;
        const newBox: BoxData = {
            id: nextId,
            x: snap(config.width / 2, config.grid),
            y: snap(config.depth / 2, config.grid),
            w: defaultBoxDims.w,
            d: defaultBoxDims.d,
            rot: 0
        };
        setBoxes([...boxes, newBox]);
        setSelectedIds([nextId]);
        setNextId(nextId + 1);
    };

    const updateSelectedBox = (updater: (b: BoxData) => BoxData) => {
        setBoxes(boxes.map(b => selectedIds.includes(b.id) ? updater(b) : b));
    };

    const rotateSelected = () => {
        updateSelectedBox(b => constrainBox({ ...b, rot: (b.rot === 0 ? 90 : 0) as Rotation }));
    };

    const deleteSelected = () => {
        setBoxes(boxes.filter(b => !selectedIds.includes(b.id)));
        setSelectedIds([]);
    };

    const constrainBox = (b: BoxData): BoxData => {
        const hw = (b.rot === 0 ? b.w : b.d) / 2;
        const hd = (b.rot === 0 ? b.d : b.w) / 2;
        return { ...b, x: clamp(b.x, hw, config.width - hw), y: clamp(b.y, hd, config.depth - hd) };
    };

    const handlePointerDown = (e: React.PointerEvent, id?: number) => {
        e.preventDefault();
        const pos = getMousePos(e);
        if (id !== undefined) {
            e.stopPropagation();
            setIsDragging(true);
            setSelectedIds([id]);
            const box = boxes.find(b => b.id === id);
            if (box) setDragOffset({ x: box.x - pos.x, y: box.y - pos.y });
        } else {
            setIsDragging(true);
            setDragStart({ x: pos.x, y: pos.y });
            setSelectedIds([]);
        }
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDragging) return;
        const pos = getMousePos(e);
        if (selectedIds.length > 0 && dragOffset) {
            const rawX = pos.x + dragOffset.x;
            const rawY = pos.y + dragOffset.y;
            updateSelectedBox(b => constrainBox({ ...b, x: snap(rawX, config.grid), y: snap(rawY, config.grid) }));
        } else if (dragStart) {
            const dx = dragStart.x - pos.x;
            const dy = dragStart.y - pos.y;
            setView(v => ({ ...v, x: v.x + dx, y: v.y + dy }));
        }
    };

    const handlePointerUp = () => { setIsDragging(false); setDragStart(null); setDragOffset(null); };

    const handleWheel = (e: React.WheelEvent) => {
        const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
        const newW = view.w * zoomFactor;
        const newH = view.h * zoomFactor;
        const dx = (view.w - newW) / 2;
        const dy = (view.h - newH) / 2;
        setView({ ...view, x: view.x + dx, y: view.y + dy, w: newW, h: newH });
    };

    const fitView = () => {
        const margin = 100;
        setView({ x: -margin, y: -margin, w: config.width + (margin * 2), h: config.depth + (margin * 2) });
    };

    const handleLoginSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setShowLogin(false);
        await plc.connect(loginCreds.ip, loginCreds.user, loginCreds.pass);
    };

    const handleRead = async () => {
        const data = await plc.readPattern();
        if (data) { setBoxes(data); setNextId(Math.max(...data.map(b => b.id), 0) + 1); fitView(); }
    };

    return (
        <div className="flex flex-col h-screen bg-slate-50 text-slate-800 font-sans overflow-hidden">

            {/* --- Header --- */}
            <header className="h-16 bg-white border-b border-slate-200 flex items-center px-6 justify-between shrink-0 z-20 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="bg-teal-600 p-2 rounded-lg shadow-sm">
                        <BoxIcon className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h1 className="font-bold text-lg tracking-tight text-slate-900 leading-none">Siemens Pallet Editor</h1>
                        <span className="text-xs font-medium text-slate-500">v2.1 Enterprise</span>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-full border transition-all ${
                        plc.connectionStatus === 'connected' ? 'bg-green-50 border-green-200 text-green-700' :
                            plc.connectionStatus === 'connecting' ? 'bg-amber-50 border-amber-200 text-amber-700' :
                                'bg-slate-100 border-slate-200 text-slate-500'
                    }`}>
                        <div className={`w-2 h-2 rounded-full ${
                            plc.connectionStatus === 'connected' ? 'bg-green-500 animate-pulse' :
                                plc.connectionStatus === 'connecting' ? 'bg-amber-500 animate-bounce' : 'bg-slate-400'
                        }`} />
                        <span className="font-semibold text-xs uppercase tracking-wide">
                            {plc.connectionStatus === 'connected' ? 'PLC Online' :
                                plc.connectionStatus === 'connecting' ? 'Connecting...' : 'PLC Offline'}
                        </span>
                    </div>

                    <button
                        onClick={() => plc.connectionStatus === 'connected' ? plc.disconnect() : setShowLogin(true)}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                    >
                        {plc.connectionStatus === 'connected' ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                        {plc.connectionStatus === 'connected' ? 'Disconnect' : 'Connect'}
                    </button>
                </div>
            </header>

            {/* --- Main Layout --- */}
            <div className="flex flex-1 overflow-hidden">

                {/* --- Sidebar --- */}
                <aside className="w-80 bg-white border-r border-slate-200 flex flex-col overflow-y-auto shrink-0 z-10 shadow-[4px_0_24px_rgba(0,0,0,0.02)]">

                    {/* Section: Config */}
                    <div className="p-5 border-b border-slate-100">
                        <div className="flex items-center gap-2 mb-4 text-teal-700">
                            <Settings className="w-4 h-4" />
                            <h3 className="text-sm font-bold uppercase tracking-wide">Configuration</h3>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase">Width (mm)</label>
                                <input type="number" value={config.width} onChange={(e) => setConfig({...config, width: Number(e.target.value)})} className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition-all" />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase">Depth (mm)</label>
                                <input type="number" value={config.depth} onChange={(e) => setConfig({...config, depth: Number(e.target.value)})} className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition-all" />
                            </div>
                            <div className="col-span-2 space-y-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase">Grid Snap (mm)</label>
                                <input type="number" value={config.grid} onChange={(e) => setConfig({...config, grid: Number(e.target.value)})} className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition-all" />
                            </div>
                        </div>
                    </div>

                    {/* Section: Box Management */}
                    <div className="p-5 border-b border-slate-100">
                        <div className="flex items-center gap-2 mb-4 text-teal-700">
                            <BoxIcon className="w-4 h-4" />
                            <h3 className="text-sm font-bold uppercase tracking-wide">Box Management</h3>
                        </div>

                        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 mb-3">
                            <div className="grid grid-cols-2 gap-3 mb-3">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">W</label>
                                    <input type="number" value={defaultBoxDims.w} onChange={(e) => setDefaultBoxDims({...defaultBoxDims, w: Number(e.target.value)})} className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-sm" />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">D</label>
                                    <input type="number" value={defaultBoxDims.d} onChange={(e) => setDefaultBoxDims({...defaultBoxDims, d: Number(e.target.value)})} className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-sm" />
                                </div>
                            </div>
                            <button onClick={addBox} className="w-full flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white py-2 rounded-md text-sm font-medium transition-colors shadow-sm active:scale-[0.98]">
                                <Plus className="w-4 h-4" /> Add New Box
                            </button>
                        </div>

                        <div className="flex gap-2">
                            <button onClick={rotateSelected} disabled={!selectedIds.length} className="flex-1 flex flex-col items-center justify-center gap-1 p-2 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 rounded-lg border border-slate-200 transition-colors group">
                                <RotateCw className="w-4 h-4 text-slate-400 group-hover:text-teal-600" />
                                <span className="text-[10px] font-bold uppercase">Rotate</span>
                            </button>
                            <button onClick={deleteSelected} disabled={!selectedIds.length} className="flex-1 flex flex-col items-center justify-center gap-1 p-2 bg-white hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 rounded-lg border border-slate-200 hover:border-red-200 transition-colors group">
                                <Trash2 className="w-4 h-4 text-slate-400 group-hover:text-red-500" />
                                <span className="text-[10px] font-bold uppercase group-hover:text-red-600">Delete</span>
                            </button>
                        </div>
                    </div>

                    {/* Section: PLC Ops */}
                    <div className="p-5 flex-1 flex flex-col bg-slate-50/50">
                        <div className="flex items-center gap-2 mb-4 text-teal-700">
                            <Database className="w-4 h-4" />
                            <h3 className="text-sm font-bold uppercase tracking-wide">PLC Operations</h3>
                        </div>

                        <div className="bg-white rounded-lg p-3 border border-slate-200 mb-4 shadow-sm">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-[10px] font-bold text-slate-400 uppercase">Target DB</span>
                                {isDirty && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded border border-amber-200 font-medium">Unsaved Changes</span>}
                            </div>
                            <div className="font-mono text-xs text-slate-700 bg-slate-100 p-2 rounded border border-slate-200 mb-3">{DB_NAME}</div>

                            <div className="flex items-center gap-2 text-xs py-1">
                                {plc.opStatus === 'writing' && <RefreshCw className="w-3 h-3 animate-spin text-amber-600" />}
                                {plc.opStatus === 'reading' && <RefreshCw className="w-3 h-3 animate-spin text-blue-600" />}
                                {plc.opStatus === 'success' && <CheckCircle2 className="w-3 h-3 text-green-600" />}
                                {plc.opStatus === 'error' && <AlertCircle className="w-3 h-3 text-red-600" />}
                                <span className="font-medium text-slate-600">
                                    {plc.opStatus === 'idle' ? (plc.lastSyncTime ? `Last Sync: ${plc.lastSyncTime.toLocaleTimeString()}` : 'Ready to Sync') :
                                        plc.opStatus === 'writing' ? 'Writing Array...' :
                                            plc.opStatus === 'reading' ? 'Reading Array...' :
                                                plc.opStatus === 'success' ? 'Success' : 'Error'}
                                </span>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 mt-auto">
                            <button
                                onClick={handleRead}
                                disabled={plc.connectionStatus !== 'connected' || plc.opStatus !== 'idle'}
                                className="flex items-center justify-center gap-2 py-2.5 bg-white hover:bg-blue-50 disabled:opacity-50 text-slate-700 rounded-md border border-slate-300 hover:border-blue-300 shadow-sm transition-all"
                            >
                                <ArrowDownCircle className="w-4 h-4 text-blue-500" />
                                <span className="text-xs font-bold">Read</span>
                            </button>

                            <button
                                onClick={() => plc.writePattern(boxes)}
                                disabled={plc.connectionStatus !== 'connected' || plc.opStatus !== 'idle'}
                                className="flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md shadow-sm transition-all"
                            >
                                <ArrowUpCircle className="w-4 h-4 text-blue-200" />
                                <span className="text-xs font-bold">Write</span>
                            </button>
                        </div>
                    </div>
                </aside>

                {/* --- Canvas Area --- */}
                <main className="flex-1 relative bg-slate-100 overflow-hidden cursor-crosshair">
                    {/* Toolbar */}
                    <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
                        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden flex flex-col">
                            <button onClick={fitView} className="p-2.5 hover:bg-slate-50 text-slate-600 border-b border-slate-100" title="Fit View"><Maximize className="w-5 h-5" /></button>
                            <button onClick={() => setView(v => ({...v, w: v.w * 0.9, h: v.h * 0.9}))} className="p-2.5 hover:bg-slate-50 text-slate-600 border-b border-slate-100" title="Zoom In"><ZoomIn className="w-5 h-5" /></button>
                            <button onClick={() => setView(v => ({...v, w: v.w * 1.1, h: v.h * 1.1}))} className="p-2.5 hover:bg-slate-50 text-slate-600" title="Zoom Out"><ZoomOut className="w-5 h-5" /></button>
                        </div>
                        <button onClick={() => setBoxes([])} className="p-2.5 bg-white border border-slate-200 rounded-lg shadow-sm hover:bg-red-50 hover:text-red-600 text-slate-600 transition-colors" title="Clear All"><Trash2 className="w-5 h-5" /></button>
                    </div>

                    {/* Info Bar */}
                    <div className="absolute bottom-4 right-4 z-10 bg-white/90 backdrop-blur border border-slate-200 px-4 py-2 rounded-full text-xs font-medium text-slate-500 shadow-sm flex items-center gap-4">
                        <span className="flex items-center gap-1"><BoxIcon className="w-3 h-3" /> {boxes.length} / {MAX_BOXES}</span>
                        <span className="w-px h-3 bg-slate-300"></span>
                        <span className="flex items-center gap-1"><Grid className="w-3 h-3" /> {Math.round((1400/view.w)*100)}%</span>
                    </div>

                    <svg
                        ref={svgRef}
                        className="w-full h-full touch-none"
                        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerLeave={handlePointerUp}
                        onWheel={handleWheel}
                    >
                        <defs>
                            <pattern id="grid" width={config.grid} height={config.grid} patternUnits="userSpaceOnUse">
                                <path d={`M ${config.grid} 0 L 0 0 0 ${config.grid}`} fill="none" stroke="rgba(148, 163, 184, 0.2)" strokeWidth="1"/>
                            </pattern>
                        </defs>

                        {/* Infinite Grid Background */}
                        <rect x={view.x} y={view.y} width={view.w} height={view.h} fill="#f1f5f9" />

                        {/* Pallet Base */}
                        <g filter="drop-shadow(0px 4px 10px rgba(0,0,0,0.1))">
                            <rect x={0} y={0} width={config.width} height={config.depth} fill="white" />
                            <rect x={0} y={0} width={config.width} height={config.depth} fill="url(#grid)" />
                            {/* Pallet Border */}
                            <rect x={0} y={0} width={config.width} height={config.depth} fill="none" stroke="#cbd5e1" strokeWidth="2" />
                        </g>

                        {/* Origin Marker */}
                        <circle cx={0} cy={0} r={8} fill="#0f766e" opacity="0.5" />
                        <text x={10} y={-10} fontSize="20" fill="#0f766e" fontFamily="monospace" fontWeight="bold">ORIGIN</text>

                        {/* Boxes */}
                        <AnimatePresence>
                            {boxes.map((box) => {
                                const isSelected = selectedIds.includes(box.id);
                                const w = box.rot === 0 ? box.w : box.d;
                                const h = box.rot === 0 ? box.d : box.w;
                                return (
                                    <motion.g
                                        key={box.id}
                                        initial={{ opacity: 0, scale: 0.8 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.5 }}
                                        onPointerDown={(e) => handlePointerDown(e, box.id)}
                                        style={{ cursor: isDragging && isSelected ? 'grabbing' : 'grab' }}
                                    >
                                        {/* Box Body */}
                                        <rect
                                            x={box.x - w/2} y={box.y - h/2}
                                            width={w} height={h}
                                            fill={isSelected ? "rgba(20, 184, 166, 0.2)" : "#e2e8f0"}
                                            stroke={isSelected ? "#0d9488" : "#94a3b8"}
                                            strokeWidth={isSelected ? 3 : 1}
                                            rx="4"
                                        />
                                        {/* Orientation Indicator */}
                                        <line
                                            x1={box.x} y1={box.y}
                                            x2={box.x + (box.rot === 0 ? w/2 - 10 : 0)}
                                            y2={box.y + (box.rot === 90 ? h/2 - 10 : 0)}
                                            stroke={isSelected ? "#0d9488" : "#94a3b8"}
                                            strokeWidth="2"
                                            markerEnd="url(#arrow)"
                                        />
                                        {/* Center Point */}
                                        <circle cx={box.x} cy={box.y} r={3} fill={isSelected ? "#0d9488" : "#94a3b8"} />

                                        {/* ID Label */}
                                        <text
                                            x={box.x} y={box.y}
                                            dy={5}
                                            textAnchor="middle"
                                            fill={isSelected ? "#0f766e" : "#64748b"}
                                            fontSize="24"
                                            fontFamily="sans-serif"
                                            fontWeight="bold"
                                            pointerEvents="none"
                                            style={{ textShadow: '0px 1px 2px rgba(255,255,255,0.8)' }}
                                        >
                                            #{box.id}
                                        </text>
                                    </motion.g>
                                );
                            })}
                        </AnimatePresence>
                    </svg>
                </main>
            </div>

            {/* Login Modal */}
            {showLogin && (
                <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 backdrop-blur-sm">
                    <div className="bg-white border border-slate-200 p-6 rounded-xl w-96 shadow-2xl">
                        <h2 className="text-xl font-bold mb-1 text-slate-800 flex items-center gap-2"><Wifi className="w-5 h-5 text-teal-600" /> PLC Connection</h2>
                        <p className="text-xs text-slate-500 mb-6">Enter credentials to connect to S7-1500 Web API</p>

                        <form onSubmit={handleLoginSubmit} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">IP Address</label>
                                <input type="text" value={loginCreds.ip} onChange={e => setLoginCreds({...loginCreds, ip: e.target.value})} className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-sm text-slate-900 focus:ring-2 focus:ring-teal-500 outline-none" placeholder="192.168.0.1" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Username</label>
                                <input type="text" value={loginCreds.user} onChange={e => setLoginCreds({...loginCreds, user: e.target.value})} className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-sm text-slate-900 focus:ring-2 focus:ring-teal-500 outline-none" placeholder="Admin" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Password</label>
                                <input type="password" value={loginCreds.pass} onChange={e => setLoginCreds({...loginCreds, pass: e.target.value})} className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-sm text-slate-900 focus:ring-2 focus:ring-teal-500 outline-none" placeholder="••••••" />
                            </div>

                            <div className="flex gap-3 mt-6 pt-2">
                                <button type="button" onClick={() => setShowLogin(false)} className="flex-1 py-2.5 bg-white hover:bg-slate-50 text-slate-700 rounded-lg border border-slate-300 font-medium transition-colors">Cancel</button>
                                <button type="submit" className="flex-1 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-medium shadow-lg shadow-teal-600/20 transition-all">Connect</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}