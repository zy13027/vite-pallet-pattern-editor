import "./style.css";
import { createIcons, Box, RotateCw, Trash2, Maximize, Settings, Wifi, X } from 'lucide';
import { AuthService } from "./services/auth.services";
import { PlcProgramService } from "./services/plcprogram.service";
import { RequestConfigService } from "./services/request-config.service";
import { interval, Subscription, switchMap } from "rxjs";

// --- 0. FAVICON INJECTION ---
// Dynamically set the favicon to the SVG in the public folder
const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement || document.createElement('link');
link.type = 'image/svg+xml';
link.rel = 'icon';
link.href = './LPallPatt.svg';
document.getElementsByTagName('head')[0].appendChild(link);

// ... [Keep your Type definitions: Rot, Box, Recipe, DataStruct here] ...
type Rot = 0 | 90;

type BoxType = {
    id: number;
    x: number;
    y: number;
    w: number;
    d: number;
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

// --- 1. INJECT OPTIMIZED HTML STRUCTURE ---
// Note: We inject into #app, which is now styled as the 800x480 container
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="app-layout">
    <!-- Top Status Bar -->
    <div class="top-bar">
      <span style="color:var(--accent);">Siemens Pallet Editor</span>
      <span id="status">Ready</span>
      <span id="plcStatus" class="status-indicator">Not Connected</span>
    </div>

    <!-- Main Canvas -->
    <div class="canvas-layer">
      <canvas id="c"></canvas>
    </div>

    <!-- Bottom Action Toolbar -->
    <div class="bottom-bar">
      <button id="btnAdd" class="btn-icon"><i data-lucide="box"></i>Add</button>
      <button id="btnRotate" class="btn-icon"><i data-lucide="rotate-cw"></i>Rot</button>
      <button id="btnDelete" class="btn-icon btn-danger"><i data-lucide="trash-2"></i>Del</button>
      <div style="width: 10px; border-right:1px solid #ddd;"></div> <!-- Spacer -->
      <button id="btnFit" class="btn-icon"><i data-lucide="maximize"></i>Fit</button>
      <button id="btnSettingsToggle" class="btn-icon"><i data-lucide="settings"></i>Cfg</button>
      <button id="btnPlcToggle" class="btn-icon"><i data-lucide="wifi"></i>PLC</button>
    </div>

    <!-- Settings Drawer (Right Side) -->
    <div id="drawerSettings" class="drawer">
      <div class="drawer-header">
        <h3>Configuration</h3>
        <button class="close-btn" id="closeSettings"><i data-lucide="x"></i></button>
      </div>
      <div class="form-grid">
        <div class="form-group"><label>Pallet W</label><input type="number" id="palletW" value="1200"></div>
        <div class="form-group"><label>Pallet D</label><input type="number" id="palletD" value="800"></div>
        <div class="form-group"><label>Grid (mm)</label><input type="number" id="grid" value="20"></div>
        <div class="form-group"><label>Box W</label><input type="number" id="boxW" value="300"></div>
        <div class="form-group"><label>Box D</label><input type="number" id="boxD" value="200"></div>
        <div class="form-group"><label>Box H</label><input type="number" id="boxH" value="200"></div>
        <div class="form-group"><label>Layers</label><input type="number" id="numLayers" value="1"></div>
      </div>
      <div style="margin-top: 20px; display:flex; gap:10px;">
         <button id="btnClear" class="btn-icon" style="width:100%; height:40px; flex-direction:row; background:#fff;">Clear All</button>
      </div>
    </div>

    <!-- PLC Drawer (Right Side) -->
    <div id="drawerPlc" class="drawer">
      <div class="drawer-header">
        <h3>PLC Comm</h3>
        <button class="close-btn" id="closePlc"><i data-lucide="x"></i></button>
      </div>
      <div class="form-group" style="margin-bottom:15px;">
        <button id="btnPlcLogin" class="btn-icon" style="width:100%; height:40px; flex-direction:row; background:#fff;">Login</button>
      </div>
      <div class="form-group" style="gap:10px;">
        <button id="btnPlcWrite" class="btn-icon" style="width:100%; height:40px; flex-direction:row; background:var(--accent); color:white; border:none;" disabled>Write Pattern</button>
        <button id="btnPlcRead" class="btn-icon" style="width:100%; height:40px; flex-direction:row; background:#fff;" disabled>Read Pattern</button>
      </div>
      <div class="form-group" style="margin-top:20px;">
        <label>Recipe JSON</label>
        <textarea id="json" style="height:80px;"></textarea>
        <div style="display:flex; gap:10px; margin-top:5px;">
            <button id="btnExport" class="btn-icon" style="flex:1; height:35px; flex-direction:row; background:#fff;">Export</button>
            <button id="btnImport" class="btn-icon" style="flex:1; height:35px; flex-direction:row; background:#fff;">Import</button>
        </div>
      </div>
    </div>

    <!-- Login Dialog -->
    <dialog id="loginDialog">
      <h3>PLC Login</h3>
      <div class="form-group" style="margin-bottom:10px;">
        <label>Username</label><input type="text" id="plcUser" value="Admin">
      </div>
      <div class="form-group" style="margin-bottom:20px;">
        <label>Password</label><input type="password" id="plcPass">
      </div>
      <div style="display:flex; justify-content:flex-end; gap:10px;">
        <button id="btnCancelLogin" class="btn-icon" style="width:80px; height:35px; flex-direction:row; background:#fff;">Cancel</button>
        <button id="btnDoLogin" class="btn-icon" style="width:80px; height:35px; flex-direction:row; background:var(--accent); color:white; border:none;">Login</button>
      </div>
    </dialog>
  </div>
`;

// Initialize Icons
createIcons({
    icons: { Box, RotateCw, Trash2, Maximize, Settings, Wifi, X },
    attrs: { 'stroke-width': 2 }
});

// --- DOM Helpers & Selection ---
const $ = <T extends HTMLElement>(sel: string) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Missing element: ${sel}`);
    return el as T;
};

// --- Elements ---
const canvas = $<HTMLCanvasElement>("#c");
const statusEl = $<HTMLSpanElement>("#status");
const plcStatusEl = $<HTMLSpanElement>("#plcStatus");

// Drawers
const drawerSettings = $<HTMLDivElement>("#drawerSettings");
const drawerPlc = $<HTMLDivElement>("#drawerPlc");

// Inputs
const palletWEl = $<HTMLInputElement>("#palletW");
const palletDEl = $<HTMLInputElement>("#palletD");
const gridEl = $<HTMLInputElement>("#grid");
const boxWEl = $<HTMLInputElement>("#boxW");
const boxDEl = $<HTMLInputElement>("#boxD");
const boxHEl = $<HTMLInputElement>("#boxH");
const numLayersEl = $<HTMLInputElement>("#numLayers");

// Buttons
const btnAdd = $<HTMLButtonElement>("#btnAdd");
const btnRotate = $<HTMLButtonElement>("#btnRotate");
const btnDelete = $<HTMLButtonElement>("#btnDelete");
const btnFit = $<HTMLButtonElement>("#btnFit");
const btnSettingsToggle = $<HTMLButtonElement>("#btnSettingsToggle");
const btnPlcToggle = $<HTMLButtonElement>("#btnPlcToggle");
const closeSettings = $<HTMLButtonElement>("#closeSettings");
const closePlc = $<HTMLButtonElement>("#closePlc");
const btnClear = $<HTMLButtonElement>("#btnClear");

const btnExport = $<HTMLButtonElement>("#btnExport");
const btnImport = $<HTMLButtonElement>("#btnImport");
const jsonEl = $<HTMLTextAreaElement>("#json");

// PLC UI
const btnPlcLogin = $<HTMLButtonElement>("#btnPlcLogin");
const btnPlcWrite = $<HTMLButtonElement>("#btnPlcWrite");
const btnPlcRead = $<HTMLButtonElement>("#btnPlcRead");
const loginDialog = $<HTMLDialogElement>("#loginDialog");
const btnDoLogin = $<HTMLButtonElement>("#btnDoLogin");
const btnCancelLogin = $<HTMLButtonElement>("#btnCancelLogin");
const inputPlcUser = $<HTMLInputElement>("#plcUser");
const inputPlcPass = $<HTMLInputElement>("#plcPass");

const rawCtx = canvas.getContext("2d", { alpha: false });
if (!rawCtx) throw new Error("2D canvas not supported");
const ctx = rawCtx;

// --- State ---
let palletW = 1200;
let palletD = 800;
let grid = 20;
let boxes: BoxType[] = [];
let nextId = 1;
let selectedId: number | null = null;

// View transform
let scale = 0.5;
let panX = 30;
let panY = 30;

// Interaction
let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

let dirty = true;
let rafScheduled = false;

// --- PLC Manager Class ---
class PlcManager {
    private authService: AuthService;
    private plcService: PlcProgramService;
    private requestConfigService: RequestConfigService;
    private dbName = '"GDB_Palletizing"';
    private pollingSubscription: Subscription | null = null;
    public dataStructArray: DataStruct[] = [];

    constructor() {
        this.requestConfigService = new RequestConfigService();
        this.authService = new AuthService(this.requestConfigService);
        this.plcService = new PlcProgramService();
    }

    async login(user: string, pass: string): Promise<boolean> {
        const ip = window.location.hostname === 'localhost' ? '192.168.0.10' : window.location.hostname;
        return await this.authService.loginToPLC(ip, user, pass);
    }

    viteOnInit() { this.startDataPolling(); }
    viteOnDestroy() { this.stopDataPolling(); }

    public startDataPolling() {
        this.pollingSubscription = interval(2000)
            .pipe(switchMap(() => this.readPattern()))
            .subscribe(
                (data) => { this.dataStructArray = data; },
                (error) => console.error('Error during data polling:', error)
            );
    }

    public stopDataPolling() {
        if (this.pollingSubscription) {
            this.pollingSubscription.unsubscribe();
            this.pollingSubscription = null;
        }
    }

    async writePattern(boxes: BoxType[]) {
        const token = this.authService.getAuthToken();
        if (!token) {
            alert("PLC Not Connected");
            return false;
        }

        if (boxes.length > 20) {
            alert("PLC Limit Reached: Max 20 boxes per layer.");
            return false;
        }

        const config = this.requestConfigService.createConfig('https', false);
        config.address = window.location.hostname === 'localhost' ? '192.168.0.10' : window.location.hostname;

        const layerHeight = parseInt(boxHEl.value) || 200;
        const layerCount = parseInt(numLayersEl.value) || 1;

        const paramsArray: { var: string, value: any, mode: string }[] = [];

        paramsArray.push(
            { var: `${this.dbName}.PatternConfig.productDimension.height`, value: layerHeight, mode: 'simple' },
            { var: `${this.dbName}.PatternConfig.layers`, value: layerCount, mode: 'simple' },
            { var: `${this.dbName}.useWebPattern`, value: true, mode: 'simple' },
            { var: `${this.dbName}.web_ProductCount`, value: boxes.length, mode: 'simple' }
        );

        boxes.forEach((b, i) => {
            const idx = i + 1;
            const prefix = `${this.dbName}.web_data[${idx}]`;
            paramsArray.push(
                { var: `${prefix}.x`, value: b.x, mode: 'simple' },
                { var: `${prefix}.y`, value: b.y, mode: 'simple' },
                { var: `${prefix}.w`, value: b.w, mode: 'simple' },
                { var: `${prefix}.l`, value: b.d, mode: 'simple' },
                { var: `${prefix}.rot`, value: b.rot, mode: 'simple' }
            );
        });

        try {
            const writer = this.plcService.createPlcProgramWrite(config, token, '', '');
            await writer.bulkExecute(paramsArray);
            return true;
        } catch (e) {
            console.error("Write failed", e);
            return false;
        }
    }

    async readPattern(): Promise<DataStruct[]> {
        return [];
    }
}

const plcManager = new PlcManager();

// --- Math & Logic ---
function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }
function snap(n: number, step: number) { return step <= 1 ? n : Math.round(n / step) * step; }
function getDims(b: BoxType) { return { hw: (b.rot === 0 ? b.w : b.d) / 2, hd: (b.rot === 0 ? b.d : b.w) / 2 }; }
function clampBoxToPallet(b: BoxType) {
    const { hw, hd } = getDims(b);
    b.x = clamp(b.x, hw, palletW - hw);
    b.y = clamp(b.y, hd, palletD - hd);
}
function worldToScreen(wx: number, wy: number) { return { x: panX + wx * scale, y: panY + wy * scale }; }
function screenToWorld(sx: number, sy: number) { return { x: (sx - panX) / scale, y: (sy - panY) / scale }; }

function resizeCanvasToCSSPixels() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    markDirty();
}

function markDirty() {
    dirty = true;
    if (!rafScheduled) {
        rafScheduled = true;
        requestAnimationFrame(() => { rafScheduled = false; if (dirty) draw(); });
    }
}

// --- Drawing (UPDATED FOR LIGHT THEME) ---
function drawGrid() {
    if (grid < 5) return;
    const rect = canvas.getBoundingClientRect();
    const wWorld0 = screenToWorld(0, 0);
    const wWorld1 = screenToWorld(rect.width, rect.height);
    const x0 = clamp(Math.floor(wWorld0.x / grid) * grid, 0, palletW);
    const y0 = clamp(Math.floor(wWorld0.y / grid) * grid, 0, palletD);

    // Light gray grid for light background
    ctx.strokeStyle = "rgba(0, 0, 0, 0.08)";
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
    const w = p1.x - p0.x, h = p1.y - p0.y;

    // Industrial Gray Pallet
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(p0.x, p0.y, w, h);

    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 2;
    ctx.strokeRect(p0.x, p0.y, w, h);

    // Origin marker (Teal)
    ctx.fillStyle = "#009999";
    ctx.fillRect(p0.x - 4, p0.y - 4, 8, 8);
}

function drawBox(b: BoxType) {
    const { hw, hd } = getDims(b);
    const s0 = worldToScreen(b.x - hw, b.y - hd);
    const s1 = worldToScreen(b.x + hw, b.y + hd);
    const isSel = selectedId === b.id;

    // Box Color: Darker gray with Teal selection
    ctx.fillStyle = isSel ? "rgba(0, 153, 153, 0.2)" : "rgba(255, 255, 255, 0.8)";
    ctx.strokeStyle = isSel ? "#009999" : "#64748b";
    ctx.lineWidth = isSel ? 2 : 1;

    ctx.fillRect(s0.x, s0.y, s1.x - s0.x, s1.y - s0.y);
    ctx.strokeRect(s0.x, s0.y, s1.x - s0.x, s1.y - s0.y);

    // Orientation Indicator
    ctx.beginPath();
    const c = worldToScreen(b.x, b.y);
    const tick = worldToScreen(b.x + (b.rot === 0 ? hw * 0.8 : 0), b.y + (b.rot === 90 ? hd * 0.8 : 0));
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(tick.x, tick.y);
    ctx.stroke();

    ctx.fillStyle = "#333";
    ctx.font = "12px sans-serif";
    ctx.fillText(`#${b.id}`, s0.x + 5, s0.y + 15);
}

function draw() {
    dirty = false;
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    // Main Background (Light)
    ctx.fillStyle = "#f3f4f6";
    ctx.fillRect(0, 0, rect.width, rect.height);

    drawPallet();
    drawGrid();
    for (const b of boxes) drawBox(b);

    const sel = selectedId ? boxes.find(b => b.id === selectedId) : null;
    statusEl.textContent = `Box: ${sel ? `#${sel.id}` : "-"} | Total: ${boxes.length}`;
}

// --- Actions ---
function fitView() {
    const rect = canvas.getBoundingClientRect();
    const margin = 40;
    const sx = (rect.width - margin * 2) / palletW;
    const sy = (rect.height - margin * 2) / palletD;
    scale = clamp(Math.min(sx, sy), 0.05, 2.0);
    const screenW = palletW * scale;
    const screenH = palletD * scale;
    panX = (rect.width - screenW) / 2;
    panY = (rect.height - screenH) / 2;
    markDirty();
}

function hitTest(worldX: number, worldY: number): BoxType | null {
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
    const b: BoxType = { id: nextId++, x: snap(x, grid), y: snap(y, grid), w, d, rot: 0 };
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
            const box: BoxType = {
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

// --- Event Listeners ---
const toggleDrawer = (el: HTMLElement) => {
    if (el !== drawerSettings) drawerSettings.classList.remove('open');
    if (el !== drawerPlc) drawerPlc.classList.remove('open');
    el.classList.toggle('open');
};

btnSettingsToggle.addEventListener("click", () => toggleDrawer(drawerSettings));
btnPlcToggle.addEventListener("click", () => toggleDrawer(drawerPlc));
closeSettings.addEventListener("click", () => drawerSettings.classList.remove('open'));
closePlc.addEventListener("click", () => drawerPlc.classList.remove('open'));

canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const w = screenToWorld(sx, sy);

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
    if (!isDragging || !selectedId) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const w = screenToWorld(sx, sy);

    const b = boxes.find(x => x.id === selectedId);
    if (b) {
        b.x = snap(w.x + dragOffsetX, grid);
        b.y = snap(w.y + dragOffsetY, grid);
        clampBoxToPallet(b);
        markDirty();
    }
});

canvas.addEventListener("pointerup", (e) => {
    canvas.releasePointerCapture(e.pointerId);
    isDragging = false;
    markDirty();
});

btnAdd.addEventListener("click", () => addBoxAt(palletW / 2, palletD / 2));
btnRotate.addEventListener("click", rotateSelected);
btnDelete.addEventListener("click", deleteSelected);
btnFit.addEventListener("click", fitView);
btnClear.addEventListener("click", () => { clearAll(); jsonEl.value = ""; });

[palletWEl, palletDEl, gridEl].forEach(el => el.addEventListener("change", updateFromInputs));

btnPlcLogin.addEventListener("click", () => loginDialog.showModal());
btnCancelLogin.addEventListener("click", () => loginDialog.close());

btnDoLogin.addEventListener("click", async (e) => {
    e.preventDefault();
    const user = inputPlcUser.value;
    const pass = inputPlcPass.value;
    plcStatusEl.textContent = "Connecting...";
    loginDialog.close();

    const success = await plcManager.login(user, pass);
    if (success) {
        plcStatusEl.textContent = "Connected";
        plcStatusEl.style.color = "var(--ok)";
        btnPlcWrite.disabled = false;
        btnPlcRead.disabled = false;
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

btnExport.addEventListener("click", () => { jsonEl.value = JSON.stringify(exportRecipe(), null, 2); });
btnImport.addEventListener("click", () => importRecipe(jsonEl.value));

window.addEventListener("resize", () => { resizeCanvasToCSSPixels(); fitView(); });
updateFromInputs();
resizeCanvasToCSSPixels();
fitView();
plcManager.viteOnInit();

// --- AUTO LOGIN LOGIC ---
(async () => {
    console.log("Attempting Auto-Login...");
    plcStatusEl.textContent = "Auto-Connecting...";

    // Disable login button while working
    btnPlcLogin.disabled = true;

    // Credentials provided in prompt
    const success = await plcManager.login("Admin", "12345678");

    if (success) {
        console.log("Auto-Login Successful");
        plcStatusEl.textContent = "Connected";
        plcStatusEl.style.color = "var(--ok)";
        btnPlcWrite.disabled = false;
        btnPlcRead.disabled = false;
        btnPlcLogin.textContent = "Logged In";
        btnPlcLogin.disabled = true;
    } else {
        console.warn("Auto-Login Failed");
        plcStatusEl.textContent = "Login Failed";
        plcStatusEl.style.color = "var(--danger)";
        btnPlcLogin.disabled = false; // Re-enable so they can try manually
    }
})();