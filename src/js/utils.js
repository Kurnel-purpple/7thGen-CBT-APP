/**
 * Utility functions for CBT Exam App
 */

const Utils = {
    /**
     * Generate a unique ID
     * @returns {string} Unique ID
     */
    generateId: () => {
        return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
    },

    /**
     * Format date
     * @param {Date|string} date 
     * @returns {string} Formatted date string
     */
    formatDate: (date) => {
        return new Date(date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    /**
     * Deep clone an object
     * @param {Object} obj 
     * @returns {Object} Cloned object
     */
    deepClone: (obj) => {
        return JSON.parse(JSON.stringify(obj));
    },

    /**
     * Shuffle array (Fisher-Yates) for randomizing questions/answers
     * @param {Array} array 
     * @returns {Array} Shuffled array
     */
    shuffleArray: (array) => {
        const newArray = [...array];
        for (let i = newArray.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
        }
        return newArray;
    },

    /**
     * Initialize Theme (Dark/Light)
     */
    initTheme: () => {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);

        // Inject Toggle Button into Header
        const header = document.querySelector('.main-header');
        if (header) {
            const toggleBtn = document.createElement('button');
            toggleBtn.id = 'theme-toggle';
            toggleBtn.className = 'btn';
            toggleBtn.style.cssText = 'background: transparent; color: var(--text-color); margin-left: auto; font-size: 1.2rem; padding: 5px;';
            toggleBtn.title = 'Toggle Dark Mode';
            toggleBtn.innerHTML = savedTheme === 'dark' ? '☀️' : '🌙';

            toggleBtn.onclick = () => {
                const current = document.documentElement.getAttribute('data-theme');
                const next = current === 'dark' ? 'light' : 'dark';
                document.documentElement.setAttribute('data-theme', next);
                localStorage.setItem('theme', next);
                toggleBtn.innerHTML = next === 'dark' ? '☀️' : '🌙';
            };

            // Ensure it's the last item (right side)
            // If .user-menu exists (dashboard), append to it or after it?
            // The prompt asks for "right-side of the header". 
            // In dashboard pages, .user-menu is usually last. 
            // In auth pages (index/register), there might be just text or no user menu.
            // Appending to header will put it at the end if flex direction is row.

            // Check if user-menu exists, maybe put it inside there for alignment?
            // Or just append to header. CSS for header is flex + space-between usually. 
            // If we want it definitely on the right, appending to header is correct. 
            // BUT if there is already a "right" element (like user-menu), we might want to put it next to it.

            const userMenu = header.querySelector('.user-menu');
            const mobileUserRow = header.querySelector('.mobile-user-row');

            if (mobileUserRow) {
                // For pages with mobile-user-row (like create-exam), append to mobile row
                mobileUserRow.appendChild(toggleBtn);
                toggleBtn.style.marginLeft = '0';
            } else if (userMenu) {
                // Insert before the logout button in user menu? Or just prepend/append to user menu? 
                // Let's prepend to user menu so it's [Theme] [Name] [Logout]
                userMenu.insertBefore(toggleBtn, userMenu.firstChild);
                toggleBtn.style.marginRight = '10px';
                toggleBtn.style.marginLeft = '0';
            } else {
                header.appendChild(toggleBtn);
            }
        }
    },

    /**
     * Make logo clickable - navigates to appropriate dashboard based on user role
     */
    makeLogoClickable: () => {
        const logo = document.querySelector('.logo');
        if (!logo) return;

        // Get current user from localStorage
        const user = dataService?.getCurrentUser();
        if (!user) return;

        // Determine dashboard URL based on user role
        const dashboardUrl = user.role === 'teacher'
            ? 'teacher-dashboard.html'
            : 'student-dashboard.html';

        // Make logo clickable
        logo.style.cursor = 'pointer';
        logo.style.transition = 'opacity 0.2s ease';

        // Add hover effect
        logo.addEventListener('mouseenter', () => {
            logo.style.opacity = '0.8';
        });

        logo.addEventListener('mouseleave', () => {
            logo.style.opacity = '1';
        });

        // Add click handler
        logo.addEventListener('click', () => {
            // Check if we're in a pages subdirectory
            const isInPagesDir = window.location.pathname.includes('/pages/');
            const targetUrl = isInPagesDir ? dashboardUrl : `pages/${dashboardUrl}`;
            window.location.href = targetUrl;
        });

        // Add title attribute for accessibility
        logo.setAttribute('title', `Go to ${user.role === 'teacher' ? 'Teacher' : 'Student'} Dashboard`);
    },

    /**
     * Show a custom alert modal
     * @param {string} title 
     * @param {string} message 
     * @returns {Promise}
     */
    showAlert: (title, message) => {
        Utils._ensureModalHtml();
        return new Promise((resolve) => {
            const modal = document.getElementById('utils-alert-modal');
            document.getElementById('utils-alert-title').innerHTML = title || 'Notice';
            document.getElementById('utils-alert-message').innerHTML = message;

            const okBtn = document.getElementById('utils-alert-ok-btn');
            okBtn.onclick = () => {
                modal.style.display = 'none';
                resolve();
            };
            modal.style.display = 'flex';
        });
    },

    /**
     * Show a custom confirm modal
     * @param {string} title 
     * @param {string} message 
     * @returns {Promise<boolean>}
     */
    showConfirm: (title, message) => {
        Utils._ensureModalHtml();
        return new Promise((resolve) => {
            const modal = document.getElementById('utils-confirm-modal');
            document.getElementById('utils-confirm-title').innerHTML = title || 'Confirm';
            document.getElementById('utils-confirm-message').innerHTML = message;

            const yesBtn = document.getElementById('utils-confirm-yes-btn');
            const noBtn = document.getElementById('utils-confirm-no-btn');

            yesBtn.onclick = () => {
                modal.style.display = 'none';
                resolve(true);
            };
            noBtn.onclick = () => {
                modal.style.display = 'none';
                resolve(false);
            };
            modal.style.display = 'flex';
        });
    },

    /**
     * Show a toast notification
     * @param {string} message 
     * @param {string} type - 'info', 'success', 'warning', 'error'
     */
    showToast: (message, type = 'info') => {
        const toast = document.createElement('div');
        toast.className = `utils-toast utils-toast-${type}`;

        const icons = {
            info: 'ℹ️',
            success: '✅',
            warning: '⚠️',
            error: '❌'
        };

        const colors = {
            info: 'var(--primary-color, #4a90c8)',
            success: '#27ae60',
            warning: '#f39c12',
            error: '#e74c3c'
        };

        toast.style.cssText = `
            position: fixed;
            bottom: 30px;
            left: 30px;
            background: white;
            color: #333;
            padding: 15px 25px;
            border-radius: 12px;
            z-index: 10000;
            font-weight: 600;
            box-shadow: 0 10px 30px rgba(0,0,0,0.15);
            display: flex;
            align-items: center;
            gap: 12px;
            min-width: 280px;
            border-left: 6px solid ${colors[type]};
            transform: translateX(-120%);
            transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s;
        `;

        toast.innerHTML = `
            <span style="font-size: 1.2rem;">${icons[type]}</span>
            <span style="flex: 1;">${message}</span>
        `;

        document.body.appendChild(toast);

        // Force reflow
        toast.offsetHeight;

        // Slide in
        toast.style.transform = 'translateX(0)';

        setTimeout(() => {
            toast.style.transform = 'translateX(-120%)';
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 400);
        }, 4000);
    },

    /**
     * Internal: Ensure modal HTML exists in document
     * @private
     */
    _ensureModalHtml: () => {
        if (document.getElementById('utils-alert-modal')) return;

        const modalHtml = `
            <div id="utils-alert-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10001; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
                <div style="background: white; width: 90%; max-width: 400px; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.3); animation: utils-pop 0.3s ease-out;">
                    <div style="background: var(--primary-color, #4a90c8); color: white; padding: 20px; text-align: center;">
                        <h3 id="utils-alert-title" style="margin: 0; font-size: 1.2rem;">Notice</h3>
                    </div>
                    <div style="padding: 30px 24px; text-align: center; color: #333;">
                        <p id="utils-alert-message" style="margin: 0; line-height: 1.6; font-size: 1rem;"></p>
                    </div>
                    <div style="padding: 15px 24px 24px; display: flex; justify-content: center;">
                        <button id="utils-alert-ok-btn" style="background: var(--primary-color, #4a90c8); color: white; border: none; padding: 12px 40px; border-radius: 10px; font-weight: 600; cursor: pointer; transition: transform 0.2s;">OK</button>
                    </div>
                </div>
            </div>

            <div id="utils-confirm-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10001; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
                <div style="background: white; width: 90%; max-width: 400px; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.3); animation: utils-pop 0.3s ease-out;">
                    <div style="background: #e67e22; color: white; padding: 20px; text-align: center;">
                        <h3 id="utils-confirm-title" style="margin: 0; font-size: 1.2rem;">Confirm Action</h3>
                    </div>
                    <div style="padding: 30px 24px; text-align: center; color: #333;">
                        <p id="utils-confirm-message" style="margin: 0; line-height: 1.6; font-size: 1rem;"></p>
                    </div>
                    <div style="padding: 15px 24px 24px; display: flex; justify-content: center; gap: 12px;">
                        <button id="utils-confirm-no-btn" style="background: #95a5a6; color: white; border: none; padding: 12px 30px; border-radius: 10px; font-weight: 600; cursor: pointer; flex: 1;">Cancel</button>
                        <button id="utils-confirm-yes-btn" style="background: #e67e22; color: white; border: none; padding: 12px 30px; border-radius: 10px; font-weight: 600; cursor: pointer; flex: 1;">Confirm</button>
                    </div>
                </div>
            </div>

            <style>
                @keyframes utils-pop {
                    0% { transform: scale(0.9); opacity: 0; }
                    100% { transform: scale(1); opacity: 1; }
                }
                [data-theme="dark"] #utils-alert-modal > div,
                [data-theme="dark"] #utils-confirm-modal > div {
                    background: #2c3e50 !important;
                }
                [data-theme="dark"] #utils-alert-message,
                [data-theme="dark"] #utils-confirm-message {
                    color: #ecf0f1 !important;
                }
            </style>
        `;

        const div = document.createElement('div');
        div.innerHTML = modalHtml;
        document.body.appendChild(div);

        // Add hover effects
        const buttons = div.querySelectorAll('button');
        buttons.forEach(btn => {
            btn.onmouseenter = () => btn.style.opacity = '0.9';
            btn.onmouseleave = () => btn.style.opacity = '1';
        });
    }
};

// If using in Electron/Node environment as well as browser
// Export for Node/Electron
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Utils;
}

// Always attach to window if we are in a browser-like environment (including Electron renderer)
window.Utils = Utils;
window.Utils = Utils;
document.addEventListener('DOMContentLoaded', () => {
    Utils.initTheme();
    // Wait a bit for dataService to be available
    setTimeout(() => {
        Utils.makeLogoClickable();
    }, 100);
});

// Register Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        // Adjust path based on current location
        const swPath = window.location.pathname.includes('/pages/') ? '../sw.js' : 'sw.js';
        navigator.serviceWorker.register(swPath)
            .then(reg => console.log('[SW] Registered at scope:', reg.scope))
            .catch(err => console.log('[SW] Registration failed:', err));
    });
}
