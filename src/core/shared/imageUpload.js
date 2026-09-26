/**
 * Shared client-side image preparation for PocketBase `file` fields.
 *
 * WHY THIS EXISTS
 * Every image in this app before now went through FileReader.readAsDataURL and
 * was stored as a base64 string inside a text column — exam question images and
 * the report-card logo both still do. That is the single largest contributor to
 * the bandwidth incident: base64 inflates the payload ~33%, the bytes travel
 * inside every list response that touches the row, and nothing can be cached or
 * thumbnailed because it is not a file.
 *
 * The fees and feed modules upload real files instead (multipart FormData into a
 * PocketBase `file` field), so the server can serve them separately, cache them,
 * and generate thumbnails via `?thumb=WxH`. This module is the shared front door:
 * it decodes, downscales and re-encodes on the device so a 4MB phone photo leaves
 * as a ~250KB JPEG.
 *
 * Loaded as a CLASSIC script (like academicEntities.js), not an ES module, so it
 * can sit in a page's `globalScripts` list.
 */
(function (global) {
    'use strict';

    // Anything larger than this is refused before we even try to decode it —
    // a 40MB file is a mistake (or a video renamed .jpg), not a receipt.
    const HARD_LIMIT_BYTES = 25 * 1024 * 1024;

    const DEFAULTS = {
        maxDimension: 1600,   // longest edge, px — legible receipt text, small file
        quality: 0.82,        // starting JPEG quality
        minQuality: 0.5,      // don't degrade past this; accept the larger file
        targetBytes: 600 * 1024
    };

    const ACCEPTED = /^image\/(jpeg|jpg|png|webp|gif|bmp)$/i;

    function isImage(file) {
        if (!file) return false;
        if (file.type) return ACCEPTED.test(file.type);
        // Some Android content-provider picks arrive with an empty MIME type.
        return /\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name || '');
    }

    function formatBytes(bytes) {
        const n = Number(bytes) || 0;
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
        return (n / (1024 * 1024)).toFixed(1) + ' MB';
    }

    /**
     * Decode a File into something canvas can draw.
     * createImageBitmap is used where available because it decodes off the main
     * thread; the <img> path is the fallback for older WebViews.
     */
    function decode(file) {
        if (global.createImageBitmap) {
            return global.createImageBitmap(file).catch(() => decodeViaImg(file));
        }
        return decodeViaImg(file);
    }

    function decodeViaImg(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve(img);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                // HEIC/HEIF from an iPhone lands here on most Android/desktop
                // browsers — there is no decoder, so say so plainly.
                reject(new Error('That image format could not be read. Try a JPG or PNG.'));
            };
            img.src = url;
        });
    }

    function canvasToBlob(canvas, type, quality) {
        return new Promise((resolve, reject) => {
            if (canvas.toBlob) {
                canvas.toBlob(
                    (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image.'))),
                    type,
                    quality
                );
                return;
            }
            try {
                // toBlob is absent on a few old WebViews; dataURL is the only way out.
                const dataUrl = canvas.toDataURL(type, quality);
                const binary = atob(dataUrl.split(',')[1]);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                resolve(new Blob([bytes], { type }));
            } catch (err) {
                reject(new Error('Could not encode the image.'));
            }
        });
    }

    function renameToJpeg(name) {
        const base = String(name || 'image').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').slice(0, 40);
        return (base || 'image') + '.jpg';
    }

    const imageUpload = {
        HARD_LIMIT_BYTES,
        isImage,
        formatBytes,

        /**
         * Downscale + re-encode a single image File.
         *
         * Always returns a JPEG File, even when the source was a PNG: receipts and
         * feed photos are photographs, and a PNG screenshot of a bank app still
         * compresses far better as JPEG than it does as PNG.
         *
         * @returns {Promise<File>}
         */
        async prepare(file, options = {}) {
            const opts = Object.assign({}, DEFAULTS, options);

            if (!file) throw new Error('No file selected.');
            if (!isImage(file)) throw new Error('Only image files can be attached.');
            if (file.size > HARD_LIMIT_BYTES) {
                throw new Error('That image is ' + formatBytes(file.size) + '. Please pick one under ' + formatBytes(HARD_LIMIT_BYTES) + '.');
            }

            const source = await decode(file);
            const srcW = source.width || source.naturalWidth;
            const srcH = source.height || source.naturalHeight;
            if (!srcW || !srcH) throw new Error('That image could not be read.');

            const scale = Math.min(1, opts.maxDimension / Math.max(srcW, srcH));
            const width = Math.max(1, Math.round(srcW * scale));
            const height = Math.max(1, Math.round(srcH * scale));

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            // White matte: JPEG has no alpha, and without this a transparent PNG
            // re-encodes with a black background.
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(source, 0, 0, width, height);
            if (source.close) source.close();

            let quality = opts.quality;
            let blob = await canvasToBlob(canvas, 'image/jpeg', quality);
            // Step the quality down until the file is reasonable. Three extra
            // passes is plenty — past that the returns are not worth the CPU on
            // a low-end Android device.
            let passes = 0;
            while (blob.size > opts.targetBytes && quality > opts.minQuality && passes < 3) {
                quality = Math.max(opts.minQuality, quality - 0.12);
                blob = await canvasToBlob(canvas, 'image/jpeg', quality);
                passes++;
            }

            return new File([blob], renameToJpeg(file.name), {
                type: 'image/jpeg',
                lastModified: Date.now()
            });
        },

        /**
         * Prepare a list of files, enforcing a count cap.
         * Rejects the whole batch when the cap is exceeded rather than silently
         * dropping the tail — a user who picked six receipts should be told.
         *
         * @returns {Promise<File[]>}
         */
        async prepareMany(fileList, maxCount, options = {}) {
            const files = Array.from(fileList || []);
            if (!files.length) return [];
            if (maxCount && files.length > maxCount) {
                throw new Error('You can attach at most ' + maxCount + ' image' + (maxCount === 1 ? '' : 's') + '.');
            }
            const out = [];
            for (const file of files) {
                out.push(await this.prepare(file, options));
            }
            return out;
        },

        /**
         * Build the URL PocketBase serves a file record field from.
         * `thumb` (e.g. '400x0') asks the server for a resized copy — always use
         * one in list views so a queue of 40 receipts doesn't pull 40 full images.
         */
        fileUrl(pb, record, filename, { thumb = '' } = {}) {
            if (!pb || !record || !filename) return '';
            try {
                return pb.files.getUrl(record, filename, thumb ? { thumb } : {});
            } catch (err) {
                // pb.files landed in 0.18; getFileUrl is the older spelling.
                if (typeof pb.getFileUrl === 'function') {
                    return pb.getFileUrl(record, filename, thumb ? { thumb } : {});
                }
                return '';
            }
        }
    };

    global.imageUpload = imageUpload;
})(typeof globalThis !== 'undefined' ? globalThis : window);
