/**
 * Fabric.js Word Processor Component (v7 compatible)
 * Self-contained canvas-based editor for creating question content.
 * All styles are scoped with .wp- prefix to avoid conflicts.
 */

const FabricWordProcessor = (() => {

    // Track all active instances
    const instances = {};

    // Inject scoped CSS once
    let cssInjected = false;
    function injectCSS() {
        if (cssInjected) return;
        cssInjected = true;
        const style = document.createElement('style');
        style.textContent = `
            /* === Fabric Word Processor Scoped Styles (.wp- prefix) === */
            .wp-container {
                border: 1px solid var(--border-color, #ccc);
                border-radius: 8px;
                overflow: hidden;
                background: var(--card-bg, #fff);
                margin-top: 8px;
            }
            .wp-toolbar {
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                padding: 8px 10px;
                background: var(--inner-bg, #f5f5f5);
                border-bottom: 1px solid var(--border-color, #ccc);
                align-items: center;
            }
            .wp-toolbar-separator {
                width: 1px;
                height: 24px;
                background: var(--border-color, #ccc);
                margin: 0 4px;
                flex-shrink: 0;
            }
            .wp-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 30px;
                height: 30px;
                padding: 0 6px;
                border: 1px solid transparent;
                border-radius: 4px;
                background: transparent;
                cursor: pointer;
                font-size: 13px;
                color: var(--text-color, #333);
                transition: all 0.15s ease;
                white-space: nowrap;
            }
            .wp-btn:hover {
                background: rgba(99, 102, 241, 0.1);
                border-color: var(--primary-color, #6366f1);
            }
            .wp-btn.wp-active {
                background: var(--primary-color, #6366f1);
                color: #fff;
                border-color: var(--primary-color, #6366f1);
            }
            .wp-select {
                height: 30px;
                padding: 0 6px;
                border: 1px solid var(--border-color, #ccc);
                border-radius: 4px;
                background: var(--card-bg, #fff);
                color: var(--text-color, #333);
                font-size: 12px;
                cursor: pointer;
            }
            .wp-canvas-wrapper {
                position: relative;
                background: #fff;
                cursor: text;
            }
            .wp-canvas-wrapper canvas {
                display: block !important;
            }
            .wp-hidden-input {
                display: none;
            }
            .wp-color-input {
                width: 30px;
                height: 30px;
                padding: 2px;
                border: 1px solid var(--border-color, #ccc);
                border-radius: 4px;
                cursor: pointer;
                background: transparent;
            }

            /* Dark mode canvas wrapper override */
            [data-theme="dark"] .wp-canvas-wrapper {
                background: #fff;
            }

            /* Responsive toolbar */
            @media (max-width: 600px) {
                .wp-toolbar {
                    gap: 2px;
                    padding: 6px 6px;
                }
                .wp-btn {
                    min-width: 26px;
                    height: 26px;
                    font-size: 11px;
                    padding: 0 4px;
                }
                .wp-select {
                    height: 26px;
                    font-size: 11px;
                }
                .wp-color-input {
                    width: 26px;
                    height: 26px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Helper: get pointer position from Fabric v7 mouse event
     */
    function getPointerFromEvent(canvas, opt) {
        if (opt.scenePoint) {
            return { x: opt.scenePoint.x, y: opt.scenePoint.y };
        }
        if (opt.viewportPoint) {
            return { x: opt.viewportPoint.x, y: opt.viewportPoint.y };
        }
        const e = opt.e;
        const rect = canvas.getElement().getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    /**
     * Create a new word processor instance
     * @param {HTMLElement} containerEl - DOM element to mount in
     * @param {string} instanceId - unique ID for this instance
     * @param {object} [options] - { width, height, autoText }
     *   height: canvas height in px (default 150)
     *   autoText: if true, create a default Textbox ready for typing
     * @returns {{ canvas, getImage, getJSON, loadJSON, destroy, getPlainText, isEmpty }}
     */
    function create(containerEl, instanceId, options = {}) {
        injectCSS();

        // Destroy previous instance if exists
        if (instances[instanceId]) {
            instances[instanceId].destroy();
        }

        const minHeight = options.height || 150;

        // Build HTML structure
        containerEl.innerHTML = '';

        // --- Container ---
        const wpContainer = document.createElement('div');
        wpContainer.className = 'wp-container';
        wpContainer.id = `wp-${instanceId}`;

        // --- Toolbar ---
        const toolbar = document.createElement('div');
        toolbar.className = 'wp-toolbar';
        toolbar.innerHTML = buildToolbarHTML(instanceId);
        wpContainer.appendChild(toolbar);

        // --- Canvas Wrapper ---
        const canvasWrapper = document.createElement('div');
        canvasWrapper.className = 'wp-canvas-wrapper';

        const canvasEl = document.createElement('canvas');
        canvasEl.id = `wp-canvas-${instanceId}`;
        canvasWrapper.appendChild(canvasEl);
        wpContainer.appendChild(canvasWrapper);

        // --- Hidden file input ---
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.className = 'wp-hidden-input';
        fileInput.id = `wp-file-${instanceId}`;
        wpContainer.appendChild(fileInput);

        containerEl.appendChild(wpContainer);

        // --- Initialize Fabric Canvas (v7) ---
        const computedWidth = wpContainer.clientWidth - 2;
        const canvasWidth = Math.max(computedWidth, 300);

        const canvas = new fabric.Canvas(canvasEl, {
            width: canvasWidth,
            height: minHeight,
            backgroundColor: '#ffffff',
            selection: true,
            preserveObjectStacking: true,
        });

        // Initialize freeDrawingBrush for v7
        canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
        canvas.freeDrawingBrush.width = 2;
        canvas.freeDrawingBrush.color = '#000000';

        // --- Undo/Redo State ---
        const undoStack = [];
        const redoStack = [];
        let ignoreStateChange = false;

        function saveState() {
            if (ignoreStateChange) return;
            undoStack.push(canvas.toJSON());
            if (undoStack.length > 50) undoStack.shift();
            redoStack.length = 0;
        }

        function undo() {
            if (undoStack.length === 0) return;
            redoStack.push(canvas.toJSON());
            const prevState = undoStack.pop();
            ignoreStateChange = true;
            canvas.loadFromJSON(prevState).then(() => {
                canvas.renderAll();
                ignoreStateChange = false;
            });
        }

        function redo() {
            if (redoStack.length === 0) return;
            undoStack.push(canvas.toJSON());
            const nextState = redoStack.pop();
            ignoreStateChange = true;
            canvas.loadFromJSON(nextState).then(() => {
                canvas.renderAll();
                ignoreStateChange = false;
            });
        }

        // Save state on object modifications
        canvas.on('object:added', saveState);
        canvas.on('object:modified', saveState);
        canvas.on('object:removed', saveState);

        // Save initial empty state
        saveState();

        // --- Boundary constraints: prevent objects from going outside canvas ---
        canvas.on('object:moving', (e) => {
            const obj = e.target;
            const bound = obj.getBoundingRect();
            const cw = canvas.width;
            const ch = canvas.height;

            if (bound.left < 0) {
                obj.set('left', obj.left - bound.left);
            }
            if (bound.top < 0) {
                obj.set('top', obj.top - bound.top);
            }
            if (bound.left + bound.width > cw) {
                obj.set('left', obj.left - (bound.left + bound.width - cw));
            }
            if (bound.top + bound.height > ch) {
                canvas.setDimensions({ height: bound.top + bound.height + 40 });
            }
        });

        canvas.on('object:scaling', (e) => {
            const obj = e.target;
            const bound = obj.getBoundingRect();
            const cw = canvas.width;
            if (bound.left + bound.width > cw) {
                const maxScale = (cw - bound.left) / (bound.width / obj.scaleX);
                obj.set('scaleX', maxScale);
            }
        });

        canvas.on('object:modified', (e) => {
            const obj = e.target;
            if (obj.type === 'textbox') {
                const bound = obj.getBoundingRect();
                const cw = canvas.width;
                if (bound.left + bound.width > cw) {
                    obj.set('width', cw - obj.left - 10);
                    canvas.renderAll();
                }
                if (bound.top + bound.height > canvas.height) {
                    canvas.setDimensions({ height: bound.top + bound.height + 40 });
                }
            }
        });

        // --- Auto-expand canvas when text changes ---
        canvas.on('text:changed', (e) => {
            const obj = e.target;
            if (obj && obj.type === 'textbox') {
                const bound = obj.getBoundingRect();
                if (bound.top + bound.height + 20 > canvas.height) {
                    canvas.setDimensions({ height: bound.top + bound.height + 40 });
                }
            }
        });

        // --- Drawing mode state ---
        let currentMode = 'select';
        let isDrawingShape = false;
        let shapeOrigin = null;
        let activeShape = null;
        let drawingType = null;

        // --- Toolbar Button Handlers ---
        function getCurrentColor() {
            const colorInput = toolbar.querySelector(`#wp-color-${instanceId}`);
            return colorInput ? colorInput.value : '#000000';
        }

        // Helper: add a Textbox to the canvas
        function addTextbox(content, enterEdit) {
            const textWidth = canvas.width - 20;
            const text = new fabric.Textbox(content || 'Type here...', {
                left: 10,
                top: 10 + (canvas.getObjects().length * 30) % 200,
                fontSize: parseInt(toolbar.querySelector(`#wp-fontsize-${instanceId}`).value) || 16,
                fontFamily: 'Arial, sans-serif',
                fill: getCurrentColor(),
                editable: true,
                width: textWidth > 100 ? textWidth : 280,
                originX: 'left',
                originY: 'top',
                splitByGrapheme: false,
            });
            canvas.add(text);
            canvas.setActiveObject(text);
            if (enterEdit) {
                text.enterEditing();
                text.selectAll();
            }
            canvas.renderAll();
            // Auto-expand canvas height if text is taller than canvas
            const textHeight = text.height || 50;
            if (text.top + textHeight + 20 > canvas.height) {
                canvas.setDimensions({ height: text.top + textHeight + 40 });
                canvas.renderAll();
            }
            return text;
        }

        function setMode(mode) {
            currentMode = mode;
            canvas.isDrawingMode = (mode === 'draw');
            canvas.selection = (mode === 'select');

            if (mode === 'draw') {
                if (!canvas.freeDrawingBrush) {
                    canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
                }
                canvas.freeDrawingBrush.width = 2;
                canvas.freeDrawingBrush.color = getCurrentColor();
            }

            // Update active button states
            toolbar.querySelectorAll('.wp-btn[data-mode]').forEach(btn => {
                btn.classList.toggle('wp-active', btn.dataset.mode === mode);
            });

            // Reset shape drawing
            isDrawingShape = false;
            drawingType = null;
        }

        // Click on canvas wrapper to add text if empty (text-first experience)
        canvasWrapper.addEventListener('dblclick', (e) => {
            // Only if canvas is empty and not clicking on an object
            if (canvas.getObjects().length === 0) {
                addTextbox('Type here...', true);
            }
        });

        // Select
        toolbar.querySelector(`#wp-select-${instanceId}`).addEventListener('click', () => setMode('select'));

        // Text
        toolbar.querySelector(`#wp-text-${instanceId}`).addEventListener('click', () => {
            setMode('select');
            addTextbox('Type here...', true);
        });

        // Shapes dropdown
        const shapeSelect = toolbar.querySelector(`#wp-shapes-${instanceId}`);
        shapeSelect.addEventListener('change', () => {
            const shape = shapeSelect.value;
            if (!shape) return;
            shapeSelect.value = ''; // Reset dropdown

            if (shape === 'draw') {
                setMode('draw');
                return;
            }

            setMode('shape');
            drawingType = shape;

            // Highlight the shape dropdown
            shapeSelect.style.borderColor = 'var(--primary-color, #6366f1)';
            shapeSelect.style.background = 'rgba(99, 102, 241, 0.1)';
        });

        // Image Upload
        toolbar.querySelector(`#wp-image-${instanceId}`).addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (evt) => {
                const imgEl = new Image();
                imgEl.onload = () => {
                    const fabricImg = new fabric.FabricImage(imgEl, {
                        left: 50,
                        top: 50,
                    });
                    const maxSize = canvasWidth * 0.6;
                    if (fabricImg.width > maxSize || fabricImg.height > maxSize) {
                        const scale = maxSize / Math.max(fabricImg.width, fabricImg.height);
                        fabricImg.scale(scale);
                    }
                    canvas.add(fabricImg);
                    canvas.setActiveObject(fabricImg);
                    canvas.renderAll();
                };
                imgEl.src = evt.target.result;
            };
            reader.readAsDataURL(file);
            fileInput.value = '';
        });

        // --- Helper: check if text object ---
        function isTextObject(obj) {
            return obj && (obj.type === 'i-text' || obj.type === 'textbox' || obj.type === 'text');
        }

        // Bold - applies to selected text only
        toolbar.querySelector(`#wp-bold-${instanceId}`).addEventListener('click', () => {
            const active = canvas.getActiveObject();
            if (!isTextObject(active)) return;
            if (active.isEditing && active.selectionStart !== active.selectionEnd) {
                const styles = active.getSelectionStyles(active.selectionStart, active.selectionEnd);
                const allBold = styles.every(s => s.fontWeight === 'bold');
                active.setSelectionStyles({ fontWeight: allBold ? 'normal' : 'bold' });
            } else {
                active.set('fontWeight', active.fontWeight === 'bold' ? 'normal' : 'bold');
            }
            canvas.renderAll();
            saveState();
        });

        // Italic
        toolbar.querySelector(`#wp-italic-${instanceId}`).addEventListener('click', () => {
            const active = canvas.getActiveObject();
            if (!isTextObject(active)) return;
            if (active.isEditing && active.selectionStart !== active.selectionEnd) {
                const styles = active.getSelectionStyles(active.selectionStart, active.selectionEnd);
                const allItalic = styles.every(s => s.fontStyle === 'italic');
                active.setSelectionStyles({ fontStyle: allItalic ? 'normal' : 'italic' });
            } else {
                active.set('fontStyle', active.fontStyle === 'italic' ? 'normal' : 'italic');
            }
            canvas.renderAll();
            saveState();
        });

        // Underline
        toolbar.querySelector(`#wp-underline-${instanceId}`).addEventListener('click', () => {
            const active = canvas.getActiveObject();
            if (!isTextObject(active)) return;
            if (active.isEditing && active.selectionStart !== active.selectionEnd) {
                const styles = active.getSelectionStyles(active.selectionStart, active.selectionEnd);
                const allUnderline = styles.every(s => s.underline === true);
                active.setSelectionStyles({ underline: !allUnderline });
            } else {
                active.set('underline', !active.underline);
            }
            canvas.renderAll();
            saveState();
        });

        // Font Size
        toolbar.querySelector(`#wp-fontsize-${instanceId}`).addEventListener('change', (e) => {
            const active = canvas.getActiveObject();
            if (!isTextObject(active)) return;
            const newSize = parseInt(e.target.value);
            if (active.isEditing && active.selectionStart !== active.selectionEnd) {
                active.setSelectionStyles({ fontSize: newSize });
            } else {
                active.set('fontSize', newSize);
            }
            canvas.renderAll();
            saveState();
        });

        // Color picker
        toolbar.querySelector(`#wp-color-${instanceId}`).addEventListener('input', (e) => {
            const color = e.target.value;
            const active = canvas.getActiveObject();
            if (!active) return;
            if (isTextObject(active)) {
                if (active.isEditing && active.selectionStart !== active.selectionEnd) {
                    active.setSelectionStyles({ fill: color });
                } else {
                    active.set('fill', color);
                }
            } else {
                active.set('stroke', color);
                if (active.fill && active.fill !== 'transparent') {
                    active.set('fill', color);
                }
            }
            canvas.renderAll();
            saveState();
            if (canvas.freeDrawingBrush) {
                canvas.freeDrawingBrush.color = color;
            }
        });

        // Undo
        toolbar.querySelector(`#wp-undo-${instanceId}`).addEventListener('click', undo);

        // Redo
        toolbar.querySelector(`#wp-redo-${instanceId}`).addEventListener('click', redo);

        // Delete Selected
        toolbar.querySelector(`#wp-delete-${instanceId}`).addEventListener('click', () => {
            const active = canvas.getActiveObjects();
            if (active && active.length > 0) {
                active.forEach(obj => canvas.remove(obj));
                canvas.discardActiveObject();
                canvas.renderAll();
            }
        });

        // Clear All
        toolbar.querySelector(`#wp-clear-${instanceId}`).addEventListener('click', () => {
            if (canvas.getObjects().length === 0) return;
            canvas.clear();
            canvas.backgroundColor = '#ffffff';
            canvas.renderAll();
        });

        // --- Shape drawing via mouse events (v7 compatible) ---
        canvas.on('mouse:down', (opt) => {
            if (currentMode !== 'shape' || !drawingType) return;
            isDrawingShape = true;
            const pointer = getPointerFromEvent(canvas, opt);
            shapeOrigin = { x: pointer.x, y: pointer.y };
            const color = getCurrentColor();

            if (drawingType === 'rect') {
                activeShape = new fabric.Rect({
                    left: pointer.x, top: pointer.y,
                    width: 0, height: 0,
                    fill: 'transparent', stroke: color, strokeWidth: 2, selectable: false,
                });
            } else if (drawingType === 'circle') {
                activeShape = new fabric.Ellipse({
                    left: pointer.x, top: pointer.y,
                    rx: 0, ry: 0,
                    fill: 'transparent', stroke: color, strokeWidth: 2, selectable: false,
                });
            } else if (drawingType === 'line' || drawingType === 'arrow') {
                activeShape = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
                    stroke: color, strokeWidth: 2, selectable: false,
                });
            } else if (drawingType === 'triangle') {
                activeShape = new fabric.Triangle({
                    left: pointer.x, top: pointer.y,
                    width: 0, height: 0,
                    fill: 'transparent', stroke: color, strokeWidth: 2, selectable: false,
                });
            } else if (drawingType === 'diamond') {
                // Diamond is a rotated rectangle
                activeShape = new fabric.Rect({
                    left: pointer.x, top: pointer.y,
                    width: 0, height: 0,
                    fill: 'transparent', stroke: color, strokeWidth: 2,
                    angle: 45, originX: 'center', originY: 'center', selectable: false,
                });
            } else if (drawingType === 'star') {
                // Create a tiny star placeholder; will be replaced on mouse up
                activeShape = new fabric.Polygon(createStarPoints(0, 0, 5, 0, 0), {
                    left: pointer.x, top: pointer.y,
                    fill: 'transparent', stroke: color, strokeWidth: 2, selectable: false,
                });
            } else if (drawingType === 'hexagon') {
                activeShape = new fabric.Polygon(createPolygonPoints(6, 0), {
                    left: pointer.x, top: pointer.y,
                    fill: 'transparent', stroke: color, strokeWidth: 2, selectable: false,
                });
            } else if (drawingType === 'pentagon') {
                activeShape = new fabric.Polygon(createPolygonPoints(5, 0), {
                    left: pointer.x, top: pointer.y,
                    fill: 'transparent', stroke: color, strokeWidth: 2, selectable: false,
                });
            }

            if (activeShape) {
                canvas.add(activeShape);
            }
        });

        canvas.on('mouse:move', (opt) => {
            if (!isDrawingShape || !activeShape) return;
            const pointer = getPointerFromEvent(canvas, opt);

            if (drawingType === 'rect' || drawingType === 'triangle') {
                const left = Math.min(shapeOrigin.x, pointer.x);
                const top = Math.min(shapeOrigin.y, pointer.y);
                activeShape.set({
                    left: left, top: top,
                    width: Math.abs(pointer.x - shapeOrigin.x),
                    height: Math.abs(pointer.y - shapeOrigin.y),
                });
            } else if (drawingType === 'circle') {
                const rx = Math.abs(pointer.x - shapeOrigin.x) / 2;
                const ry = Math.abs(pointer.y - shapeOrigin.y) / 2;
                activeShape.set({
                    left: Math.min(shapeOrigin.x, pointer.x),
                    top: Math.min(shapeOrigin.y, pointer.y),
                    rx: rx, ry: ry,
                });
            } else if (drawingType === 'line' || drawingType === 'arrow') {
                activeShape.set({ x2: pointer.x, y2: pointer.y });
            } else if (drawingType === 'diamond') {
                const size = Math.max(Math.abs(pointer.x - shapeOrigin.x), Math.abs(pointer.y - shapeOrigin.y));
                activeShape.set({
                    left: shapeOrigin.x, top: shapeOrigin.y,
                    width: size, height: size,
                });
            } else if (drawingType === 'star' || drawingType === 'hexagon' || drawingType === 'pentagon') {
                const radius = Math.max(
                    Math.abs(pointer.x - shapeOrigin.x),
                    Math.abs(pointer.y - shapeOrigin.y)
                );
                const sides = drawingType === 'hexagon' ? 6 : drawingType === 'pentagon' ? 5 : 5;
                const pts = drawingType === 'star'
                    ? createStarPoints(0, 0, 5, radius, radius * 0.4)
                    : createPolygonPoints(sides, radius);
                canvas.remove(activeShape);
                const color = getCurrentColor();
                activeShape = new fabric.Polygon(pts, {
                    left: shapeOrigin.x, top: shapeOrigin.y,
                    fill: 'transparent', stroke: color, strokeWidth: 2,
                    originX: 'center', originY: 'center', selectable: false,
                });
                canvas.add(activeShape);
            }
            canvas.renderAll();
        });

        canvas.on('mouse:up', (opt) => {
            if (!isDrawingShape || !activeShape) return;
            isDrawingShape = false;

            if (drawingType === 'arrow') {
                const x1 = activeShape.x1, y1 = activeShape.y1;
                const x2 = activeShape.x2, y2 = activeShape.y2;
                const angle = Math.atan2(y2 - y1, x2 - x1);
                const headLen = 15;
                const color = getCurrentColor();
                const arrowHead = new fabric.Triangle({
                    left: x2, top: y2,
                    width: headLen, height: headLen,
                    fill: color,
                    angle: (angle * 180 / Math.PI) + 90,
                    originX: 'center', originY: 'center', selectable: false,
                });
                canvas.add(arrowHead);
                const group = new fabric.Group([activeShape, arrowHead], { selectable: true });
                canvas.remove(activeShape);
                canvas.remove(arrowHead);
                canvas.add(group);
                canvas.setActiveObject(group);
            } else {
                activeShape.set({ selectable: true });
                canvas.setActiveObject(activeShape);
            }

            activeShape = null;
            canvas.renderAll();
            setMode('select');

            // Reset shape dropdown visual
            shapeSelect.style.borderColor = '';
            shapeSelect.style.background = '';
        });

        // Double-click for text editing
        canvas.on('mouse:dblclick', (opt) => {
            const target = opt.target;
            if (target && (target.type === 'i-text' || target.type === 'textbox')) {
                target.enterEditing();
                canvas.renderAll();
            }
        });

        // --- Resize handler ---
        let resizeTimeout;
        const resizeObserver = new ResizeObserver(() => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                const newWidth = wpContainer.clientWidth - 2;
                if (newWidth > 100 && Math.abs(newWidth - canvas.width) > 10) {
                    canvas.setDimensions({ width: newWidth });
                    // Constrain all Textbox objects to new width
                    canvas.getObjects().forEach(obj => {
                        if (obj.type === 'textbox') {
                            const maxW = newWidth - obj.left - 10;
                            if (obj.width > maxW && maxW > 50) {
                                obj.set('width', maxW);
                            }
                        }
                    });
                    canvas.renderAll();
                }
            }, 150);
        });
        resizeObserver.observe(wpContainer);

        // --- If autoText is requested, create a default Textbox ---
        if (options.autoText) {
            setTimeout(() => {
                addTextbox('', true);
            }, 100);
        }

        // --- Public API ---
        const instance = {
            canvas,

            getImage() {
                canvas.discardActiveObject();
                canvas.renderAll();
                return canvas.toDataURL({ format: 'png', quality: 1.0 });
            },

            getJSON() {
                canvas.discardActiveObject();
                canvas.renderAll();
                return canvas.toJSON();
            },

            getPlainText() {
                const textObjs = canvas.getObjects().filter(o =>
                    o.type === 'i-text' || o.type === 'textbox' || o.type === 'text'
                );
                textObjs.sort((a, b) => (a.top || 0) - (b.top || 0));
                return textObjs.map(t => t.text).join('\n').trim();
            },

            loadJSON(json) {
                return new Promise((resolve) => {
                    ignoreStateChange = true;
                    canvas.loadFromJSON(json).then(() => {
                        canvas.renderAll();
                        ignoreStateChange = false;
                        undoStack.length = 0;
                        redoStack.length = 0;
                        saveState();
                        // Auto-fit canvas height to content
                        const objects = canvas.getObjects();
                        if (objects.length > 0) {
                            let maxBottom = 0;
                            objects.forEach(o => {
                                const b = o.getBoundingRect();
                                if (b.top + b.height > maxBottom) maxBottom = b.top + b.height;
                            });
                            if (maxBottom + 20 > canvas.height) {
                                canvas.setDimensions({ height: maxBottom + 40 });
                            }
                        }
                        resolve();
                    }).catch(() => {
                        ignoreStateChange = false;
                        resolve();
                    });
                });
            },

            addTextbox: addTextbox,

            isEmpty() {
                return canvas.getObjects().length === 0;
            },

            destroy() {
                resizeObserver.disconnect();
                canvas.dispose();
                delete instances[instanceId];
            }
        };

        instances[instanceId] = instance;
        setMode('select');

        return instance;
    }

    // --- Helper: create regular polygon points ---
    function createPolygonPoints(sides, radius) {
        const pts = [];
        for (let i = 0; i < sides; i++) {
            const angle = (i * 2 * Math.PI / sides) - Math.PI / 2;
            pts.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
        }
        return pts;
    }

    // --- Helper: create star points ---
    function createStarPoints(cx, cy, numPoints, outerR, innerR) {
        const pts = [];
        for (let i = 0; i < numPoints * 2; i++) {
            const angle = (i * Math.PI / numPoints) - Math.PI / 2;
            const r = i % 2 === 0 ? outerR : innerR;
            pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
        }
        return pts;
    }

    function getInstance(instanceId) {
        return instances[instanceId] || null;
    }

    function destroyInstance(instanceId) {
        if (instances[instanceId]) {
            instances[instanceId].destroy();
        }
    }

    // --- Toolbar HTML builder ---
    function buildToolbarHTML(id) {
        return `
            <button type="button" class="wp-btn wp-active" id="wp-select-${id}" data-mode="select" title="Select / Move">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51z"/></svg>
            </button>
            <button type="button" class="wp-btn" id="wp-text-${id}" title="Add Text">
                <strong>T</strong>
            </button>
            <span class="wp-toolbar-separator"></span>
            <select class="wp-select" id="wp-shapes-${id}" title="Draw Shape">
                <option value="">⬡ Shapes</option>
                <option value="rect">▭ Rectangle</option>
                <option value="circle">◯ Circle / Ellipse</option>
                <option value="triangle">△ Triangle</option>
                <option value="line">╱ Line</option>
                <option value="arrow">→ Arrow</option>
                <option value="diamond">◇ Diamond</option>
                <option value="pentagon">⬠ Pentagon</option>
                <option value="hexagon">⬡ Hexagon</option>
                <option value="star">★ Star</option>
                <option value="draw">✏ Freehand</option>
            </select>
            <button type="button" class="wp-btn" id="wp-image-${id}" title="Upload Image">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            </button>
            <span class="wp-toolbar-separator"></span>
            <button type="button" class="wp-btn" id="wp-bold-${id}" title="Bold"><strong>B</strong></button>
            <button type="button" class="wp-btn" id="wp-italic-${id}" title="Italic"><em>I</em></button>
            <button type="button" class="wp-btn" id="wp-underline-${id}" title="Underline"><u>U</u></button>
            <select class="wp-select" id="wp-fontsize-${id}" title="Font Size">
                <option value="10">10</option>
                <option value="12">12</option>
                <option value="14">14</option>
                <option value="16" selected>16</option>
                <option value="18">18</option>
                <option value="20">20</option>
                <option value="24">24</option>
                <option value="28">28</option>
                <option value="32">32</option>
                <option value="36">36</option>
                <option value="48">48</option>
            </select>
            <input type="color" class="wp-color-input" id="wp-color-${id}" value="#000000" title="Color (Text / Shape / Brush)">
            <span class="wp-toolbar-separator"></span>
            <button type="button" class="wp-btn" id="wp-undo-${id}" title="Undo">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 105.33-12H1"/></svg>
            </button>
            <button type="button" class="wp-btn" id="wp-redo-${id}" title="Redo">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-5.33-12H23"/></svg>
            </button>
            <button type="button" class="wp-btn" id="wp-delete-${id}" title="Delete Selected" style="color: #e53e3e;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
            <button type="button" class="wp-btn" id="wp-clear-${id}" title="Clear All" style="color: #e53e3e;">
                ✕ All
            </button>
        `;
    }

    return { create, getInstance, destroyInstance };
})();
