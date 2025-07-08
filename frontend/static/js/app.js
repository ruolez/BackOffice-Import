// Main application initialization

class App {
    constructor() {
        this.init();
    }

    init() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.initialize();
            });
        } else {
            this.initialize();
        }
    }

    initialize() {
        console.log('BackOffice Invoice System starting...');
        
        // Initialize components
        this.initializeComponents();
        
        // Setup global event listeners
        this.setupGlobalEventListeners();
        
        // Initial health check
        this.performHealthCheck();
        
        console.log('BackOffice Invoice System initialized successfully');
    }

    initializeComponents() {
        // Components are already initialized as global instances
        // authManager, databaseManager, invoiceManager
        
        // Make them available globally for debugging
        window.authManager = authManager;
        window.databaseManager = databaseManager;
        window.invoiceManager = invoiceManager;
    }

    setupGlobalEventListeners() {
        // Global error handler
        window.addEventListener('error', (e) => {
            console.error('Global error:', e.error);
            authManager.showAlert('An unexpected error occurred. Please try again.', 'danger');
        });

        // Global unhandled promise rejection handler
        window.addEventListener('unhandledrejection', (e) => {
            console.error('Unhandled promise rejection:', e.reason);
            authManager.showAlert('An unexpected error occurred. Please try again.', 'danger');
        });

        // Online/offline handlers
        window.addEventListener('online', () => {
            authManager.showAlert('Connection restored', 'success');
        });

        window.addEventListener('offline', () => {
            authManager.showAlert('Connection lost. Please check your internet connection.', 'warning');
        });

        // Tab visibility change handler
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && authManager.isAuthenticated) {
                // Re-check auth status when tab becomes visible
                this.checkAuthStatus();
            }
        });
    }

    async performHealthCheck() {
        try {
            const response = await api.healthCheck();
            console.log('Health check passed:', response);
        } catch (error) {
            console.error('Health check failed:', error);
            authManager.showAlert('Unable to connect to server. Please check your connection.', 'danger');
        }
    }

    async checkAuthStatus() {
        try {
            await authManager.checkAuthStatus();
        } catch (error) {
            console.error('Auth status check failed:', error);
        }
    }
}

// Utility functions
const utils = {
    // Format currency
    formatCurrency(amount, currency = 'USD') {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency
        }).format(amount);
    },

    // Format date
    formatDate(date, options = {}) {
        const defaultOptions = {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        };
        return new Date(date).toLocaleDateString('en-US', { ...defaultOptions, ...options });
    },

    // Format datetime
    formatDateTime(date, options = {}) {
        const defaultOptions = {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        };
        return new Date(date).toLocaleDateString('en-US', { ...defaultOptions, ...options });
    },

    // Debounce function
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    // Throttle function
    throttle(func, limit) {
        let inThrottle;
        return function() {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    },

    // Validate email
    validateEmail(email) {
        const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return regex.test(email);
    },

    // Generate UUID
    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    },

    // Copy text to clipboard
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (err) {
            console.error('Failed to copy text: ', err);
            return false;
        }
    },

    // Download data as file
    downloadAsFile(data, filename, type = 'application/json') {
        const blob = new Blob([data], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    // Escape HTML
    escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    },

    // Parse query string
    parseQueryString(queryString) {
        const params = {};
        const queries = (queryString || window.location.search).substring(1).split('&');
        
        queries.forEach(query => {
            const [key, value] = query.split('=');
            if (key) {
                params[decodeURIComponent(key)] = decodeURIComponent(value || '');
            }
        });
        
        return params;
    }
};

// Make utils available globally
window.utils = utils;

// Initialize the application
const app = new App();