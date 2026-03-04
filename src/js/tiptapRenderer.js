// src/js/tiptapRenderer.js
// Read-only renderer for Tiptap JSON in student exam view.
// Zero Tiptap dependency — walks JSON as plain data.
// Loaded as: <script type="module" src="../js/tiptapRenderer.js"></script>
// Exposes:   window.TiptapRenderer

let cssInjected = false;
let uidCounter  = 0;

// ─── CSS (injected once) ──────────────────────────────────────────────────────
function injectCSS() {
    if (cssInjected) return;
    cssInjected = true;
    const style = document.createElement('style');
    style.id = 'tiptap-renderer-styles';
    style.textContent = `
.tp-readonly-content{padding:12px 14px;font-size:15px;font-family:inherit;color:var(--text-color,#222);line-height:1.65;}
.tp-readonly-content p{margin:0 0 8px 0;}
.tp-readonly-content p:last-child{margin-bottom:0;}
.tp-shape-static{display:inline-block;vertical-align:middle;line-height:0;margin:2px 3px;}
@media(max-width:600px){.tp-readonly-content{font-size:14px;padding:8px 10px;}}
    `;
    document.head.appendChild(style);
}

// ─── SVG helpers (duplicated — renderer must be standalone, no imports) ───────
function regularPolygon(cx, cy, r, n, startAngle = -Math.PI / 2) {
    return Array.from({ length: n }, (_, i) => {
        const a = startAngle + (2 * Math.PI * i) / n;
        return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
    }).join(' ');
}

function starPolygon(cx, cy, outerR, innerR) {
    return Array.from({ length: 10 }, (_, i) => {
        const a  = -Math.PI / 2 + (Math.PI * i) / 5;
        const r2 = i % 2 === 0 ? outerR : innerR;
        return `${(cx + r2 * Math.cos(a)).toFixed(2)},${(cy + r2 * Math.sin(a)).toFixed(2)}`;
    }).join(' ');
}

function buildSVGContent(shapeType, w, h, attrs) {
    const sw   = attrs.strokeWidth || 2;
    const fill = attrs.fill   || 'transparent';
    const strk = attrs.stroke || '#000000';
    const uid  = ++uidCounter;
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
            const mid = `tpr-ar-${uid}`;
            const mw  = Math.max(6, sw * 4), mh = Math.max(5, sw * 3);
            return `<defs><marker id="${mid}" markerWidth="${mw}" markerHeight="${mh}" refX="${mw - 1}" refY="${mh / 2}" orient="auto"><polygon points="0 0, ${mw} ${mh / 2}, 0 ${mh}" fill="${strk}"/></marker></defs>` +
                `<line x1="${half}" y1="${cy}" x2="${w - sw * 5}" y2="${cy}" stroke="${strk}" stroke-width="${sw}" stroke-linecap="round" marker-end="url(#${mid})"/>`;
        }

        case 'arrow-both': {
            const midR = `tpr-abr-${uid}`, midL = `tpr-abl-${uid}`;
            const mw   = Math.max(6, sw * 4), mh = Math.max(5, sw * 3);
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

// ─── Tiptap JSON → HTML string ────────────────────────────────────────────────
function escapeHTML(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function nodeToHTML(node) {
    if (!node) return '';
    switch (node.type) {
        case 'doc':
            return (node.content || []).map(nodeToHTML).join('');

        case 'paragraph': {
            const inner = (node.content || []).map(nodeToHTML).join('');
            return `<p>${inner || '<br>'}</p>`;
        }

        case 'text': {
            let text = escapeHTML(node.text || '');
            for (const mark of (node.marks || [])) {
                if (mark.type === 'bold')      { text = `<strong>${text}</strong>`; continue; }
                if (mark.type === 'italic')    { text = `<em>${text}</em>`;         continue; }
                if (mark.type === 'underline') { text = `<u>${text}</u>`;           continue; }
                if (mark.type === 'textStyle' && mark.attrs) {
                    const style = [];
                    if (mark.attrs.fontSize) style.push(`font-size:${mark.attrs.fontSize}`);
                    if (mark.attrs.color)    style.push(`color:${mark.attrs.color}`);
                    if (style.length) text = `<span style="${style.join(';')}">${text}</span>`;
                }
            }
            return text;
        }

        case 'shape': {
            const a   = node.attrs || {};
            const w   = a.width    || 120;
            const h   = a.height   || 80;
            const rot = a.rotation || 0;
            const svgContent = buildSVGContent(a.shapeType || 'rectangle', w, h, a);
            return `<span class="tp-shape-static" style="width:${w}px;height:${h}px;transform:rotate(${rot}deg);">` +
                `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${svgContent}</svg></span>`;
        }

        default:
            // Pass-through for any unrecognised node types (hardBreak, etc.)
            return (node.content || []).map(nodeToHTML).join('');
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────
function renderJSON(mountEl, tiptapJSON) {
    injectCSS();

    // Detect old Fabric.js JSON (root object has an 'objects' array)
    if (tiptapJSON && Array.isArray(tiptapJSON.objects)) {
        mountEl.innerHTML =
            '<p style="padding:10px 14px;color:var(--light-text,#888);font-style:italic;">' +
            'Legacy question content — please re-save in the exam editor.</p>';
        return;
    }

    if (!tiptapJSON || tiptapJSON.type !== 'doc') {
        mountEl.innerHTML = '';
        return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'tp-readonly-content';
    wrapper.innerHTML = nodeToHTML(tiptapJSON);
    mountEl.innerHTML = '';
    mountEl.appendChild(wrapper);
}

window.TiptapRenderer = { renderJSON };
