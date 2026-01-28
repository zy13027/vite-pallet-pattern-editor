import "./style.css";
import { AuthService } from "./services/auth.services";
import { PlcProgramService } from "./services/plcprogram.service";
import { RequestConfigService } from "./services/request-config.service";
import { interval, Subscription, switchMap } from "rxjs";
// --- Application Types ---

type Rot = 0 | 90;

type Box = {
    id: number;
    x: number; // center (mm)
    y: number; // center (mm)
    w: number; // mm
    d: number; // mm
    rot: Rot;
};

type Recipe = {
    pallet: { w: number; d: number };
    grid: number;
    boxes: Array<{ x: number; y: number; w: number; d: number; rot: Rot }>;
};

interface DataStruct {
    pallet: { w: number; d: number };
    grid: number;
    boxes: Array<{ x: number; y: number; w: number; d: number; rot: Rot }>;
}
// --- DOM Helpers ---

const $ = <T extends HTMLElement>(sel: string) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Missing element: ${sel}`);
    return el as T;
};

// --- Elements ---

const canvas = $<HTMLCanvasElement>("#c");
const statusEl = $<HTMLDivElement>("#status");
const plcStatusEl = $<HTMLSpanElement>("#plcStatus");

const palletWEl = $<HTMLInputElement>("#palletW");
const palletDEl = $<HTMLInputElement>("#palletD");
const gridEl = $<HTMLInputElement>("#grid");
const boxWEl = $<HTMLInputElement>("#boxW");
const boxDEl = $<HTMLInputElement>("#boxD");

const btnAdd = $<HTMLButtonElement>("#btnAdd");
const btnRotate = $<HTMLButtonElement>("#btnRotate");
const btnDelete = $<HTMLButtonElement>("#btnDelete");
const btnFit = $<HTMLButtonElement>("#btnFit");

const btnExport = $<HTMLButtonElement>("#btnExport");
const btnImport = $<HTMLButtonElement>("#btnImport");
const btnClear = $<HTMLButtonElement>("#btnClear");
const jsonEl = $<HTMLTextAreaElement>("#json");

// PLC Elements
const btnPlcLogin = $<HTMLButtonElement>("#btnPlcLogin");
const btnPlcWrite = $<HTMLButtonElement>("#btnPlcWrite");
const btnPlcRead = $<HTMLButtonElement>("#btnPlcRead");
const loginDialog = $<HTMLDialogElement>("#loginDialog");
const btnDoLogin = $<HTMLButtonElement>("#btnDoLogin");
const inputPlcUser = $<HTMLInputElement>("#plcUser");
const inputPlcPass = $<HTMLInputElement>("#plcPass");

const rawCtx = canvas.getContext("2d", { alpha: false });
if (!rawCtx) throw new Error("2D canvas not supported");
const ctx = rawCtx;

// --- State ---

let palletW = 1200;
let palletD = 800;
let grid = 20;

let boxes: Box[] = [];
let nextId = 1;
let selectedId: number | null = null;

// View transform
let scale = 0.5;
let panX = 30;
let panY = 30;

// Interaction
let isDragging = false;
let isPanning = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let lastPointerX = 0;
let lastPointerY = 0;

let dirty = true;
let rafScheduled = false;

// --- PLC Logic Integration ---

class PlcManager {
    private authService: AuthService;
    private plcService: PlcProgramService;
    private requestConfigService: RequestConfigService;

    private dbName = '"GDB_Palletizing"'; // Adjust to match your PLC DB name

    // Fixing the declaration of pollingSubscription
    private pollingSubscription: Subscription | null = null;
    public dataStructArray: DataStruct[] = [];
    
    constructor() {
        this.requestConfigService = new RequestConfigService();
        this.authService = new AuthService(this.requestConfigService);
        this.plcService = new PlcProgramService();
    }

    async login(user: string, pass: string): Promise<boolean> {
        // In local dev, window.location.hostname might be localhost. 
        // You might want to hardcode IP if testing against a real PLC from your PC.
        const ip = window.location.hostname === 'localhost' ? '192.168.0.10' : window.location.hostname;

        return await this.authService.loginToPLC(ip, user, pass);
    }

    viteOnInit() {
        this.startDataPolling();
    }

    viteOnDestroy() {
        this.stopDataPolling();
    }
    
    // start data polling
    public startDataPolling() {
        this.pollingSubscription = interval(2000)
            .pipe(switchMap(() => this.readPattern()))
            .subscribe(
                (data) => {
                    this.dataStructArray = data;
                },
                (error) => console.error('Error during data polling:', error)
            );
    }

    // stop data polling
   public stopDataPolling() {
       if (this.pollingSubscription) {
            this.pollingSubscription.unsubscribe();
            this.pollingSubscription = null;
       } 
    }

    async writePattern(boxes: Box[]) {
        const token = this.authService.getAuthToken();
        if (!token) {
            console.error("Cannot write: No auth token available");
            return false;
        }

        // We need the config to create the write request
        // Note: Your AuthService creates a config internally, but we need one here too.
        // Ideally, AuthService exposes its config, or we recreate it.
        const config = this.requestConfigService.createConfig('https', false);
        // Ensure address is set correctly (same logic as login)
        config.address = window.location.hostname === 'localhost' ? '192.168.0.1' : window.location.hostname;

        // Prepare bulk write array
        // We assume the PLC has an array of structs: "PalletDB".Boxes[1..N]
        // and a count variable: "PalletDB".BoxCount
        const paramsArray: { var: string, value: any, mode: string }[] = [];

        // 1. Write Count
        paramsArray.push({
            var: `${this.dbName}.BoxCount`,
            value: boxes.length,
            mode: 'simple'
        });

        // 2. Write Boxes
        boxes.forEach((b, i) => {
            const idx = i + 1; // 1-based index for PLC arrays usually
            const prefix = `${this.dbName}.web_data[${idx}]`;

            paramsArray.push(
                { var: `${prefix}.x`, value: Math.round(b.x), mode: 'simple' },
                { var: `${prefix}.y`, value: Math.round(b.y), mode: 'simple' },
                { var: `${prefix}.w`, value: Math.round(b.w), mode: 'simple' },
                { var: `${prefix}.d`, value: Math.round(b.d), mode: 'simple' },
                { var: `${prefix}.rot`, value: b.rot, mode: 'simple' }
            );
        });

        try {
            // Use the service to create the writer
            // Note: The library's bulkExecute is usually a method on an instance
            // We create a dummy write instance just to access the bulk mechanism
            const writer = this.plcService.createPlcProgramWrite(config, token, '', '');

            // Execute
            await writer.bulkExecute(paramsArray);
            return true;
        } catch (e) {
            console.error("Write failed", e);
            return false;
        }
    }
    
    async readPattern(): Promise<DataStruct[]> {
        const token = this.authService.getAuthToken();
        if (!token) {
            console.error("Cannot read: No auth token available");
            return [];
        }

        const config = this.requestConfigService.createConfig('https', false);
        config.address = window.location.hostname === 'localhost' ? '192.168.0.10' : window.location.hostname;
        const paramsArray  = [];
        const numberOfRows : number = 20;
        for (let i = 1; i < numberOfRows; i++) {
            const prefix = `${this.dbName}.web_data[${i}]`;
            paramsArray.push({var: `${prefix}.l`, mode: 'simple'});
            paramsArray.push({var: `${prefix}.w`, mode: 'simple'});
            paramsArray.push({var: `${prefix}.rot`, mode: 'simple'});
            paramsArray.push({var: `${prefix}.x`, mode: 'simple'});
            paramsArray.push({var: `${prefix}.y`, mode: 'simple'});
        }
        try {
            const plcReader = this.plcService.createPlcProgramRead(config, token,'');
            const responses = await plcReader.bulkExecute(paramsArray);
            if (!responses) return [];
            // TODO: map responses into structured data; placeholder returns empty array for now.
            return [];
        } catch (e) {
            console.error("Read failed", e);
            return [];
        }
    }
}

const plcManager = new PlcManager();

// --- Math & Logic ---

function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
}

function snap(n: number, step: number) {
    if (step <= 1) return n;
    return Math.round(n / step) * step;
}

function getDims(b: Box): { hw: number; hd: number } {
    const w = b.rot === 0 ? b.w : b.d;
    const d = b.rot === 0 ? b.d : b.w;
    return { hw: w / 2, hd: d / 2 };
}

function clampBoxToPallet(b: Box) {
    const { hw, hd } = getDims(b);
    b.x = clamp(b.x, hw, palletW - hw);
    b.y = clamp(b.y, hd, palletD - hd);
}

function worldToScreen(wx: number, wy: number) {
    return { x: panX + wx * scale, y: panY + wy * scale };
}

function screenToWorld(sx: number, sy: number) {
    return { x: (sx - panX) / scale, y: (sy - panY) / scale };
}

function resizeCanvasToCSSPixels() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = Math.floor(rect.width * dpr);
    const h = Math.floor(rect.height * dpr);

    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        markDirty();
    }
}

function markDirty() {
    dirty = true;
    if (!rafScheduled) {
        rafScheduled = true;
        requestAnimationFrame(() => {
            rafScheduled = false;
            if (dirty) draw();
        });
    }
}

// --- Drawing ---

function drawGrid() {
    if (grid < 5) return;
    const rect = canvas.getBoundingClientRect();
    const wWorld0 = screenToWorld(0, 0);
    const wWorld1 = screenToWorld(rect.width, rect.height);

    const x0 = clamp(Math.floor(wWorld0.x / grid) * grid, 0, palletW);
    const y0 = clamp(Math.floor(wWorld0.y / grid) * grid, 0, palletD);

    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;

    ctx.beginPath();
    for (let x = x0; x <= wWorld1.x; x += grid) {
        if (x < 0 || x > palletW) continue;
        const s0 = worldToScreen(x, 0);
        const s1 = worldToScreen(x, palletD);
        ctx.moveTo(s0.x, s0.y);
        ctx.lineTo(s1.x, s1.y);
    }
    for (let y = y0; y <= wWorld1.y; y += grid) {
        if (y < 0 || y > palletD) continue;
        const s0 = worldToScreen(0, y);
        const s1 = worldToScreen(palletW, y);
        ctx.moveTo(s0.x, s0.y);
        ctx.lineTo(s1.x, s1.y);
    }
    ctx.stroke();
}

function drawPallet() {
    const p0 = worldToScreen(0, 0);
    const p1 = worldToScreen(palletW, palletD);
    const x = p0.x, y = p0.y, w = p1.x - p0.x, h = p1.y - p0.y;

    ctx.fillStyle = "#0c1724";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    // Origin
    ctx.fillStyle = "rgba(110,168,254,0.9)";
    ctx.fillRect(x - 3, y - 3, 6, 6);
}

function drawBox(b: Box) {
    const { hw, hd } = getDims(b);
    const s0 = worldToScreen(b.x - hw, b.y - hd);
    const s1 = worldToScreen(b.x + hw, b.y + hd);
    const isSel = selectedId === b.id;

    ctx.fillStyle = isSel ? "rgba(110,168,254,0.22)" : "rgba(255,255,255,0.10)";
    ctx.strokeStyle = isSel ? "rgba(110,168,254,0.95)" : "rgba(255,255,255,0.35)";
    ctx.lineWidth = isSel ? 2 : 1.5;

    ctx.fillRect(s0.x, s0.y, s1.x - s0.x, s1.y - s0.y);
    ctx.strokeRect(s0.x, s0.y, s1.x - s0.x, s1.y - s0.y);

    // Orientation
    ctx.strokeStyle = isSel ? "rgba(110,168,254,0.95)" : "rgba(255,255,255,0.45)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const c = worldToScreen(b.x, b.y);
    const tick = worldToScreen(b.x + (b.rot === 0 ? hw : 0), b.y + (b.rot === 90 ? hd : 0));
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(tick.x, tick.y);
    ctx.stroke();

    ctx.fillStyle = "rgba(230,237,243,0.85)";
    ctx.font = "12px monospace";
    ctx.fillText(`#${b.id}`, s0.x + 6, s0.y + 16);
}

function draw() {
    dirty = false;
    resizeCanvasToCSSPixels();
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    ctx.fillStyle = "#0b1016";
    ctx.fillRect(0, 0, rect.width, rect.height);

    drawPallet();
    drawGrid();
    for (const b of boxes) drawBox(b);

    const sel = selectedId ? boxes.find(b => b.id === selectedId) : null;
    statusEl.textContent = `Boxes: ${boxes.length} | Selected: ${sel ? `#${sel.id}` : "-"} | Zoom: ${Math.round(scale * 100)}%`;
}

// --- Actions ---

function fitView() {
    const rect = canvas.getBoundingClientRect();
    const margin = 24;
    const sx = (rect.width - margin * 2) / palletW;
    const sy = (rect.height - margin * 2) / palletD;
    scale = clamp(Math.min(sx, sy), 0.05, 2.0);
    panX = margin;
    panY = margin;
    markDirty();
}

function hitTest(worldX: number, worldY: number): Box | null {
    for (let i = boxes.length - 1; i >= 0; i--) {
        const b = boxes[i];
        const { hw, hd } = getDims(b);
        if (worldX >= b.x - hw && worldX <= b.x + hw && worldY >= b.y - hd && worldY <= b.y + hd) return b;
    }
    return null;
}

function addBoxAt(x: number, y: number) {
    const w = Math.max(10, Number(boxWEl.value) || 300);
    const d = Math.max(10, Number(boxDEl.value) || 200);
    const b: Box = { id: nextId++, x: snap(x, grid), y: snap(y, grid), w, d, rot: 0 };
    clampBoxToPallet(b);
    boxes.push(b);
    selectedId = b.id;
    markDirty();
}

function rotateSelected() {
    const b = selectedId ? boxes.find(x => x.id === selectedId) : null;
    if (b) {
        b.rot = b.rot === 0 ? 90 : 0;
        clampBoxToPallet(b);
        markDirty();
    }
}

function deleteSelected() {
    if (selectedId) {
        boxes = boxes.filter(b => b.id !== selectedId);
        selectedId = null;
        markDirty();
    }
}

function clearAll() {
    boxes = [];
    selectedId = null;
    nextId = 1;
    markDirty();
}

function exportRecipe(): Recipe {
    return {
        pallet: { w: palletW, d: palletD },
        grid,
        boxes: boxes.map(b => ({ x: b.x, y: b.y, w: b.w, d: b.d, rot: b.rot }))
    };
}

function importRecipe(text: string) {
    try {
        const data = JSON.parse(text) as Recipe;
        if (!data?.pallet?.w || !data?.pallet?.d) throw new Error("Invalid recipe");
        palletW = data.pallet.w;
        palletD = data.pallet.d;
        grid = data.grid || 10;
        palletWEl.value = String(palletW);
        palletDEl.value = String(palletD);
        gridEl.value = String(grid);
        boxes = (data.boxes || []).map((b, idx) => {
            const box: Box = {
                id: idx + 1,
                x: snap(Number(b.x), grid),
                y: snap(Number(b.y), grid),
                w: Number(b.w),
                d: Number(b.d),
                rot: b.rot === 90 ? 90 : 0
            };
            clampBoxToPallet(box);
            return box;
        });
        nextId = boxes.length + 1;
        fitView();
        markDirty();
    } catch (e) {
        alert("Import failed");
    }
}

function updateFromInputs() {
    palletW = Math.max(100, Number(palletWEl.value) || palletW);
    palletD = Math.max(100, Number(palletDEl.value) || palletD);
    grid = Math.max(1, Number(gridEl.value) || grid);
    boxes.forEach(b => {
        b.x = snap(b.x, grid);
        b.y = snap(b.y, grid);
        clampBoxToPallet(b);
    });
    markDirty();
}

function zoomAt(sx: number, sy: number, factor: number) {
    const before = screenToWorld(sx, sy);
    scale = clamp(scale * factor, 0.05, 4.0);
    const after = screenToWorld(sx, sy);
    panX += (after.x - before.x) * scale;
    panY += (after.y - before.y) * scale;
    markDirty();
}

// --- Event Listeners ---

[palletWEl, palletDEl, gridEl].forEach(el => el.addEventListener("change", updateFromInputs));

btnAdd.addEventListener("click", () => addBoxAt(palletW / 2, palletD / 2));
btnRotate.addEventListener("click", rotateSelected);
btnDelete.addEventListener("click", deleteSelected);
btnFit.addEventListener("click", fitView);
btnExport.addEventListener("click", () => { jsonEl.value = JSON.stringify(exportRecipe(), null, 2); });
btnImport.addEventListener("click", () => importRecipe(jsonEl.value));
btnClear.addEventListener("click", () => { clearAll(); jsonEl.value = ""; });

// PLC UI Handlers
btnPlcLogin.addEventListener("click", () => {
    loginDialog.showModal();
});

btnDoLogin.addEventListener("click", async (e) => {
    e.preventDefault(); // prevent form submit
    const user = inputPlcUser.value;
    const pass = inputPlcPass.value;

    plcStatusEl.textContent = "Connecting...";
    loginDialog.close();

    const success = await plcManager.login(user, pass);
    if (success) {
        plcStatusEl.textContent = "Connected";
        plcStatusEl.style.color = "var(--ok)";
        btnPlcWrite.disabled = false;
        btnPlcLogin.textContent = "Logged In";
        btnPlcLogin.disabled = true;
    } else {
        plcStatusEl.textContent = "Login Failed";
        plcStatusEl.style.color = "var(--danger)";
    }
});

btnPlcWrite.addEventListener("click", async () => {
    plcStatusEl.textContent = "Writing...";
    const success = await plcManager.writePattern(boxes);
    if (success) {
        plcStatusEl.textContent = "Write Success";
        plcStatusEl.style.color = "var(--ok)";
    } else {
        plcStatusEl.textContent = "Write Failed";
        plcStatusEl.style.color = "var(--danger)";
    }
});

btnPlcRead.addEventListener("click", async () => {
    plcStatusEl.textContent = "Reading...";
    const data = await plcManager.readPattern();
    const success = Array.isArray(data);
    plcStatusEl.textContent = success ? "Read Success" : "Read Failed";
    plcStatusEl.style.color = success ? "var(--ok)" : "var(--danger)";
});

// Canvas Interaction
canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    lastPointerX = sx;
    lastPointerY = sy;
    const w = screenToWorld(sx, sy);

    if (e.button === 2) {
        isPanning = true;
        markDirty();
        return;
    }

    const hit = hitTest(w.x, w.y);
    if (hit) {
        selectedId = hit.id;
        isDragging = true;
        dragOffsetX = hit.x - w.x;
        dragOffsetY = hit.y - w.y;
    } else {
        selectedId = null;
    }
    markDirty();
});

canvas.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (isPanning) {
        panX += (sx - lastPointerX);
        panY += (sy - lastPointerY);
        lastPointerX = sx;
        lastPointerY = sy;
        markDirty();
        return;
    }

    if (isDragging && selectedId) {
        const w = screenToWorld(sx, sy);
        const b = boxes.find(x => x.id === selectedId);
        if (b) {
            b.x = snap(w.x + dragOffsetX, grid);
            b.y = snap(w.y + dragOffsetY, grid);
            clampBoxToPallet(b);
            markDirty();
        }
    }
});

canvas.addEventListener("pointerup", (e) => {
    canvas.releasePointerCapture(e.pointerId);
    isDragging = false;
    isPanning = false;
    markDirty();
});

canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    zoomAt(sx, sy, e.deltaY < 0 ? 1.12 : 0.89);
}, { passive: false });

canvas.addEventListener("dblclick", (e) => {
    const rect = canvas.getBoundingClientRect();
    const w = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    addBoxAt(w.x, w.y);
});

// Keyboard
window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
    if (e.key.toLowerCase() === "r") rotateSelected();
    if (e.key.toLowerCase() === "f") fitView();
});

// Init
updateFromInputs();
fitView();
draw();
// Start the PLC Manager logic
plcManager.viteOnInit(); 
