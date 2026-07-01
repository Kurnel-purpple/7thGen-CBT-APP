import { isModuleEnabled } from '../../config/index.js';

function getSupportConfig() {
    const cfg = (typeof window !== 'undefined' && window.__appConfig) || {};
    const support = cfg.support || {};
    return {
        upgradeUrl: support.upgradeUrl || '',
        contactEmail: support.contactEmail || ''
    };
}

function makeStyleBlock() {
    // Scoped styles for the unavailable screen. Uses the app's design tokens
    // where available and falls back to safe literals.
    const el = document.createElement('style');
    el.textContent = `
        body {
            background: var(--bg, #F8F9FA);
            color: var(--text-primary, #202124);
            min-height: 100vh;
            margin: 0;
            font-family: var(--font-family, 'Nunito', sans-serif);
        }
        .mg-shell {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
        }
        .mg-card {
            width: 100%;
            max-width: 520px;
            background: var(--card-bg, #FFFFFF);
            border: 1px solid var(--border, #E0E0E0);
            border-radius: 20px;
            box-shadow: 0 12px 40px rgba(15, 23, 42, 0.08);
            padding: 36px 32px 28px;
            text-align: left;
        }
        [data-theme="dark"] .mg-card {
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
        }
        .mg-lock {
            width: 48px;
            height: 48px;
            border-radius: 14px;
            background: var(--primary-light, #E8F0FE);
            color: var(--primary, #1A73E8);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 18px;
        }
        .mg-eyebrow {
            display: block;
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            font-weight: 700;
            color: var(--text-secondary, #5F6368);
            margin-bottom: 6px;
        }
        .mg-title {
            font-family: var(--font-heading, 'DM Sans', sans-serif);
            font-size: 1.35rem;
            font-weight: 700;
            color: var(--text-primary, #202124);
            margin: 0 0 12px;
            line-height: 1.25;
        }
        .mg-body {
            color: var(--text-secondary, #5F6368);
            line-height: 1.6;
            margin: 0 0 22px;
            font-size: 0.95rem;
        }
        .mg-body a {
            color: var(--primary, #1A73E8);
            font-weight: 700;
            text-decoration: none;
        }
        .mg-body a:hover { text-decoration: underline; }
        .mg-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
        }
        .mg-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 10px 18px;
            border-radius: 999px;
            font-family: var(--font-family, 'Nunito', sans-serif);
            font-weight: 700;
            font-size: 0.88rem;
            border: 1.5px solid var(--border, #E0E0E0);
            background: var(--card-bg, #FFFFFF);
            color: var(--text-primary, #202124);
            text-decoration: none;
            cursor: pointer;
            transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
        }
        .mg-btn:hover {
            border-color: var(--primary, #1A73E8);
            color: var(--primary, #1A73E8);
        }
        .mg-btn.primary {
            background: var(--primary, #1A73E8);
            border-color: var(--primary, #1A73E8);
            color: #FFFFFF;
            box-shadow: 0 2px 8px rgba(26, 115, 232, 0.25);
        }
        .mg-btn.primary:hover {
            background: var(--primary-dark, #1557B0);
            border-color: var(--primary-dark, #1557B0);
            color: #FFFFFF;
        }
        .mg-btn.ghost {
            background: transparent;
            border-color: transparent;
            color: var(--text-secondary, #5F6368);
            padding: 10px 12px;
        }
        .mg-btn.ghost:hover {
            background: var(--inner-bg, #F1F3F4);
            color: var(--text-primary, #202124);
        }
    `;
    return el;
}

function iconLock() {
    return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>';
}

function iconExternal() {
    return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
}

function iconMail() {
    return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2z"/><polyline points="22 6 12 13 2 6"/></svg>';
}

function isPlaceholderUrl(url) {
    if (!url) return true;
    return /example\.com|placeholder|your-website/i.test(url);
}

function safeText(value) {
    const div = document.createElement('div');
    div.textContent = String(value == null ? '' : value);
    return div.innerHTML;
}

export function renderModuleUnavailable(moduleName = 'This module', options = {}) {
    const safeModuleName = String(moduleName || 'This module');
    const title = String(options.title || `${safeModuleName} isn't enabled on your plan`);
    const actionHref = options.actionHref ? String(options.actionHref) : null;
    const support = getSupportConfig();
    const hasUrl = !!support.upgradeUrl && !isPlaceholderUrl(support.upgradeUrl);
    const hasEmail = !!support.contactEmail;

    document.body.textContent = '';
    document.head.appendChild(makeStyleBlock());

    const shell = document.createElement('div');
    shell.className = 'mg-shell';

    const card = document.createElement('section');
    card.className = 'mg-card';
    card.setAttribute('role', 'alert');

    // Body copy — three variants depending on which support channels
    // the client config has filled in.
    let bodyLinks = '';
    if (hasUrl && hasEmail) {
        bodyLinks = `visit <a href="${safeText(support.upgradeUrl)}" target="_blank" rel="noopener">the main website</a> to add this feature to your application, or contact your developer at <a href="mailto:${safeText(support.contactEmail)}">${safeText(support.contactEmail)}</a>.`;
    } else if (hasUrl) {
        bodyLinks = `visit <a href="${safeText(support.upgradeUrl)}" target="_blank" rel="noopener">the main website</a> to add this feature to your application.`;
    } else if (hasEmail) {
        bodyLinks = `contact your developer at <a href="mailto:${safeText(support.contactEmail)}">${safeText(support.contactEmail)}</a>.`;
    } else {
        bodyLinks = `contact your developer to have it added to your plan.`;
    }

    const actionsHtml = [];
    if (hasUrl) {
        actionsHtml.push(`<a class="mg-btn primary" href="${safeText(support.upgradeUrl)}" target="_blank" rel="noopener">${iconExternal()}<span>Visit main website</span></a>`);
    }
    if (hasEmail) {
        const subject = encodeURIComponent(`Enable ${safeModuleName} for my school`);
        actionsHtml.push(`<a class="mg-btn${hasUrl ? '' : ' primary'}" href="mailto:${safeText(support.contactEmail)}?subject=${subject}">${iconMail()}<span>Email developer</span></a>`);
    }
    actionsHtml.push(`<button class="mg-btn ghost" type="button" id="mg-back-btn">Go back</button>`);

    card.innerHTML = `
        <div class="mg-lock" aria-hidden="true">${iconLock()}</div>
        <span class="mg-eyebrow">Feature Locked</span>
        <h1 class="mg-title">${safeText(title)}</h1>
        <p class="mg-body">To get access to this feature, ${bodyLinks}</p>
        <div class="mg-actions">${actionsHtml.join('')}</div>
    `;

    shell.appendChild(card);
    document.body.appendChild(shell);

    const backBtn = document.getElementById('mg-back-btn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            if (actionHref) {
                window.location.href = actionHref;
                return;
            }
            if (window.history.length > 1) {
                window.history.back();
                return;
            }
            window.location.href = '../index.html';
        });
    }
}

export function ensureModuleEnabled(moduleId, options = {}) {
    if (isModuleEnabled(moduleId)) {
        return true;
    }

    renderModuleUnavailable(options.moduleName || moduleId, options);
    return false;
}

export default {
    ensureModuleEnabled,
    renderModuleUnavailable
};
