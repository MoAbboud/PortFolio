// Spotlight Website JavaScript
//https://codepen.io/Dinkelborg/pen/dVRXxY
//https://codepen.io/sandstedt/pen/vKWzWE
//https://codepen.io/pehaa/pen/wvBLpNK

class SpotlightManager {
    constructor() {
        this.sites = [];
        this.maxSites = 10;
        this.currentSection = 'main';
        this.init();
    }

    init() {
        this.loadSites();
        this.setupEventListeners();
        this.setupNavigation();
        
        // Load main page by default after DOM is ready
        setTimeout(() => {
            this.showSection('main');
        }, 100);
    }

    // Setup navigation system
    setupNavigation() {
        const navLinks = document.querySelectorAll('nav a');
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const section = link.getAttribute('data-section');
                console.log('Clicking section:', section); // Debug log
                this.showSection(section);
            });
        });
    }

    // Show specific section with animation
    showSection(section) {
        console.log('Showing section:', section); // Debug log
        if (this.currentSection === section) return;
        
        this.currentSection = section;
        
        // Update body class for background transition
        const app = document.getElementById('app');
        if (app) {
            app.className = `bg ${section}`;
        }
        
        // Hide all page content first
        const pages = document.querySelectorAll('.page-content');
        pages.forEach(page => {
            page.classList.remove('active');
        });
        
        // Show target page immediately
        const targetPage = document.querySelector(`.${section}-page`);
        if (targetPage) {
            targetPage.classList.add('active');
            
            // Load appropriate page functionality
            if (section === 'main') {
                this.loadMainPage();
            } else if (section === 'manage') {
                this.loadManagePage();
            }
        } else {
            console.error('Target page not found:', `.${section}-page`);
        }
    }

    // Load sites from localStorage (simulating store.txt)
    loadSites() {
        const stored = localStorage.getItem('spotlight-sites');
        if (stored) {
            this.sites = JSON.parse(stored);
        } else {
            // Default sites if nothing is stored - using actually iframe-friendly sites
            this.sites = [
                'https://example.com',
                'https://httpbin.org/html',
                'https://placekitten.com/800/600',
                'https://via.placeholder.com/800x600/FF6B6B/FFFFFF?text=Sample+Design',
                'https://jsonplaceholder.typicode.com'
            ];
            this.saveSites();
        }
    }

    // Save sites to localStorage
    saveSites() {
        localStorage.setItem('spotlight-sites', JSON.stringify(this.sites));
    }

    // Setup event listeners
    setupEventListeners() {
        // Add site form
        const addForm = document.getElementById('add-form');
        if (addForm) {
            addForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.addSite();
            });
        }

        // File operations
        const downloadBtn = document.getElementById('download-btn');
        const uploadBtn = document.getElementById('upload-btn');
        const uploadInput = document.getElementById('upload-input');
        const clearAllBtn = document.getElementById('clear-all-btn');

        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => this.downloadStoreFile());
        }
        
        if (uploadBtn) {
            uploadBtn.addEventListener('click', () => uploadInput.click());
        }
        
        if (uploadInput) {
            uploadInput.addEventListener('change', (e) => this.uploadStoreFile(e));
        }
        
        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', () => this.clearAllSites());
        }

        // Notification close
        const notificationClose = document.querySelector('.notification-close');
        if (notificationClose) {
            notificationClose.addEventListener('click', () => this.hideNotification());
        }
    }

    // Load main page functionality
    loadMainPage() {
        console.log('Loading main page with sites:', this.sites); // Debug log
        this.displayIframes();
        this.generateColorGradients();
    }

    // Load manage page functionality
    loadManagePage() {
        console.log('Loading manage page...'); // Debug log
        this.displaySitesList();
    }

    // Display iframes on main page
    displayIframes() {
        const container = document.getElementById('iframes-container');
        const loading = document.getElementById('loading');
        
        if (!container) {
            console.error('iframes-container not found');
            return;
        }

        console.log('Displaying iframes...'); // Debug log

        // Show loading initially
        if (loading) {
            loading.classList.remove('hidden');
        }

        // Clear container
        container.innerHTML = '';

        // Check if we have sites
        if (this.sites.length === 0) {
            if (loading) loading.classList.add('hidden');
            container.innerHTML = '<p style="text-align: center; color: var(--egg-shell); font-size: 1.2rem; padding: 40px;">No sites to display. Go to Manage to add some sites!</p>';
            return;
        }

        // Limit to maxSites
        const sitesToShow = this.sites.slice(0, this.maxSites);

        sitesToShow.forEach((url, index) => {
            const iframeContainer = document.createElement('div');
            iframeContainer.className = 'iframe-container';
            
            iframeContainer.innerHTML = `
                <div class="iframe-header">
                    ${this.getDomainFromUrl(url)}
                    <a href="${url}" target="_blank" class="open-link">↗ Open</a>
                </div>
                <div class="iframe-wrapper">
                    <iframe class="iframe-content" 
                            src="${url}" 
                            loading="lazy"
                            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                            referrerpolicy="no-referrer-when-downgrade">
                    </iframe>
                    <div class="iframe-fallback" style="display: none;">
                        <div class="fallback-content">
                            <h3>🚫 Site blocks embedding</h3>
                            <p>This website uses security policies that prevent iframe display.</p>
                            <div class="fallback-preview" style="background: ${this.generateGradientForSite(url, index)}">
                                <span class="preview-text">${this.getDomainFromUrl(url)}</span>
                            </div>
                            <small style="color: var(--purple-brown); opacity: 0.7; margin-top: 10px; display: block;">
                                Click "↗ Open" above to visit directly
                            </small>
                        </div>
                    </div>
                </div>
            `;

            // Add error handling for iframe
            const iframe = iframeContainer.querySelector('iframe');
            const fallback = iframeContainer.querySelector('.iframe-fallback');
            let hasLoaded = false;
            
            // Set a shorter timeout for faster fallback
            let loadTimeout = setTimeout(() => {
                if (!hasLoaded) {
                    console.log('Iframe timeout for:', url);
                    iframe.style.display = 'none';
                    fallback.style.display = 'block';
                }
            }, 2000);

            // Handle successful load
            iframe.onload = () => {
                hasLoaded = true;
                clearTimeout(loadTimeout);
                console.log('Iframe loaded successfully:', url);
                
                // Quick check if iframe is accessible
                setTimeout(() => {
                    try {
                        const doc = iframe.contentDocument || iframe.contentWindow?.document;
                        if (!doc || doc.location.href === 'about:blank') {
                            throw new Error('Cannot access iframe content');
                        }
                        // If we get here, iframe loaded successfully
                        console.log('Iframe content accessible for:', url);
                    } catch (e) {
                        console.log('Iframe blocked by security policy:', url, e.message);
                        iframe.style.display = 'none';
                        fallback.style.display = 'block';
                    }
                }, 100);
            };

            // Handle immediate errors
            iframe.onerror = () => {
                hasLoaded = true;
                clearTimeout(loadTimeout);
                console.log('Iframe immediate error:', url);
                iframe.style.display = 'none';
                fallback.style.display = 'block';
            };

            // Check for common blocked domains immediately
            const domain = this.getDomainFromUrl(url).toLowerCase();
            const blockedDomains = ['github.com', 'dribbble.com', 'behance.net', 'awwwards.com', 'twitter.com', 'facebook.com', 'instagram.com', 'youtube.com'];
            
            if (blockedDomains.some(blocked => domain.includes(blocked))) {
                console.log('Known blocked domain, showing fallback immediately:', domain);
                setTimeout(() => {
                    iframe.style.display = 'none';
                    fallback.style.display = 'block';
                }, 500);
            }

            container.appendChild(iframeContainer);
        });

        // Hide loading after iframes are added
        setTimeout(() => {
            if (loading) {
                loading.classList.add('hidden');
                console.log('Loading hidden');
            }
        }, 300);
    }

    // Generate color gradients based on sites
    generateColorGradients() {
        const container = document.getElementById('gradients-container');
        if (!container) return;

        container.innerHTML = '';

        const sitesToShow = this.sites.slice(0, this.maxSites);

        sitesToShow.forEach((url, index) => {
            const gradientItem = document.createElement('div');
            gradientItem.className = 'gradient-item';
            
            // Generate a unique gradient for each site
            const gradient = this.generateGradientForSite(url, index);
            
            gradientItem.innerHTML = `
                <div class="gradient-preview" style="background: ${gradient}"></div>
                <div class="gradient-info">
                    <div class="gradient-url">${this.getDomainFromUrl(url)}</div>
                </div>
            `;

            container.appendChild(gradientItem);
        });
    }

    // Generate a gradient based on site URL
    generateGradientForSite(url, index) {
        // Create a hash from the URL for consistent colors
        const hash = this.hashCode(url);
        const colors = this.generateColorsFromHash(hash, index);
        
        const angle = (hash % 360 + 360) % 360;
        return `linear-gradient(${angle}deg, ${colors.join(', ')})`;
    }

    // Simple hash function
    hashCode(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash;
    }

    // Generate colors from hash
    generateColorsFromHash(hash, index) {
        const colors = [];
        const baseHue = (Math.abs(hash) % 360);
        
        // Generate 3 colors for the gradient
        for (let i = 0; i < 3; i++) {
            const hue = (baseHue + (i * 60) + (index * 30)) % 360;
            const saturation = 60 + (Math.abs(hash >> (i * 4)) % 40);
            const lightness = 45 + (Math.abs(hash >> (i * 6)) % 30);
            colors.push(`hsl(${hue}, ${saturation}%, ${lightness}%)`);
        }
        
        return colors;
    }

    // Display sites list on manage page
    displaySitesList() {
        const container = document.getElementById('sites-container');
        if (!container) return;

        container.innerHTML = '';

        if (this.sites.length === 0) {
            container.innerHTML = '<p style="color: #888; text-align: center;">No sites added yet.</p>';
            return;
        }

        this.sites.forEach((url, index) => {
            const siteItem = document.createElement('div');
            siteItem.className = 'site-item';
            
            siteItem.innerHTML = `
                <a href="${url}" target="_blank" class="site-url">${url}</a>
                <button class="remove-btn" onclick="spotlight.removeSite(${index})">Remove</button>
            `;

            container.appendChild(siteItem);
        });
    }

    // Add a new site
    addSite() {
        const input = document.getElementById('new-url');
        if (!input) return;

        const url = input.value.trim();
        
        if (!url) {
            this.showNotification('Please enter a URL', 'error');
            return;
        }

        if (!this.isValidUrl(url)) {
            this.showNotification('Please enter a valid URL', 'error');
            return;
        }

        if (this.sites.includes(url)) {
            this.showNotification('This site is already in the list', 'error');
            return;
        }

        if (this.sites.length >= this.maxSites) {
            this.showNotification(`Maximum of ${this.maxSites} sites allowed`, 'error');
            return;
        }

        this.sites.push(url);
        this.saveSites();
        input.value = '';
        this.displaySitesList();
        this.showNotification('Site added successfully!');
    }

    // Remove a site
    removeSite(index) {
        if (index >= 0 && index < this.sites.length) {
            const removedSite = this.sites[index];
            this.sites.splice(index, 1);
            this.saveSites();
            this.displaySitesList();
            this.showNotification(`Removed ${this.getDomainFromUrl(removedSite)}`);
        }
    }

    // Clear all sites
    clearAllSites() {
        if (confirm('Are you sure you want to remove all sites? This action cannot be undone.')) {
            this.sites = [];
            this.saveSites();
            this.displaySitesList();
            this.showNotification('All sites removed');
        }
    }

    // Download store.txt file
    downloadStoreFile() {
        const content = this.sites.join('\n');
        const blob = new Blob([content], { type: 'text/plain' });
        const url = window.URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = 'store.txt'; // This will be downloaded to user's default download folder
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        this.showNotification('Store file downloaded! Place it in the store/ folder on your server.');
    }

    // Upload store.txt file
    uploadStoreFile(event) {
        const file = event.target.files[0];
        if (!file) return;

        if (file.type !== 'text/plain') {
            this.showNotification('Please upload a .txt file', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            const urls = content.split('\n')
                .map(url => url.trim())
                .filter(url => url && this.isValidUrl(url));

            if (urls.length === 0) {
                this.showNotification('No valid URLs found in the file', 'error');
                return;
            }

            if (urls.length > this.maxSites) {
                this.showNotification(`File contains ${urls.length} URLs, only first ${this.maxSites} will be used`, 'error');
                urls.splice(this.maxSites);
            }

            this.sites = urls;
            this.saveSites();
            this.displaySitesList();
            this.showNotification(`Loaded ${urls.length} sites from file!`);
        };

        reader.readAsText(file);
        event.target.value = ''; // Reset input
    }

    // Utility functions
    isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    }

    getDomainFromUrl(url) {
        try {
            return new URL(url).hostname;
        } catch (_) {
            return url;
        }
    }

    showNotification(message, type = 'success') {
        const notification = document.getElementById('notification');
        const text = document.querySelector('.notification-text');
        
        if (!notification || !text) return;

        text.textContent = message;
        notification.className = `notification ${type}`;
        
        // Auto hide after 3 seconds
        setTimeout(() => this.hideNotification(), 3000);
    }

    hideNotification() {
        const notification = document.getElementById('notification');
        if (notification) {
            notification.classList.add('hidden');
        }
    }
}

// Initialize the application
const spotlight = new SpotlightManager();

// Make it globally available for onclick handlers
window.spotlight = spotlight;