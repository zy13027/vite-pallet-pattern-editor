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
    AlertCircle
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

    // Simulate Login
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
            const plcArrayPayload = boxes.map(b => ({
                x: b.x, y: b.y, w: b.w, l: b.d, rot: b.rot
            }));
            while (plcArrayPayload.length < MAX_BOXES) {
                plcArrayPayload.push({ x: 0, y: 0, w: 0, l: 0, rot: 0 });
            }
            console.log(`[PLC WRITE]`, plcArrayPayload);
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
                ...Array(17).fill({ x: 0, y: 0, w: 0, l: 0, rot: 0 })
            ];
            const parsedBoxes: BoxData[] = mockPlcResponse
                .map((raw, index) => ({
                    id: index + 1,
                    x: raw.x, y: raw.y, w: raw.w, d: raw.l, rot: raw.rot as Rotation
                }))
                .filter(b => b.w > 0 && b.d > 0);

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
    const [view, setView] = useState({ x: -100, y: -100, w: 1400, h: 1000, scale: 1 });
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

    const getMousePos = (e: React.PointerEvent) => {
        if (!svgRef.current) return { x: 0, y: 0 };
        const CTM = svgRef.current.getScreenCTM();
        if (!CTM) return { x: 0, y: 0 };
        return { x: (e.clientX - CTM.e) / CTM.a, y: (e.clientY - CTM.f) / CTM.d };
    };

    const addBox = () => {
        if (boxes.length >= MAX_BOXES) { alert(`Limit reached: Maximum ${MAX_BOXES} boxes allowed.`); return; }
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
        setView({ ...view, x: view.x + dx, y: view.y + dy, w: newW, h: newH, scale: view.scale / zoomFactor });
    };
    const fitView = () => {
        const margin = 100;
        setView({ x: -margin, y: -margin, w: config.width + (margin * 2), h: config.depth + (margin * 2), scale: 1 });
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

    const handleWrite = async () => { await plc.writePattern(boxes); };

    // Grid lines for SVG (Darker lines for light theme)
    const gridLines = [];
    for (let x = 0; x <= config.width; x += config.grid) {
        gridLines.push(<line key={`v${x}`} x1={x} y1={0} x2={x} y2={config.depth} stroke="rgba(0,0,0,0.1)" strokeWidth="1" />);
    }
    for (let y = 0; y <= config.depth; y += config.grid) {
        gridLines.push(<line key={`h${y}`} x1={0} y1={y} x2={config.width} y2={y} stroke="rgba(0,0,0,0.1)" strokeWidth="1" />);
    }

    return (
        <div className="flex flex-col h-screen bg-slate-50 text-slate-800 font-sans overflow-hidden">

            {/* --- Top Bar (Light Theme) --- */}
            <header className="h-14 bg-white border-b border-slate-200 flex items-center px-4 justify-between shrink-0 z-10 shadow-sm">
                <div className="flex items-center gap-2">
                    <BoxIcon className="text-blue-600" />
                    <h1 className="font-bold text-lg tracking-tight text-slate-900">Siemens Pallet Editor <span className="text-xs font-normal text-slate-500 ml-2">v2.1 Light</span></h1>
                </div>

                <div className="flex items-center gap-4">
                    <div className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-full border transition-colors ${
                        plc.connectionStatus === 'connected' ? 'bg-green-50 border-green-200 text-green-700' :
                            plc.connectionStatus === 'connecting' ? 'bg-yellow-50 border-yellow-200 text-yellow-700' :
                                'bg-slate-100 border-slate-200 text-slate-500'
                    }`}>
                        <div className={`w-2 h-2 rounded-full ${
                            plc.connectionStatus === 'connected' ? 'bg-green-500 animate-pulse' :
                                plc.connectionStatus === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'
                        }`} />
                        <span>
                            {plc.connectionStatus === 'connected' ? 'PLC Online' :
                                plc.connectionStatus === 'connecting' ? 'Connecting...' : 'PLC Offline'}
                        </span>
                    </div>

                    <button
                        onClick={() => plc.connectionStatus === 'connected' ? plc.disconnect() : setShowLogin(true)}
                        className="p-2 hover:bg-slate-100 rounded-md transition-colors text-slate-600"
                        title="PLC Connection"
                    >
                        {plc.connectionStatus === 'connected' ? <Wifi className="w-5 h-5 text-green-600" /> : <WifiOff className="w-5 h-5" />}
                    </button>
                </div>
            </header>

            {/* --- Main Layout --- */}
            <div className="flex flex-1 overflow-hidden">

                {/* --- Left Sidebar (Light Theme) --- */}
                <aside className="w-80 bg-white border-r border-slate-200 flex flex-col overflow-y-auto shrink-0">

                    {/* Pallet Config */}
                    <div className="p-4 border-b border-slate-200">
                        <h3 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                            <Settings className="w-3 h-3" /> Pallet Configuration
                        </h3>
                        <div className="grid grid-cols-3 gap-2">
                            {['width', 'depth', 'grid'].map(field => (
                                <label key={field} className="text-xs text-slate-500 capitalize">
                                    {field}
                                    <input
                                        type="number"
                                        value={config[field as keyof PalletConfig]}
                                        onChange={(e) => setConfig({...config, [field]: Number(e.target.value)})}
                                        className="w-full mt-1 bg-white border border-slate-300 rounded px-2 py-1 text-slate-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                                    />
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Box Management */}
                    <div className="p-4 border-b border-slate-200">
                        <h3 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                            <BoxIcon className="w-3 h-3" /> Box Management
                        </h3>
                        <div className="grid grid-cols-2 gap-3 mb-4">
                            <label className="text-xs text-slate-500">Width <input type="number" value={defaultBoxDims.w} onChange={(e) => setDefaultBoxDims({...defaultBoxDims, w: Number(e.target.value)})} className="w-full mt-1 bg-white border border-slate-300 rounded px-2 py-1 text-slate-900" /></label>
                            <label className="text-xs text-slate-500">Depth <input type="number" value={defaultBoxDims.d} onChange={(e) => setDefaultBoxDims({...defaultBoxDims, d: Number(e.target.value)})} className="w-full mt-1 bg-white border border-slate-300 rounded px-2 py-1 text-slate-900" /></label>
                        </div>

                        <button onClick={addBox} className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-md text-sm font-medium transition-colors mb-2 shadow-sm">
                            <Plus className="w-4 h-4" /> Add Box
                        </button>

                        <div className="grid grid-cols-2 gap-2">
                            <button onClick={rotateSelected} disabled={!selectedIds.length} className="flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 py-2 rounded-md text-sm border border-slate-200">
                                <RotateCw className="w-4 h-4" /> Rotate
                            </button>
                            <button onClick={deleteSelected} disabled={!selectedIds.length} className="flex items-center justify-center gap-2 bg-slate-100 hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-50 text-slate-700 py-2 rounded-md text-sm border border-slate-200">
                                <Trash2 className="w-4 h-4" /> Delete
                            </button>
                        </div>
                    </div>

                    {/* PLC Operations */}
                    <div className="p-4 flex-1 flex flex-col">
                        <h3 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                            <Database className="w-3 h-3" /> PLC Operations
                        </h3>

                        {/* Status Card */}
                        <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 mb-4">
                            <div className="flex justify-between items-start mb-2">
                                <div className="text-xs text-slate-500">Target DB</div>
                                {isDirty && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded border border-amber-200">Unsaved</span>}
                            </div>
                            <div className="font-mono text-sm text-blue-600 mb-2">{DB_NAME}</div>

                            <div className="flex items-center gap-2 text-xs">
                                {plc.opStatus === 'writing' && <RefreshCw className="w-3 h-3 animate-spin text-yellow-600" />}
                                {plc.opStatus === 'reading' && <RefreshCw className="w-3 h-3 animate-spin text-blue-600" />}
                                {plc.opStatus === 'success' && <CheckCircle2 className="w-3 h-3 text-green-600" />}
                                {plc.opStatus === 'error' && <AlertCircle className="w-3 h-3 text-red-600" />}
                                <span className="text-slate-600">
                                    {plc.opStatus === 'idle' ? (plc.lastSyncTime ? `Synced: ${plc.lastSyncTime.toLocaleTimeString()}` : 'Ready') :
                                        plc.opStatus === 'writing' ? 'Writing Bulk Array...' :
                                            plc.opStatus === 'reading' ? 'Reading Bulk Array...' :
                                                plc.opStatus === 'success' ? 'Operation Complete' : 'Error'}
                                </span>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={handleRead}
                                disabled={plc.connectionStatus !== 'connected' || plc.opStatus !== 'idle'}
                                className="flex flex-col items-center justify-center gap-1 p-3 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 rounded-md transition-all border border-slate-300 hover:border-blue-500 shadow-sm"
                            >
                                <ArrowDownCircle className="w-5 h-5 text-blue-500" />
                                <span className="text-xs font-medium">Read from PLC</span>
                            </button>

                            <button
                                onClick={handleWrite}
                                disabled={plc.connectionStatus !== 'connected' || plc.opStatus !== 'idle'}
                                className="flex flex-col items-center justify-center gap-1 p-3 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 rounded-md transition-all border border-slate-300 hover:border-green-500 shadow-sm"
                            >
                                <ArrowUpCircle className="w-5 h-5 text-green-500" />
                                <span className="text-xs font-medium">Write to PLC</span>
                            </button>
                        </div>

                        <div className="mt-auto pt-4 border-t border-slate-200">
                            <p className="text-[10px] text-slate-400 text-center leading-tight">
                                Optimized: Uses bulk array transfer to reduce HTTP requests by 99%.
                            </p>
                        </div>
                    </div>
                </aside>

                {/* --- Canvas (Light Theme) --- */}
                <main className="flex-1 relative bg-slate-100 overflow-hidden cursor-crosshair">
                    <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
                        <button onClick={fitView} className="p-2 bg-white border border-slate-200 rounded-md shadow-sm hover:bg-slate-50 text-slate-600" title="Fit View"><Maximize className="w-5 h-5" /></button>
                        <button onClick={() => setBoxes([])} className="p-2 bg-white border border-slate-200 rounded-md shadow-sm hover:bg-red-50 hover:text-red-600 text-slate-600" title="Clear All"><Trash2 className="w-5 h-5" /></button>
                    </div>

                    <div className="absolute bottom-4 left-4 z-10 bg-white/90 backdrop-blur border border-slate-200 px-3 py-1.5 rounded-md text-xs text-slate-500 font-mono pointer-events-none shadow-sm">
                        Boxes: {boxes.length}/{MAX_BOXES} | Zoom: {Math.round((1400/view.w)*100)}%
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
                        <g>{gridLines}</g>
                        {/* Pallet Rect: White with subtle shadow/stroke */}
                        <rect x={0} y={0} width={config.width} height={config.depth} fill="#ffffff" stroke="#cbd5e1" strokeWidth="2"/>
                        {/* Origin Marker */}
                        <rect x={-5} y={-5} width={10} height={10} fill="#3b82f6" />

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
                                        {/* Box: Slate-300 fill, Darker slate stroke. Selection turns it blue. */}
                                        <rect
                                            x={box.x - w/2} y={box.y - h/2}
                                            width={w} height={h}
                                            fill={isSelected ? "rgba(59, 130, 246, 0.2)" : "#cbd5e1"}
                                            stroke={isSelected ? "#2563eb" : "#94a3b8"}
                                            strokeWidth={isSelected ? 3 : 1}
                                        />
                                        {/* Orientation Line */}
                                        <line
                                            x1={box.x} y1={box.y}
                                            x2={box.x + (box.rot === 0 ? w/2 : 0)}
                                            y2={box.y + (box.rot === 90 ? h/2 : 0)}
                                            stroke={isSelected ? "#2563eb" : "#64748b"}
                                            strokeWidth="2"
                                        />
                                        <text x={box.x - w/2 + 5} y={box.y - h/2 + 20} fill="#475569" fontSize="24" fontFamily="monospace" pointerEvents="none">#{box.id}</text>
                                    </motion.g>
                                );
                            })}
                        </AnimatePresence>
                    </svg>
                </main>
            </div>

            {/* Login Modal (Light Theme) */}
            {showLogin && (
                <div className="fixed inset-0 bg-slate-900/20 flex items-center justify-center z-50 backdrop-blur-sm">
                    <div className="bg-white border border-slate-200 p-6 rounded-lg w-96 shadow-xl">
                        <h2 className="text-xl font-bold mb-4 text-slate-800 flex items-center gap-2"><Wifi className="w-5 h-5" /> PLC Login</h2>
                        <form onSubmit={handleLoginSubmit}>
                            <div className="space-y-4">
                                <div><label className="block text-xs text-slate-500 mb-1">IP Address</label><input type="text" value={loginCreds.ip} onChange={e => setLoginCreds({...loginCreds, ip: e.target.value})} className="w-full bg-slate-50 border border-slate-300 rounded p-2 text-slate-900" /></div>
                                <div><label className="block text-xs text-slate-500 mb-1">Username</label><input type="text" value={loginCreds.user} onChange={e => setLoginCreds({...loginCreds, user: e.target.value})} className="w-full bg-slate-50 border border-slate-300 rounded p-2 text-slate-900" /></div>
                                <div><label className="block text-xs text-slate-500 mb-1">Password</label><input type="password" value={loginCreds.pass} onChange={e => setLoginCreds({...loginCreds, pass: e.target.value})} className="w-full bg-slate-50 border border-slate-300 rounded p-2 text-slate-900" /></div>
                            </div>
                            <div className="flex gap-3 mt-6">
                                <button type="button" onClick={() => setShowLogin(false)} className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded border border-slate-200">Cancel</button>
                                <button type="submit" className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium shadow-sm">Connect</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}