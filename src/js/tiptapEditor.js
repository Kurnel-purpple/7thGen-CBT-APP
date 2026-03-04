// src/js/tiptapEditor.js
// Tiptap-based rich text editor for exam question creation.
// Replaces fabricWordProcessor.js — exposes the same public API.
// Loaded as: <script type="module" src="../js/tiptapEditor.js"></script>
// Exposes:   window.TiptapEditor

import { Editor, Node, mergeAttributes } from 'https://esm.sh/@tiptap/core@2';
import StarterKit from 'https://esm.sh/@tiptap/starter-kit@2';
import Underline from 'https://esm.sh/@tiptap/extension-underline@2';

// ─── Global state ─────────────────────────────────────────────────────────────
const instances = {};
let cssInjected = false;
let uidCounter = 0;

// ─── CSS (injected once on first create()) ────────────────────────────────────
function injectCSS() {
    if (cssInjected) return;
    cssInjected = true;
    const style = document.createElement('style');
    style.id = 'tiptap-editor-styles';
    style.textContent = `
/* ── Container / Toolbar ── */
.wp-container{border:1px solid var(--border-color,#ddd);border-radius:8px;overflow:visible;background:var(--card-bg,#fff);}
.wp-toolbar{display:flex;flex-wrap:wrap;gap:4px;padding:8px 10px;background:var(--inner-bg,#f5f5f5);border-bottom:1px solid var(--border-color,#ddd);align-items:center;border-radius:8px 8px 0 0;}
.wp-toolbar-separator{width:1px;height:20px;background:var(--border-color,#ccc);margin:0 2px;}
.wp-btn{display:inline-flex;align-items:center;justify-content:center;padding:4px 8px;border:1px solid var(--border-color,#ccc);border-radius:4px;background:var(--card-bg,#fff);color:var(--text-color,#333);cursor:pointer;font-size:13px;min-width:28px;min-height:28px;transition:background .15s;user-select:none;line-height:1;}
.wp-btn:hover{background:var(--primary-light,#e8e8ff);border-color:var(--primary-color,#6366f1);}
.wp-btn.wp-active{background:var(--primary-color,#6366f1);color:#fff;border-color:var(--primary-color,#6366f1);}
.wp-btn:disabled{opacity:.4;cursor:default;}

/* ── Editor content area ── */
.wp-editor-wrapper{background:#fff;cursor:text;border-radius:0 0 8px 8px;}
.wp-editor-wrapper .ProseMirror{min-height:150px;padding:12px 14px;outline:none;font-size:15px;font-family:inherit;color:#222;line-height:1.65;}
.wp-editor-wrapper .ProseMirror p{margin:0 0 8px 0;}
.wp-editor-wrapper .ProseMirror p:last-child{margin-bottom:0;}
.wp-editor-wrapper .ProseMirror p.is-empty:first-child::before{content:attr(data-placeholder);color:#aaa;pointer-events:none;float:left;height:0;}

/* ── Shape wrapper in editor ── */
.tp-shape-wrapper{display:inline-block;position:relative;vertical-align:middle;user-select:none;line-height:0;margin:2px 3px;padding-top:20px;box-sizing:content-box;}
.tp-shape-wrapper svg{display:block;}
.tp-rotate-handle{position:absolute;top:2px;left:50%;transform:translateX(-50%);width:12px;height:12px;border-radius:50%;background:#6366f1;cursor:grab;z-index:10;}
.tp-rotate-handle::after{content:'';position:absolute;top:11px;left:4px;width:2px;height:8px;background:#6366f1;}
.tp-resize-handle{position:absolute;bottom:-5px;right:-5px;width:10px;height:10px;background:#6366f1;border-radius:2px;cursor:se-resize;z-index:10;}

/* ── Shape picker dropdown ── */
.tp-shape-picker-wrapper{position:relative;}
.tp-shape-panel{display:none;position:absolute;top:calc(100% + 6px);left:0;z-index:9999;background:var(--card-bg,#fff);border:1px solid var(--border-color,#ccc);border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.18);padding:10px 12px;min-width:260px;}
.tp-shape-panel.tp-open{display:block;}
.tp-shape-group-label{font-size:10px;font-weight:700;color:var(--light-text,#888);text-transform:uppercase;letter-spacing:.6px;margin:8px 0 4px;}
.tp-shape-group-label:first-child{margin-top:0;}
.tp-shape-row{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:2px;}
.tp-shape-item{display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;padding:5px 4px;border-radius:6px;border:1px solid transparent;transition:background .12s;}
.tp-shape-item:hover{background:var(--primary-light,#e8e8ff);border-color:var(--primary-color,#6366f1);}
.tp-shape-item>span{font-size:9px;color:var(--light-text,#666);white-space:nowrap;}

/* ── Read-only rendered content (also used by tiptapRenderer.js) ── */
.tp-readonly-content{padding:12px 14px;font-size:15px;font-family:inherit;color:var(--text-color,#222);line-height:1.65;}
.tp-readonly-content p{margin:0 0 8px 0;}
.tp-readonly-content p:last-child{margin-bottom:0;}
.tp-shape-static{display:inline-block;vertical-align:middle;line-height:0;margin:2px 3px;}

@media(max-width:600px){
  .wp-editor-wrapper .ProseMirror{font-size:14px;padding:8px 10px;}
  .tp-shape-panel{min-width:210px;}
  .tp-readonly-content{font-size:14px;padding:8px 10px;}
}
    `;
    document.head.appendChild(style);
}

// ─── SVG helpers ──────────────────────────────────────────────────────────────
function regularPolygon(cx, cy, r, n, startAngle = -Math.PI / 2) {
    return Array.from({ length: n }, (_, i) => {
        const a = startAngle + (2 * Math.PI * i) / n;
        return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
    }).join(' ');
}

function starPolygon(cx, cy, outerR, innerR) {
    return Array.from({ length: 10 }, (_, i) => {
        const a = -Math.PI / 2 + (Math.PI * i) / 5;
        const r2 = i % 2 === 0 ? outerR : innerR;
        return `${(cx + r2 * Math.cos(a)).toFixed(2)},${(cy + r2 * Math.sin(a)).toFixed(2)}`;
    }).join(' ');
}

function buildSVGContent(shapeType, w, h, attrs) {
    const sw   = attrs.strokeWidth || 2;
    const fill = attrs.fill   || 'transparent';
    const strk = attrs.stroke || '#000000';
    const uid  = attrs.uid    || (++uidCounter);
    const half = sw / 2;
    const cx = w / 2, cy = h / 2;
    const r  = Math.min(w, h) / 2 - half;

    switch (shapeType) {
        case 'rectangle':
        case 'square':
            return `<rect x="${half}" y="${half}" width="${w - sw}" height="${h - sw}" fill="${fill}" stroke="${strk}" stroke-width="${sw}"/>`;

        case 'circle':
        case 'ellipse':
            return `<ellipse cx="${cx}" cy="${cy}" rx="${Math.max(1, cx - half)}" ry="${Math.max(1, cy - half)}" fill="${fill}" stroke="${strk}" stroke-width="${sw}"/>`;

        case 'semicircle': {
            const rx = Math.max(1, cx - half), ry = Math.max(1, cy - half);
            return `<path d="M ${half},${cy} A ${rx},${ry} 0 0,1 ${w - half},${cy} Z" fill="${fill}" stroke="${strk}" stroke-width="${sw}"/>`;
        }

        case 'triangle-eq':
            return `<polygon points="${cx},${half} ${half},${h - half} ${w - half},${h - half}" fill="${fill}" stroke="${strk}" stroke-width="${sw}"/>`;

        case 'triangle-right':
            return `<polygon points="${half},${half} ${half},${h - half} ${w - half},${h - half}" fill="${fill}" stroke="${strk}" stroke-width="${sw}"/>`;

        case 'diamond':
            return `<polygon points="${cx},${half} ${w - half},${cy} ${cx},${h - half} ${half},${cy}" fill="${fill}" stroke="${strk}" stroke-width="${sw}"/>`;

        case 'parallelogram': {
            const off = w * 0.2;
            return `<polygon points="${(off + half).toFixed(1)},${half} ${w - half},${half} ${(w - off - half).toFixed(1)},${h - half} ${half},${h - half}" fill="${fill}" stroke="${strk}" stroke-width="${sw}"/>`;
        }

        case 'trapezoid': {
            const ins = w * 0.15;
            return `<polygon points="${(ins + half).toFixed(1)},${half} ${(w - ins - half).toFixed(1)},${half} ${w - half},${h - half} ${half},${h - half}" fill="${fill}" stroke="${strk}" stroke-width="${sw}"/>`;
        }

        case 'pentagon':
            return `<polygon points="${regularPolygon(cx, cy, r, 5)}" fill="${fill}" stroke="${strk}" stroke-width="${sw}"/>`;

        case 'hexagon':
            return `<polygon points="${regularPolygon(cx, cy, r, 6, 0)}" fill="${fill}" stroke="${strk}" stroke-width="${sw}"/>`;

        case 'octagon':
            return `<polygon points="${regularPolygon(cx, cy, r, 8, -Math.PI / 8)}" fill="${fill}" stroke="${strk}" stroke-width="${sw}"/>`;

        case 'star':
            return `<polygon points="${starPolygon(cx, cy, r, r * 0.42)}" fill="${fill}" stroke="${strk}" stroke-width="${sw}"/>`;

        case 'line':
            return `<line x1="${half}" y1="${cy}" x2="${w - half}" y2="${cy}" stroke="${strk}" stroke-width="${sw}" stroke-linecap="round"/>`;

        case 'arrow-right': {
            const mid = `tp-ar-${uid}`;
            const mw = Math.max(6, sw * 4), mh = Math.max(5, sw * 3);
            return `<defs><marker id="${mid}" markerWidth="${mw}" markerHeight="${mh}" refX="${mw - 1}" refY="${mh / 2}" orient="auto"><polygon points="0 0, ${mw} ${mh / 2}, 0 ${mh}" fill="${strk}"/></marker></defs>` +
                `<line x1="${half}" y1="${cy}" x2="${w - sw * 5}" y2="${cy}" stroke="${strk}" stroke-width="${sw}" stroke-linecap="round" marker-end="url(#${mid})"/>`;
        }

        case 'arrow-both': {
            const midR = `tp-abr-${uid}`, midL = `tp-abl-${uid}`;
            const mw = Math.max(6, sw * 4), mh = Math.max(5, sw * 3);
            return `<defs>
                <marker id="${midR}" markerWidth="${mw}" markerHeight="${mh}" refX="${mw - 1}" refY="${mh / 2}" orient="auto"><polygon points="0 0, ${mw} ${mh / 2}, 0 ${mh}" fill="${strk}"/></marker>
                <marker id="${midL}" markerWidth="${mw}" markerHeight="${mh}" refX="1" refY="${mh / 2}" orient="auto"><polygon points="${mw} 0, 0 ${mh / 2}, ${mw} ${mh}" fill="${strk}"/></marker>
            </defs><line x1="${sw * 5}" y1="${cy}" x2="${w - sw * 5}" y2="${cy}" stroke="${strk}" stroke-width="${sw}" stroke-linecap="round" marker-start="url(#${midL})" marker-end="url(#${midR})"/>`;
        }

        case 'cross': {
            const t  = Math.max(4, Math.min(w, h) * 0.28);
            const x0 = cx - t / 2, x1 = cx + t / 2;
            const y0 = cy - t / 2, y1 = cy + t / 2;
            return `<path d="M ${x0},${half} H ${x1} V ${y0} H ${w - half} V ${y1} H ${x1} V ${h - half} H ${x0} V ${y1} H ${half} V ${y0} H ${x0} Z" fill="${fill}" stroke="${strk}" stroke-width="${sw}"/>`;
        }

        default:
            return `<rect x="${half}" y="${half}" width="${w - sw}" height="${h - sw}" fill="${fill}" stroke="${strk}" stroke-width="${sw}"/>`;
    }
}

// ─── Shape catalogue for the picker UI ───────────────────────────────────────
const SHAPE_GROUPS = [
    {
        label: 'Basic Polygons',
        shapes: [
            { type: 'rectangle',   label: 'Rectangle',    w: 120, h: 80 },
            { type: 'square',      label: 'Square',       w: 80,  h: 80 },
            { type: 'triangle-eq', label: 'Triangle',     w: 100, h: 90 },
            { type: 'triangle-right', label: 'Right △',   w: 100, h: 90 },
            { type: 'diamond',     label: 'Diamond',      w: 90,  h: 90 },
            { type: 'parallelogram', label: 'Parallelogram', w: 120, h: 70 },
            { type: 'trapezoid',   label: 'Trapezoid',    w: 120, h: 70 },
        ],
    },
    {
        label: 'Curved',
        shapes: [
            { type: 'circle',      label: 'Circle',       w: 90,  h: 90 },
            { type: 'ellipse',     label: 'Ellipse',      w: 120, h: 70 },
            { type: 'semicircle',  label: 'Semicircle',   w: 120, h: 60 },
        ],
    },
    {
        label: 'Multi-sided',
        shapes: [
            { type: 'pentagon',    label: 'Pentagon',     w: 90,  h: 90 },
            { type: 'hexagon',     label: 'Hexagon',      w: 90,  h: 90 },
            { type: 'octagon',     label: 'Octagon',      w: 90,  h: 90 },
            { type: 'star',        label: 'Star',         w: 90,  h: 90 },
        ],
    },
    {
        label: 'Lines & Arrows',
        shapes: [
            { type: 'line',        label: 'Line',         w: 120, h: 40 },
            { type: 'arrow-right', label: 'Arrow →',      w: 120, h: 40 },
            { type: 'arrow-both',  label: 'Arrow ↔',      w: 120, h: 40 },
            { type: 'cross',       label: 'Cross',        w: 70,  h: 70 },
        ],
    },
];

// ─── Shape NodeView ───────────────────────────────────────────────────────────
function buildShapeNodeView(node, editor, getPos) {
    const uid = ++uidCounter;
    let attrs = { ...node.attrs, uid };

    const dom = document.createElement('span');
    dom.className = 'tp-shape-wrapper';
    dom.setAttribute('contenteditable', 'false');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    dom.appendChild(svg);

    const rotHandle = document.createElement('span');
    rotHandle.className = 'tp-rotate-handle';
    rotHandle.title = 'Rotate';
    dom.appendChild(rotHandle);

    const resHandle = document.createElement('span');
    resHandle.className = 'tp-resize-handle';
    resHandle.title = 'Resize';
    dom.appendChild(resHandle);

    function renderSVG() {
        const w   = attrs.width    || 120;
        const h   = attrs.height   || 80;
        const rot = attrs.rotation || 0;
        svg.setAttribute('width',  w);
        svg.setAttribute('height', h);
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        svg.style.transform = `rotate(${rot}deg)`;
        svg.innerHTML = buildSVGContent(attrs.shapeType || 'rectangle', w, h, attrs);
        dom.style.width  = w + 'px';
    }

    function commitAttrs() {
        const pos = getPos();
        if (typeof pos !== 'number') return;
        editor.view.dispatch(
            editor.view.state.tr.setNodeMarkup(pos, undefined, { ...attrs })
        );
        renderSVG();
    }

    function applyEditableState() {
        const editable = editor.isEditable;
        rotHandle.style.display = editable ? 'block' : 'none';
        resHandle.style.display = editable ? 'block' : 'none';
        dom.style.cursor = editable ? 'grab' : 'default';
    }

    // ── Resize (mouse) ──
    resHandle.addEventListener('mousedown', (e) => {
        if (!editor.isEditable) return;
        e.preventDefault(); e.stopPropagation();
        const sx = e.clientX, sy = e.clientY;
        const sw = attrs.width, sh = attrs.height;
        const locked = attrs.shapeType === 'circle' || attrs.shapeType === 'square';
        const onMove = (ev) => {
            let w = Math.max(20, sw + (ev.clientX - sx));
            let h = Math.max(20, sh + (ev.clientY - sy));
            if (locked) { const s = Math.max(w, h); w = s; h = s; }
            attrs = { ...attrs, width: Math.round(w), height: Math.round(h) };
            renderSVG();
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            commitAttrs();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    // ── Resize (touch) ──
    resHandle.addEventListener('touchstart', (e) => {
        if (!editor.isEditable) return;
        e.preventDefault(); e.stopPropagation();
        const t0 = e.touches[0];
        const sx = t0.clientX, sy = t0.clientY;
        const sw = attrs.width, sh = attrs.height;
        const locked = attrs.shapeType === 'circle' || attrs.shapeType === 'square';
        const onMove = (ev) => {
            const t = ev.touches[0];
            let w = Math.max(20, sw + (t.clientX - sx));
            let h = Math.max(20, sh + (t.clientY - sy));
            if (locked) { const s = Math.max(w, h); w = s; h = s; }
            attrs = { ...attrs, width: Math.round(w), height: Math.round(h) };
            renderSVG();
        };
        const onEnd = () => {
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onEnd);
            commitAttrs();
        };
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onEnd);
    }, { passive: false });

    // ── Rotate (mouse) ──
    rotHandle.addEventListener('mousedown', (e) => {
        if (!editor.isEditable) return;
        e.preventDefault(); e.stopPropagation();
        const rect = svg.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top  + rect.height / 2;
        const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI;
        const startRot   = attrs.rotation || 0;
        const onMove = (ev) => {
            const angle = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI;
            attrs = { ...attrs, rotation: Math.round((startRot + angle - startAngle + 360) % 360) };
            renderSVG();
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            commitAttrs();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    // ── Rotate (touch) ──
    rotHandle.addEventListener('touchstart', (e) => {
        if (!editor.isEditable) return;
        e.preventDefault(); e.stopPropagation();
        const rect = svg.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top  + rect.height / 2;
        const t0 = e.touches[0];
        const startAngle = Math.atan2(t0.clientY - cy, t0.clientX - cx) * 180 / Math.PI;
        const startRot   = attrs.rotation || 0;
        const onMove = (ev) => {
            const t = ev.touches[0];
            const angle = Math.atan2(t.clientY - cy, t.clientX - cx) * 180 / Math.PI;
            attrs = { ...attrs, rotation: Math.round((startRot + angle - startAngle + 360) % 360) };
            renderSVG();
        };
        const onEnd = () => {
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onEnd);
            commitAttrs();
        };
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onEnd);
    }, { passive: false });

    renderSVG();
    applyEditableState();

    return {
        dom,
        contentDOM: null,
        update(updatedNode) {
            if (updatedNode.type.name !== 'shape') return false;
            attrs = { ...updatedNode.attrs, uid };
            renderSVG();
            applyEditableState();
            return true;
        },
        destroy() { /* DOM cleanup handled by ProseMirror */ },
        stopEvent(event) {
            // Let ProseMirror handle drag on the SVG body; capture only handle events.
            return event.target === resHandle || event.target === rotHandle;
        },
        ignoreMutation() { return true; },
    };
}

// ─── ShapeNode Tiptap extension ───────────────────────────────────────────────
const ShapeNode = Node.create({
    name: 'shape',
    group: 'inline',
    inline: true,
    atom: true,
    draggable: true,

    addAttributes() {
        return {
            shapeType:   { default: 'rectangle' },
            width:       { default: 120 },
            height:      { default: 80 },
            fill:        { default: 'transparent' },
            stroke:      { default: '#000000' },
            strokeWidth: { default: 2 },
            rotation:    { default: 0 },
        };
    },

    parseHTML() {
        return [{ tag: 'span[data-tp-shape]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return ['span', mergeAttributes(HTMLAttributes, { 'data-tp-shape': '' })];
    },

    addNodeView() {
        return ({ node, editor, getPos }) => buildShapeNodeView(node, editor, getPos);
    },
});

// ─── Shape picker panel ───────────────────────────────────────────────────────
function buildShapePicker(editor) {
    const wrapper = document.createElement('div');
    wrapper.className = 'tp-shape-picker-wrapper';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wp-btn';
    btn.title = 'Insert Shape';
    btn.innerHTML = '&#11041; Shapes &#9660;';
    wrapper.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'tp-shape-panel';
    wrapper.appendChild(panel);

    SHAPE_GROUPS.forEach(group => {
        const groupLabel = document.createElement('div');
        groupLabel.className = 'tp-shape-group-label';
        groupLabel.textContent = group.label;
        panel.appendChild(groupLabel);

        const row = document.createElement('div');
        row.className = 'tp-shape-row';

        group.shapes.forEach(shape => {
            const item = document.createElement('div');
            item.className = 'tp-shape-item';
            item.title = shape.label;

            // Mini SVG preview (unique uid per preview to avoid marker ID conflicts)
            const previewUID = `prev-${shape.type}-${++uidCounter}`;
            const previewSVG = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            previewSVG.setAttribute('width', '36');
            previewSVG.setAttribute('height', '28');
            previewSVG.setAttribute('viewBox', `0 0 ${shape.w} ${shape.h}`);
            previewSVG.style.display = 'block';
            previewSVG.innerHTML = buildSVGContent(shape.type, shape.w, shape.h, {
                fill: 'transparent', stroke: '#444', strokeWidth: 3, uid: previewUID,
            });
            item.appendChild(previewSVG);

            const label = document.createElement('span');
            label.textContent = shape.label;
            item.appendChild(label);

            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                panel.classList.remove('tp-open');
                editor.chain().focus().insertContent({
                    type: 'shape',
                    attrs: {
                        shapeType:   shape.type,
                        width:       shape.w,
                        height:      shape.h,
                        fill:        'transparent',
                        stroke:      '#000000',
                        strokeWidth: 2,
                        rotation:    0,
                    },
                }).run();
            });

            row.appendChild(item);
        });

        panel.appendChild(row);
    });

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.classList.toggle('tp-open');
    });

    // Close panel on outside click
    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) panel.classList.remove('tp-open');
    });

    return wrapper;
}

// ─── Toolbar builder ──────────────────────────────────────────────────────────
function buildToolbar(editor) {
    const toolbar = document.createElement('div');
    toolbar.className = 'wp-toolbar';

    function makeBtn(html, title, action) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'wp-btn';
        b.innerHTML = html;
        b.title = title;
        b.addEventListener('mousedown', (e) => { e.preventDefault(); action(b); });
        toolbar.appendChild(b);
        return b;
    }

    function sep() {
        const s = document.createElement('div');
        s.className = 'wp-toolbar-separator';
        toolbar.appendChild(s);
    }

    const boldBtn      = makeBtn('<b>B</b>',  'Bold (Ctrl+B)',      () => editor.chain().focus().toggleBold().run());
    const italicBtn    = makeBtn('<i>I</i>',  'Italic (Ctrl+I)',    () => editor.chain().focus().toggleItalic().run());
    const underlineBtn = makeBtn('<u>U</u>',  'Underline (Ctrl+U)', () => editor.chain().focus().toggleUnderline().run());
    sep();
    toolbar.appendChild(buildShapePicker(editor));
    sep();
    const undoBtn = makeBtn('&#8617;', 'Undo (Ctrl+Z)', () => editor.chain().focus().undo().run());
    const redoBtn = makeBtn('&#8618;', 'Redo (Ctrl+Y)', () => editor.chain().focus().redo().run());

    function updateState() {
        boldBtn.classList.toggle('wp-active',      editor.isActive('bold'));
        italicBtn.classList.toggle('wp-active',    editor.isActive('italic'));
        underlineBtn.classList.toggle('wp-active', editor.isActive('underline'));
        undoBtn.disabled = !editor.can().undo();
        redoBtn.disabled = !editor.can().redo();
    }

    editor.on('selectionUpdate', updateState);
    editor.on('transaction',     updateState);

    return toolbar;
}

// ─── create() — public factory ────────────────────────────────────────────────
function create(containerEl, instanceId, options = {}) {
    // Destroy any existing instance with the same ID
    if (instances[instanceId]) instances[instanceId].destroy();

    injectCSS();

    const wpContainer = document.createElement('div');
    wpContainer.className = 'wp-container';
    wpContainer.id = `wp-${instanceId}`;

    const editorWrapper = document.createElement('div');
    editorWrapper.className = 'wp-editor-wrapper';

    const editor = new Editor({
        element: editorWrapper,
        extensions: [
            StarterKit.configure({ history: true, heading: false }),
            Underline,
            ShapeNode,
        ],
        content: '<p></p>',
        autofocus: false,
        editable: true,
    });

    wpContainer.appendChild(buildToolbar(editor));
    wpContainer.appendChild(editorWrapper);

    containerEl.innerHTML = '';
    containerEl.appendChild(wpContainer);

    const instance = {
        getJSON() {
            return editor.getJSON();
        },
        getImage() {
            // DOM-based editor — no canvas snapshot needed.
            // takeExam.js checks canvasJSON first, so this null is safe.
            return null;
        },
        getPlainText() {
            return editor.getText();
        },
        loadJSON(json) {
            return new Promise((resolve) => {
                if (json && typeof json === 'object' && json.type === 'doc') {
                    editor.commands.setContent(json, false);
                }
                resolve();
            });
        },
        addTextbox(text) {
            if (text && text.trim()) {
                editor.commands.setContent(`<p>${text}</p>`, false);
            }
        },
        isEmpty() {
            return editor.isEmpty;
        },
        destroy() {
            editor.destroy();
            if (wpContainer.parentNode) wpContainer.parentNode.removeChild(wpContainer);
            delete instances[instanceId];
        },
    };

    instances[instanceId] = instance;
    return instance;
}

// ─── Public API ───────────────────────────────────────────────────────────────
function getInstance(instanceId) {
    return instances[instanceId] || null;
}

function destroyInstance(instanceId) {
    if (instances[instanceId]) instances[instanceId].destroy();
}

window.TiptapEditor = { create, getInstance, destroyInstance };
