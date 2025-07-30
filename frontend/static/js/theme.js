// Theme Management for BackOffice Invoice System
class ThemeManager {
    constructor() {
        this.currentTheme = this.getStoredTheme();
        this.init();
    }

    init() {
        // Apply stored theme on page load
        this.applyTheme(this.currentTheme);
        
        // Set up theme toggle button
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => this.toggleTheme());
        }

        // Listen for system theme changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (this.currentTheme === 'auto') {
                this.applyTheme('auto');
            }
        });
    }

    getStoredTheme() {
        return localStorage.getItem('theme') || 'light';
    }

    setStoredTheme(theme) {
        localStorage.setItem('theme', theme);
    }

    applyTheme(theme) {
        const root = document.documentElement;
        
        if (theme === 'dark') {
            root.setAttribute('data-theme', 'dark');
        } else if (theme === 'light') {
            root.setAttribute('data-theme', 'light');
        } else if (theme === 'auto') {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
        }

        this.currentTheme = theme;
        this.setStoredTheme(theme);
        this.updateThemeToggle();
    }

    toggleTheme() {
        const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
        this.applyTheme(newTheme);
        
        // Add a subtle animation effect
        this.animateThemeChange();
    }

    updateThemeToggle() {
        const themeToggle = document.getElementById('themeToggle');
        if (!themeToggle) return;

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        themeToggle.setAttribute('aria-label', `Switch to ${isDark ? 'light' : 'dark'} theme`);
    }

    animateThemeChange() {
        // Add a ripple effect when changing themes
        const body = document.body;
        body.style.transition = 'background-color 0.3s ease, color 0.3s ease';
        
        setTimeout(() => {
            body.style.transition = '';
        }, 300);

        // Animate cards with stagger effect
        const cards = document.querySelectorAll('.card, .magic-card');
        cards.forEach((card, index) => {
            card.style.animation = 'none';
            card.offsetHeight; // Trigger reflow
            card.style.animation = `fadeInUp 0.3s ease-out ${index * 0.05}s both`;
        });
    }

    // Method to manually set theme (useful for settings panel)
    setTheme(theme) {
        if (['light', 'dark', 'auto'].includes(theme)) {
            this.applyTheme(theme);
        }
    }

    // Get current theme for other components
    getCurrentTheme() {
        return this.currentTheme;
    }

    // Check if dark mode is currently active
    isDarkMode() {
        return document.documentElement.getAttribute('data-theme') === 'dark';
    }
}

// Enhanced Animation Utilities
class AnimationUtils {
    static addRippleEffect(element, event) {
        const ripple = document.createElement('span');
        const rect = element.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const x = event.clientX - rect.left - size / 2;
        const y = event.clientY - rect.top - size / 2;

        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = x + 'px';
        ripple.style.top = y + 'px';
        ripple.classList.add('ripple');

        element.appendChild(ripple);

        setTimeout(() => {
            ripple.remove();
        }, 600);
    }

    static animateIn(elements, delay = 100) {
        elements.forEach((element, index) => {
            element.style.opacity = '0';
            element.style.transform = 'translateY(20px)';
            
            setTimeout(() => {
                element.style.transition = 'all 0.5s ease';
                element.style.opacity = '1';
                element.style.transform = 'translateY(0)';
            }, index * delay);
        });
    }

    static addShimmerEffect(button) {
        if (!button.classList.contains('shimmer-button')) {
            button.classList.add('shimmer-button');
        }
    }

    static pulseElement(element, duration = 1000) {
        element.style.animation = `pulse-glow ${duration}ms ease-in-out`;
        setTimeout(() => {
            element.style.animation = '';
        }, duration);
    }
}

// Subtle Button Effects
class ButtonEffects {
    static init() {
        // Disabled ripple effects - too animated
        // Only subtle hover effects remain in CSS
    }
}

// Initialize everything when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Initialize theme manager
    window.themeManager = new ThemeManager();
    
    // Initialize button effects
    ButtonEffects.init();
    
    // Add animation classes to elements as they come into view
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-in');
            }
        });
    }, { threshold: 0.1 });

    // Observe elements for animation
    document.querySelectorAll('.card, .magic-card, .database-card').forEach(el => {
        observer.observe(el);
    });
});

// Export for use in other modules
window.ThemeManager = ThemeManager;
window.AnimationUtils = AnimationUtils;
window.ButtonEffects = ButtonEffects;