import "./style.css";

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

const $ = <T extends HTMLElement>(sel: string) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Missing element: ${sel}`);
    return el as T;
};

const canvas = $<HTMLCanvasElement>("#c");
const statusEl = $<HTMLDivElement>("#status");

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

const rawCtx = canvas.getContext("2d", { alpha: false });
if (!rawCtx) throw new Error("2D canvas not supported");
const ctx = rawCtx; // now ctx is properly narrowed to CanvasRenderingContext2D

let palletW = 1200;
let palletD = 800;
let grid = 10;

let boxes: Box[] = [];
let nextId = 1;

let selectedId: number | null = null;

// View transform (world mm -> screen px)
let scale = 0.5;       // px per mm
let panX = 30;         // px
let panY = 30;         // px

// Interaction state
let isDragging = false;
let isPanning = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let lastPointerX = 0;
let lastPointerY = 0;

let dirty = true;
let rafScheduled = false;

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
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1)); // cap DPR for panel performance
    const w = Math.floor(rect.width * dpr);
    const h = Math.floor(rect.height * dpr);

    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
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

    // Pallet fill
    ctx.fillStyle = "#0c1724";
    ctx.fillRect(x, y, w, h);

    // Pallet border
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    // Origin marker
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

    // Orientation tick
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
    ctx.fillText(`#${b.id} ${b.rot}°`, s0.x + 6, s0.y + 16);
}

function draw() {
    dirty = false;
    resizeCanvasToCSSPixels();

    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Background
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

function fitView() {
    // Fit pallet into canvas area with margin
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
    // Topmost: last in array
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
    const data = JSON.parse(text) as Recipe;

    if (!data?.pallet?.w || !data?.pallet?.d) throw new Error("Invalid recipe: pallet missing");
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
}

function updateFromInputs() {
    palletW = Math.max(100, Number(palletWEl.value) || palletW);
    palletD = Math.max(100, Number(palletDEl.value) || palletD);
    grid = Math.max(1, Number(gridEl.value) || grid);

    // Ensure all boxes still valid
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

    // Adjust pan so the world point stays under cursor
    panX += (after.x - before.x) * scale;
    panY += (after.y - before.y) * scale;
    markDirty();
}

// --- UI events
[palletWEl, palletDEl, gridEl].forEach(el => el.addEventListener("change", updateFromInputs));

btnAdd.addEventListener("click", () => {
    // Add at pallet center
    addBoxAt(palletW / 2, palletD / 2);
});

btnRotate.addEventListener("click", rotateSelected);
btnDelete.addEventListener("click", deleteSelected);
btnFit.addEventListener("click", fitView);

btnExport.addEventListener("click", () => {
    jsonEl.value = JSON.stringify(exportRecipe(), null, 2);
});

btnImport.addEventListener("click", () => {
    importRecipe(jsonEl.value);
});

btnClear.addEventListener("click", () => {
    clearAll();
    jsonEl.value = "";
});

// Keyboard shortcuts (useful on PC; panels may not have)
window.addEventListener("keydown", (e) => {
    if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
    if (e.key.toLowerCase() === "r") rotateSelected();
    if (e.key.toLowerCase() === "f") fitView();
});

// Pointer interactions (mouse + touch)
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);

    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    lastPointerX = sx;
    lastPointerY = sy;

    const w = screenToWorld(sx, sy);

    // Right mouse button -> pan
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

// Double click/tap: add box at point
canvas.addEventListener("dblclick", (e) => {
    const rect = canvas.getBoundingClientRect();
    const w = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    addBoxAt(w.x, w.y);
});

// Initial
updateFromInputs();
fitView();
draw();