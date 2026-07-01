import { isModuleEnabled } from '../../config/index.js';

export function renderModuleUnavailable(moduleName = 'This module', options = {}) {
    const safeModuleName = String(moduleName || 'This module');
    const title = String(options.title || `${safeModuleName} is not enabled`);
    const message = String(options.message || 'This feature is not available for this school configuration right now.');
    const actionLabel = String(options.actionLabel || 'Go Back');
    const actionHref = options.actionHref ? String(options.actionHref) : null;

    document.body.textContent = '';

    const appContainer = document.createElement('div');
    appContainer.className = 'app-container no-sidebar';

    const main = document.createElement('main');
    main.className = 'main-content';
    main.style.display = 'flex';
    main.style.alignItems = 'center';
    main.style.justifyContent = 'center';
    main.style.minHeight = '100vh';
    main.style.padding = '24px';

    const section = document.createElement('section');
    section.style.maxWidth = '520px';
    section.style.width = '100%';
    section.style.background = 'var(--card-bg)';
    section.style.border = '1px solid var(--border-color)';
    section.style.borderRadius = '24px';
    section.style.boxShadow = 'var(--shadow-card, 0 12px 40px rgba(0,0,0,0.08))';
    section.style.padding = '32px';
    section.style.textAlign = 'center';

    const badge = document.createElement('div');
    badge.textContent = 'M';
    badge.style.width = '72px';
    badge.style.height = '72px';
    badge.style.margin = '0 auto 18px';
    badge.style.borderRadius = '20px';
    badge.style.background = 'var(--primary-light, rgba(74,144,226,0.12))';
    badge.style.color = 'var(--primary-color)';
    badge.style.display = 'flex';
    badge.style.alignItems = 'center';
    badge.style.justifyContent = 'center';
    badge.style.fontSize = '2rem';
    badge.style.fontWeight = '800';

    const heading = document.createElement('h1');
    heading.textContent = title;
    heading.style.margin = '0 0 12px';
    heading.style.fontSize = '1.5rem';
    heading.style.color = 'var(--text-color)';

    const paragraph = document.createElement('p');
    paragraph.textContent = message;
    paragraph.style.margin = '0 0 24px';
    paragraph.style.lineHeight = '1.6';
    paragraph.style.color = 'var(--light-text)';

    const actionBtn = document.createElement('button');
    actionBtn.id = 'module-unavailable-action';
    actionBtn.className = 'btn btn-primary';
    actionBtn.style.minWidth = '160px';
    actionBtn.textContent = actionLabel;

    section.appendChild(badge);
    section.appendChild(heading);
    section.appendChild(paragraph);
    section.appendChild(actionBtn);
    main.appendChild(section);
    appContainer.appendChild(main);
    document.body.appendChild(appContainer);

    if (actionBtn) {
        actionBtn.onclick = () => {
            if (actionHref) {
                window.location.href = actionHref;
                return;
            }
            if (window.history.length > 1) {
                window.history.back();
                return;
            }
            window.location.href = '../index.html';
        };
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
