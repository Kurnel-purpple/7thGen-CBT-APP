/**
 * Authentication Controller
 */

const auth = {
    init: () => {
        const loginForm = document.getElementById('login-form');
        if (loginForm) {
            loginForm.addEventListener('submit', auth.handleLogin);
        }
    },

    handleLogin: async (e) => {
        e.preventDefault();

        const usernameInput = document.getElementById('username');
        const passwordInput = document.getElementById('password');
        const errorDiv = document.getElementById('login-error');
        const submitBtn = e.target.querySelector('button[type="submit"]');

        // Prevent double submission (e.g. from autofill + click)
        if (submitBtn.disabled) return;

        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();

        if (!username || !password) {
            auth.showError('Please enter both User ID/Username and password.');
            return;
        }

        // Check if dataService is ready
        if (!window.dataService) {
            auth.showError('Application is still loading. Please wait a moment and try again.');
            return;
        }

        // Loading state
        const originalBtnText = submitBtn.textContent;
        submitBtn.textContent = 'Signing in...';
        submitBtn.disabled = true;
        errorDiv.style.display = 'none';

        try {
            const user = await dataService.login(username, password);
            console.log('Login successful:', user);

            if (user.role === 'student') {
                window.location.href = 'pages/student-dashboard.html';
            } else if (user.role === 'teacher') {
                window.location.href = 'pages/teacher-dashboard.html';
            } else if (user.role === 'admin') {
                window.location.href = 'pages/admin-dashboard.html';
            } else {
                auth.showError('Unknown user role.');
                submitBtn.textContent = originalBtnText;
                submitBtn.disabled = false;
            }
        } catch (err) {
            console.error('Login error:', err);

            // Handle AbortError specifically (often caused by password managers or network cancellation)
            if (err.name === 'AbortError' || (err.message && err.message.includes('AbortError'))) {
                auth.showError('Login interrupted. Please tap Login again.');
            } else {
                auth.showError(err.message || 'Login failed. Please check your credentials.');
            }

            submitBtn.textContent = originalBtnText;
            submitBtn.disabled = false;
        }
    },

    showError: (msg) => {
        const errorDiv = document.getElementById('login-error');
        if (errorDiv) {
            errorDiv.textContent = msg;
            errorDiv.style.display = 'block';
        } else {
            alert(msg);
        }
    },

    logout: async () => {
        await dataService.logout();
        // Check if we are in a subdirectory (pages/) or root
        if (window.location.pathname.includes('/pages/')) {
            window.location.href = '../index.html';
        } else {
            window.location.href = 'index.html';
        }
    },

    togglePassword: (inputId, button) => {
        const passwordInput = document.getElementById(inputId);
        const eyeIcon = button.querySelector('.eye-icon');

        if (passwordInput.type === 'password') {
            passwordInput.type = 'text';
            eyeIcon.textContent = '👁️‍🗨️';
            button.setAttribute('aria-label', 'Hide password');
        } else {
            passwordInput.type = 'password';
            eyeIcon.textContent = '👁️';
            button.setAttribute('aria-label', 'Show password');
        }
    }
};

// Auto-init if in browser
if (typeof window !== 'undefined') {
    window.auth = auth;
    // Wait for DOM
    document.addEventListener('DOMContentLoaded', auth.init);
}
