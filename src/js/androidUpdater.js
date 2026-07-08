/**
 * Android In-App Update Checker
 *
 * The Android app is a Capacitor bundle — electron-updater (main.js) never runs
 * there, so without this the app has no way to know a new APK exists.
 *
 * On launch (Android native only) this checks the GitHub releases feed for a
 * newer version than the installed one (via the Capacitor App plugin) and shows
 * a dismissible banner with a direct APK download link. The APK is release-signed
 * with a stable key in CI, so Android installs it straight over the old version.
 */
(function () {
    'use strict';

    const REPO_API = 'https://api.github.com/repos/Kurnel-purpple/7thGen-CBT-APP/releases';
    const CHECK_THROTTLE_MS = 30 * 60 * 1000; // re-check at most every 30 min
    const LS_CACHED_RESULT = 'android_update_cached_result';
    const LS_DISMISSED_VERSION = 'android_update_dismissed_version';

    function isAndroidNative() {
        return typeof window !== 'undefined' &&
            window.Capacitor &&
            typeof window.Capacitor.isNativePlatform === 'function' &&
            window.Capacitor.isNativePlatform() &&
            window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'android';
    }

    function getReleaseFilter() {
        const cfgFilter = window.__appConfig && window.__appConfig.client && window.__appConfig.client.releaseFilter;
        if (cfgFilter) return cfgFilter;
        const meta = document.querySelector('meta[name="client-id"]');
        const clientId = meta ? meta.content : null;
        return (clientId && clientId !== 'default') ? clientId : null;
    }

    // "v1.9.1-seatos" -> "1.9.1"
    function versionFromTag(tag) {
        const m = /^v?(\d+\.\d+\.\d+)/.exec(tag || '');
        return m ? m[1] : null;
    }

    // returns true if a is newer than b
    function isNewer(a, b) {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < 3; i++) {
            if ((pa[i] || 0) > (pb[i] || 0)) return true;
            if ((pa[i] || 0) < (pb[i] || 0)) return false;
        }
        return false;
    }

    async function getInstalledVersion() {
        try {
            const App = window.Capacitor.Plugins && window.Capacitor.Plugins.App;
            if (!App || !App.getInfo) return null;
            const info = await App.getInfo();
            return versionFromTag(info.version) || info.version || null;
        } catch (e) {
            console.warn('[AndroidUpdater] Could not read installed version:', e);
            return null;
        }
    }

    async function fetchLatestRelease() {
        const filter = getReleaseFilter();
        let release = null;

        if (!filter) {
            const resp = await fetch(REPO_API + '/latest');
            if (!resp.ok) throw new Error('GitHub API error ' + resp.status);
            release = await resp.json();
        } else {
            const resp = await fetch(REPO_API + '?per_page=20');
            if (!resp.ok) throw new Error('GitHub API error ' + resp.status);
            const releases = await resp.json();
            release = releases.find(r => !r.draft && !r.prerelease && r.tag_name.includes(filter)) || null;
        }
        if (!release) return null;

        const version = versionFromTag(release.tag_name);
        if (!version) return null;

        const assets = release.assets || [];
        // prefer a release-signed apk over a -debug one
        const apk = assets.find(a => /\.apk$/i.test(a.name) && !/debug/i.test(a.name)) ||
            assets.find(a => /\.apk$/i.test(a.name));

        return {
            version: version,
            apkUrl: apk ? apk.browser_download_url : ('https://github.com/Kurnel-purpple/7thGen-CBT-APP/releases/tag/' + release.tag_name)
        };
    }

    async function getLatestReleaseThrottled(installedVersion) {
        // Cache is only valid for the app version that wrote it, so the first
        // launch after an update always does a fresh check.
        try {
            const cached = JSON.parse(localStorage.getItem(LS_CACHED_RESULT) || 'null');
            if (cached && cached.installed === installedVersion &&
                Date.now() - cached.at < CHECK_THROTTLE_MS) {
                return cached.latest;
            }
        } catch (e) { /* fall through to refetch */ }

        const latest = await fetchLatestRelease();
        localStorage.setItem(LS_CACHED_RESULT, JSON.stringify({
            at: Date.now(),
            installed: installedVersion,
            latest: latest
        }));
        return latest;
    }

    function showUpdateBanner(latest) {
        if (document.getElementById('android-update-banner')) return;

        const banner = document.createElement('div');
        banner.id = 'android-update-banner';
        banner.style.cssText = [
            'position:fixed', 'left:12px', 'right:12px', 'bottom:12px', 'z-index:99999',
            'display:flex', 'align-items:center', 'gap:12px',
            'padding:14px 16px', 'border-radius:16px',
            'background:var(--dm-surface-2, var(--primary, #1A73E8))',
            'color:#fff', 'box-shadow:0 6px 24px rgba(0,0,0,0.3)',
            'font-family:inherit', 'font-size:14px'
        ].join(';');

        const text = document.createElement('div');
        text.style.cssText = 'flex:1;min-width:0';
        text.innerHTML = '<strong>Update available (v' + latest.version + ')</strong><br>' +
            '<span style="opacity:0.85;font-size:13px">Download and install to get the latest features and fixes.</span>';

        const downloadBtn = document.createElement('a');
        downloadBtn.href = latest.apkUrl;
        downloadBtn.textContent = 'Download';
        downloadBtn.style.cssText = [
            'background:#fff', 'color:var(--primary, #1A73E8)', 'font-weight:700',
            'padding:10px 18px', 'border-radius:50px', 'text-decoration:none',
            'white-space:nowrap', 'flex-shrink:0'
        ].join(';');

        const closeBtn = document.createElement('button');
        closeBtn.setAttribute('aria-label', 'Dismiss update notice');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = [
            'background:none', 'border:none', 'color:#fff', 'font-size:22px',
            'line-height:1', 'padding:4px 6px', 'cursor:pointer', 'flex-shrink:0', 'opacity:0.8'
        ].join(';');
        closeBtn.onclick = function () {
            localStorage.setItem(LS_DISMISSED_VERSION, latest.version);
            banner.remove();
        };

        banner.appendChild(text);
        banner.appendChild(downloadBtn);
        banner.appendChild(closeBtn);
        document.body.appendChild(banner);
    }

    async function checkForUpdate() {
        try {
            if (!isAndroidNative()) return;

            const installed = await getInstalledVersion();
            if (!installed) return;

            const latest = await getLatestReleaseThrottled(installed);
            if (!latest || !latest.version) return;

            if (!isNewer(latest.version, installed)) return;

            // don't nag about a version the user already dismissed
            if (localStorage.getItem(LS_DISMISSED_VERSION) === latest.version) return;

            console.log('[AndroidUpdater] Update available:', installed, '->', latest.version);
            showUpdateBanner(latest);
        } catch (e) {
            console.warn('[AndroidUpdater] Update check failed:', e);
        }
    }

    // Give the page (and config bootstrap) a moment before checking
    if (document.readyState === 'complete') {
        setTimeout(checkForUpdate, 3000);
    } else {
        window.addEventListener('load', function () {
            setTimeout(checkForUpdate, 3000);
        });
    }
})();
