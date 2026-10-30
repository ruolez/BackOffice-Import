// Authentication module

class AuthManager {
    constructor() {
        this.currentUser = null;
        this.isAuthenticated = false;
        this.init();
    }

    init() {
        // Check if user is already logged in
        this.checkAuthStatus();

        // Setup form listeners
        this.setupFormListeners();
    }

    async checkAuthStatus() {
        try {
            const response = await api.getCurrentUser();
            this.currentUser = response.user;
            this.isAuthenticated = true;
            this.showDashboard();
        } catch (error) {
            this.showAuthSection();
        }
    }

    setupFormListeners() {
        // Login form
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.handleLogin();
            });
        }

        // Register form
        const registerForm = document.getElementById('registerForm');
        if (registerForm) {
            registerForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.handleRegister();
            });
        }

        // Logout handler
        document.addEventListener('click', async (e) => {
            if (e.target.closest('#logoutBtn')) {
                e.preventDefault();
                await this.handleLogout();
            }
        });
    }

    async handleLogin() {
        const username = document.getElementById('loginUsername').value;
        const password = document.getElementById('loginPassword').value;

        if (!username || !password) {
            this.showAlert('Please enter both username and password', 'danger');
            return;
        }

        try {
            this.showLoading(true);
            const response = await api.login({ username, password });
            
            this.currentUser = response.user;
            this.isAuthenticated = true;
            
            this.showAlert('Login successful!', 'success');
            this.showDashboard();
            
        } catch (error) {
            this.showAlert(error.message, 'danger');
        } finally {
            this.showLoading(false);
        }
    }

    async handleRegister() {
        const username = document.getElementById('registerUsername').value;
        const email = document.getElementById('registerEmail').value;
        const password = document.getElementById('registerPassword').value;
        const confirmPassword = document.getElementById('registerConfirmPassword').value;

        // Validation
        if (!username || !email || !password || !confirmPassword) {
            this.showAlert('Please fill in all fields', 'danger');
            return;
        }

        if (password !== confirmPassword) {
            this.showAlert('Passwords do not match', 'danger');
            return;
        }

        if (password.length < 6) {
            this.showAlert('Password must be at least 6 characters long', 'danger');
            return;
        }

        try {
            this.showLoading(true);
            const response = await api.register({ username, email, password });
            
            this.showAlert('Registration successful! Please login.', 'success');
            
            // Switch to login tab
            const loginTab = document.getElementById('login-tab');
            if (loginTab) {
                loginTab.click();
            }
            
            // Clear form
            document.getElementById('registerForm').reset();
            
        } catch (error) {
            this.showAlert(error.message, 'danger');
        } finally {
            this.showLoading(false);
        }
    }

    async handleLogout() {
        try {
            this.showLoading(true);
            await api.logout();
            
            this.currentUser = null;
            this.isAuthenticated = false;
            
            this.showAlert('Logged out successfully', 'success');
            this.showAuthSection();
            
        } catch (error) {
            this.showAlert(error.message, 'danger');
        } finally {
            this.showLoading(false);
        }
    }

    showAuthSection() {
        const authSection = document.getElementById('auth-section');
        const dashboardSection = document.getElementById('dashboard-section');
        
        if (authSection) authSection.classList.remove('d-none');
        if (dashboardSection) dashboardSection.classList.add('d-none');
        
        this.updateNavbar();
    }

    showDashboard() {
        const authSection = document.getElementById('auth-section');
        const dashboardSection = document.getElementById('dashboard-section');
        
        if (authSection) authSection.classList.add('d-none');
        if (dashboardSection) dashboardSection.classList.remove('d-none');
        
        this.updateNavbar();
        
        // Initialize dashboard components
        if (window.databaseManager) {
            window.databaseManager.loadDatabaseConfigs();
        }
    }

    updateNavbar() {
        const navbarUser = document.getElementById('navbar-user');
        if (!navbarUser) return;

        if (this.isAuthenticated && this.currentUser) {
            const name = String(this.currentUser.username || '')
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            navbarUser.innerHTML = `
                <div class="dropup">
                    <button class="user-chip dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">
                        <span class="user-avatar">${name.charAt(0).toUpperCase()}</span>
                        <span class="user-name">${name}</span>
                    </button>
                    <ul class="dropdown-menu">
                        <li><a class="dropdown-item" href="#" id="logoutBtn">
                            <i class="fas fa-arrow-right-from-bracket me-2"></i>Sign out
                        </a></li>
                    </ul>
                </div>
            `;
        } else {
            navbarUser.innerHTML = '';
        }
    }

    showAlert(message, type = 'info') {
        const alertContainer = document.getElementById('alert-container');
        if (!alertContainer) return;

        const alertId = 'alert-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        const icons = {
            success: 'fa-circle-check',
            danger: 'fa-circle-exclamation',
            warning: 'fa-triangle-exclamation',
            info: 'fa-circle-info'
        };
        const alertHtml = `
            <div class="alert alert-${type} alert-dismissible fade show toast-alert" role="alert" id="${alertId}">
                <i class="fas ${icons[type] || icons.info} toast-icon"></i>
                <div class="toast-message">${message}</div>
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            </div>
        `;

        alertContainer.insertAdjacentHTML('beforeend', alertHtml);

        // Auto-dismiss after 5 seconds
        setTimeout(() => {
            const alert = document.getElementById(alertId);
            if (alert) {
                alert.remove();
            }
        }, 5000);
    }

    showLoading(show = true) {
        const spinner = document.getElementById('loading-spinner');
        if (spinner) {
            if (show) {
                spinner.classList.remove('d-none');
            } else {
                spinner.classList.add('d-none');
            }
        }
    }
}

// Global auth manager instance
const authManager = new AuthManager();