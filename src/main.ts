import "./style.css";

// --- Types ---

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
const btnPlcWrite = $<HTMLButtonElement>("#btnPlcWrite"); // NEW
const jsonEl = $<HTMLTextAreaElement>("#json");

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

// --- PLC Communication Logic ---

class PlcCommunicator {
    // Configuration for the Siemens PLC
    // Ensure these tags exist in your TIA Portal project and are "Writable" from Web Server
    private dbName = '"PalletDB"';

    /**
     * Writes a single value to a PLC tag using the standard AWP interface.
     * This relies on the PLC web server being active.
     */
    async writeTag(tagName: string, value: string | number): Promise<boolean> {
        try {
            // Construct the URL. For S7-1200/1500, writing usually involves a POST
            // to the web server. This is a simplified fetch implementation.
            // In a real scenario, you might use the Siemens provided 'PlcProgramWrite' class
            // if you include their JS library, but fetch is lighter.

            const url = window.location.origin + '/awp/index.html'; // Adjust endpoint if needed

            // Form Data approach is standard for Siemens AWP
            const formData = new FormData();
            formData.append(tagName, String(value));

            // Note: This fetch will likely fail in a pure local dev environment (CORS/404).
            // It is designed to run when hosted ON the PLC.
            const response = await fetch(url, {
                method: 'POST',
                body: formData,
                headers: {
                    // 'X-Requested-With': 'XMLHttpRequest' // Sometimes needed
                }
            });

            return response.ok;
        } catch (e) {
            console.error("PLC Write Error:", e);
            return false;
        }
    }

    /**
     * Orchestrates writing the entire pattern to the PLC
     */
    async writePattern(boxes: Box[]) {
        plcStatusEl.textContent = "Writing...";
        plcStatusEl.style.color = "var(--accent)";
        btnPlcWrite.disabled = true;

        try {
            // 1. Write the count
            await this.writeTag(`${this.dbName}.BoxCount`, boxes.length);

            // 2. Write each box
            // Note: Writing sequentially via HTTP can be slow. 
            // For >50 boxes, consider sending a single JSON string if your PLC parses JSON.
            for (let i = 0; i < boxes.length; i++) {
                const b = boxes[i];
                const idx = i + 1; // PLC arrays usually 1-based or 0-based depending on your style. Assuming 1-based here.

                const prefix = `${this.dbName}.Boxes[${idx}]`;

                // Parallelize requests for a single box to speed it up slightly
                await Promise.all([
                    this.writeTag(`${prefix}.x`, Math.round(b.x)),
                    this.writeTag(`${prefix}.y`, Math.round(b.y)),
                    this.writeTag(`${prefix}.w`, Math.round(b.w)),
                    this.writeTag(`${prefix}.d`, Math.round(b.d)),
                    this.writeTag(`${prefix}.rot`, b.rot)
                ]);
            }

            plcStatusEl.textContent = "Success";
            plcStatusEl.style.color = "var(--ok)";
        } catch (err) {
            plcStatusEl.textContent = "Error";
            plcStatusEl.style.color = "var(--danger)";
        } finally {
            btnPlcWrite.disabled = false;
        }
    }
}

const plc = new PlcCommunicator();

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
    const wPx = rect.width;
    const hPx = rect.height;

    const wWorld0 = screenToWorld(0, 0);
    const wWorld1 = screenToWorld(wPx, hPx);

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
    const x0 = b.x - hw;
    const y0 = b.y - hd;
    const x1 = b.x + hw;
    const y1 = b.y + hd;

    const s0 = worldToScreen(x0, y0);
    const s1 = worldToScreen(x1, y1);

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

    // Label
    ctx.fillStyle = "rgba(230,237,243,0.85)";
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
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
    statusEl.textContent =
        `Boxes: ${boxes.length}` +
        ` | Selected: ${sel ? `#${sel.id}` : "-"} ` +
        ` | Zoom: ${Math.round(scale * 100)}%`;
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
        if (
            worldX >= b.x - hw &&
            worldX <= b.x + hw &&
            worldY >= b.y - hd &&
            worldY <= b.y + hd
        ) return b;
    }
    return null;
}

function addBoxAt(x: number, y: number) {
    const w = Math.max(10, Number(boxWEl.value) || 300);
    const d = Math.max(10, Number(boxDEl.value) || 200);

    const b: Box = {
        id: nextId++,
        x: snap(x, grid),
        y: snap(y, grid),
        w, d,
        rot: 0
    };
    clampBoxToPallet(b);
    boxes.push(b);
    selectedId = b.id;
    markDirty();
}

function rotateSelected() {
    const b = selectedId ? boxes.find(x => x.id === selectedId) : null;
    if (!b) return;
    b.rot = b.rot === 0 ? 90 : 0;
    clampBoxToPallet(b);
    markDirty();
}

function deleteSelected() {
    if (!selectedId) return;
    boxes = boxes.filter(b => b.id !== selectedId);
    selectedId = null;
    markDirty();
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

        palletW = Math.max(100, data.pallet.w);
        palletD = Math.max(100, data.pallet.d);
        grid = Math.max(1, data.grid || 10);

        palletWEl.value = String(palletW);
        palletDEl.value = String(palletD);
        gridEl.value = String(grid);

        boxes = (data.boxes || []).map((b, idx) => {
            const rot: Rot = b.rot === 90 ? 90 : 0;
            const box: Box = {
                id: idx + 1,
                x: Number(b.x) || 0,
                y: Number(b.y) || 0,
                w: Math.max(10, Number(b.w) || 100),
                d: Math.max(10, Number(b.d) || 100),
                rot
            };
            box.x = snap(box.x, grid);
            box.y = snap(box.y, grid);
            clampBoxToPallet(box);
            return box;
        });

        nextId = boxes.length + 1;
        selectedId = boxes.length ? boxes[boxes.length - 1].id : null;

        fitView();
        markDirty();
    } catch (e) {
        alert("Failed to import JSON");
    }
}

function updateFromInputs() {
    palletW = Math.max(100, Number(palletWEl.value) || palletW);
    palletD = Math.max(100, Number(palletDEl.value) || palletD);
    grid = Math.max(1, Number(gridEl.value) || grid);

    for (const b of boxes) {
        b.x = snap(b.x, grid);
        b.y = snap(b.y, grid);
        clampBoxToPallet(b);
    }
    markDirty();
}

function zoomAt(screenX: number, screenY: number, factor: number) {
    const before = screenToWorld(screenX, screenY);
    scale = clamp(scale * factor, 0.05, 4.0);
    const after = screenToWorld(screenX, screenY);
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

btnExport.addEventListener("click", () => {
    jsonEl.value = JSON.stringify(exportRecipe(), null, 2);
});
btnImport.addEventListener("click", () => importRecipe(jsonEl.value));
btnClear.addEventListener("click", () => {
    clearAll();
    jsonEl.value = "";
});

// PLC Write Event
btnPlcWrite.addEventListener("click", () => {
    plc.writePattern(boxes);
});

// Keyboard
window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
    if (e.key.toLowerCase() === "r") rotateSelected();
    if (e.key.toLowerCase() === "f") fitView();
});

// Pointer
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
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

    if (!isDragging || !selectedId) return;

    const w = screenToWorld(sx, sy);
    const b = boxes.find(x => x.id === selectedId);
    if (!b) return;

    b.x = snap(w.x + dragOffsetX, grid);
    b.y = snap(w.y + dragOffsetY, grid);
    clampBoxToPallet(b);
    markDirty();
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
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    zoomAt(sx, sy, factor);
}, { passive: false });

canvas.addEventListener("dblclick", (e) => {
    const rect = canvas.getBoundingClientRect();
    const w = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    addBoxAt(w.x, w.y);
});

// Init
updateFromInputs();
fitView();
draw();