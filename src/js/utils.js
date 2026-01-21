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
