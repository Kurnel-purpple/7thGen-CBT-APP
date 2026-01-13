/**
 * Main App Controller
 */

document.addEventListener('DOMContentLoaded', () => {
    console.log('CBT App Initialized');

    // Check if user is already logged in and at the login page
    const user = dataService.getCurrentUser();
    const isLoginPage = document.getElementById('login-form');

    if (user && isLoginPage) {
        // Redirect to dashboard if already logged in
        if (user.role === 'teacher') {
            window.location.href = 'pages/teacher-dashboard.html';
        } else if (user.role === 'student') {
            window.location.href = 'pages/student-dashboard.html';
        }
    }
});
