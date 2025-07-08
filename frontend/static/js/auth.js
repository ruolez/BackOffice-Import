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
            if (e.target.id === 'logoutBtn') {
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
            navbarUser.innerHTML = `
                <div class="dropdown">
                    <a class="nav-link dropdown-toggle text-white" href="#" role="button" data-bs-toggle="dropdown">
                        <i class="fas fa-user me-2"></i>${this.currentUser.username}
                    </a>
                    <ul class="dropdown-menu">
                        <li><a class="dropdown-item" href="#" id="logoutBtn">
                            <i class="fas fa-sign-out-alt me-2"></i>Logout
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

        const alertId = 'alert-' + Date.now();
        const alertHtml = `
            <div class="alert alert-${type} alert-dismissible fade show" role="alert" id="${alertId}">
                ${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
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