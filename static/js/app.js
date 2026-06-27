/* ==========================================================================
   ROADSENSE CORE FRONTEND ENGINE
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    
    // Apply stored theme on init immediately
    const storedTheme = localStorage.getItem('theme');
    if (storedTheme === 'light') {
        document.body.classList.add('light-mode');
    } else {
        document.body.classList.remove('light-mode');
    }

    // Core Application State
    const state = {
        activePage: 'landing',
        userLocation: { lat: 12.9716, lng: 77.5946, accuracy: null },
        potholes: [],
        activeRouteType: 'safest',
        routesData: null,
        simulationInterval: null,
        simulating: false,
        simCoords: [],
        simIndex: 0,
        simMarker: null,
        voiceEnabled: true,
        voiceGender: 'female', // female or male
        voiceVolume: 0.8,
        voiceSynth: window.speechSynthesis,
        alertsSpoken: new Set(),
        lidarMeshAngle: 0,
        lidarMeshCraters: [],
        weatherTab: 'rain',
        dbCleared: false,
        routeStartCoords: { lat: 12.9716, lng: 77.5946 },
        routeEndCoords: { lat: 12.9716, lng: 77.5946 }
    };

    // System constants
    const DEFAULT_MAP_CENTER = [12.9716, 77.5946]; // Bengaluru, Karnataka
    const KARNATAKA_BOUNDS = L.latLngBounds([11.5, 74.0], [18.5, 78.5]);
    const MAP_ZOOM = 13;

    // References to Map Instances
    let maps = {
        landing: null,
        routes: null,
        dashboard: null
    };

    // References to Map Layer Groups
    let mapLayers = {
        landingPotholes: null,
        routesPotholes: null,
        routesPaths: { safest: null, balanced: null, fastest: null },
        dashboardHeatmap: null,
        dashboardMarkers: null
    };

    // Initialize Lucide Icons
    lucide.createIcons();

    /* ==========================================================================
       SPA VIEW ROUTING & INITIALIZATION
       ========================================================================== */
    
    function navigateToPage(pageId) {
        if (!pageId) return;
        
        // Update nav active states
        document.querySelectorAll('.nav-links li').forEach(li => {
            if (li.getAttribute('data-page') === pageId) {
                li.classList.add('active');
            } else {
                li.classList.remove('active');
            }
        });

        // Hide and show pages with transitions
        const currentView = document.querySelector('.page-view.active');
        const targetView = document.getElementById(`page-${pageId}`);
        
        if (currentView && currentView !== targetView) {
            currentView.style.opacity = '0';
            currentView.style.transform = 'translateY(10px)';
            currentView.style.filter = 'blur(4px)';
            
            setTimeout(() => {
                currentView.classList.remove('active');
                
                targetView.classList.add('active');
                // Trigger reflow
                targetView.offsetHeight;
                
                targetView.style.opacity = '1';
                targetView.style.transform = 'translateY(0)';
                targetView.style.filter = 'blur(0)';
                
                // Recalculate maps sizes on page switch
                invalidateMaps();
                
                // Load page specific initializers
                onPageLoad(pageId);
            }, 300);
        } else {
            // First load or fallback
            targetView.classList.add('active');
            targetView.style.opacity = '1';
            targetView.style.transform = 'translateY(0)';
            targetView.style.filter = 'blur(0)';
            invalidateMaps();
            onPageLoad(pageId);
        }
        
        state.activePage = pageId;
        window.location.hash = pageId === 'landing' ? 'home' : pageId;
    }

    // Trigger map redraws to prevent gray boxes in hidden leaflet containers
    function invalidateMaps() {
        Object.keys(maps).forEach(key => {
            if (maps[key]) {
                setTimeout(() => {
                    maps[key].invalidateSize();
                }, 100);
            }
        });
    }

    function onPageLoad(pageId) {
        if (pageId === 'lab') {
            initLidarMesh();
        } else if (pageId === 'routes') {
            stopRouteSimulation();
            initRouteMap();
        } else if (pageId === 'karnataka') {
            initKarnatakaPage();
        } else if (pageId === 'analytics') {
            renderSVGCharts();
        } else if (pageId === 'dashboard') {
            initDashboardMap();
            populateMunicipalViews();
        }
    }

    // Hash routing listener
    window.addEventListener('hashchange', () => {
        const hash = window.location.hash.substring(1);
        const mappedHash = hash === 'home' ? 'landing' : hash;
        if (['landing', 'lab', 'routes', 'karnataka', 'analytics', 'dashboard'].includes(mappedHash)) {
            navigateToPage(mappedHash);
        }
    });

    // Navigation Click Handlers
    document.querySelectorAll('.nav-links li').forEach(li => {
        li.addEventListener('click', () => {
            navigateToPage(li.getAttribute('data-page'));
        });
    });

    document.getElementById('nav-logo-btn').addEventListener('click', () => {
        navigateToPage('landing');
    });

    document.getElementById('nav-cta-btn').addEventListener('click', () => {
        navigateToPage('lab');
    });

    // Theme Toggle Handler
    const themeToggleBtn = document.getElementById('theme-toggle');
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            document.body.classList.toggle('light-mode');
            const isLight = document.body.classList.contains('light-mode');
            localStorage.setItem('theme', isLight ? 'light' : 'dark');
            invalidateMaps();
        });
    }

    // Landing Hero Action Buttons
    document.getElementById('hero-primary-cta').addEventListener('click', () => {
        navigateToPage('lab');
    });

    document.getElementById('hero-secondary-cta').addEventListener('click', () => {
        navigateToPage('routes');
    });

    // Feature Cards Action Links
    document.querySelectorAll('.feature-card').forEach(card => {
        card.addEventListener('click', () => {
            navigateToPage(card.getAttribute('data-target-page'));
        });
    });

    /* ==========================================================================
       BACKGROUND FLOATING PARTICLES SYSTEM (SpaceX Feel)
       ========================================================================== */
    
    function initBackgroundParticles() {
        const canvas = document.getElementById('bg-particles');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        let particles = [];
        
        function resize() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }
        window.addEventListener('resize', resize);
        resize();

        // Create particles
        const count = 40;
        for (let i = 0; i < count; i++) {
            particles.push({
                x: randomRange(0, canvas.width),
                y: randomRange(0, canvas.height),
                radius: randomRange(0.8, 2.2),
                color: randomChoice([
                    'rgba(0, 210, 255, 0.15)', // Blue
                    'rgba(255, 0, 127, 0.15)', // Magenta
                    'rgba(255, 255, 255, 0.08)' // Silver
                ]),
                speedX: randomRange(-0.2, 0.2),
                speedY: randomRange(-0.15, -0.05) // Drift upwards slowly
            });
        }

        function animate() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            particles.forEach(p => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                ctx.fillStyle = p.color;
                ctx.fill();
                
                // Update position
                p.x += p.speedX;
                p.y += p.speedY;
                
                // Screen wrapping
                if (p.x < 0) p.x = canvas.width;
                if (p.x > canvas.width) p.x = 0;
                if (p.y < 0) p.y = canvas.height;
                if (p.y > canvas.height) p.y = canvas.height;
            });
            requestAnimationFrame(animate);
        }
        animate();
    }

    /* ==========================================================================
       MAP SYSTEMS (Leaflet GIS Integration)
       ========================================================================== */

    function getPotholeIcon(severity) {
        // Futuristic custom glowing markers via Leaflet DivIcon
        let glowClass = 'glow-marker-yellow';
        let color = '#ffb700';
        
        if (severity === 'Critical') {
            glowClass = 'glow-marker-red';
            color = '#ff0055';
        } else if (severity === 'High Risk') {
            glowClass = 'glow-marker-magenta';
            color = '#ff007f';
        } else if (severity === 'Stable') {
            glowClass = 'glow-marker-green';
            color = '#00ff7f';
        }

        // Return a raw HTML node representation of a futuristic HUD node
        return L.divIcon({
            className: 'custom-leaflet-hud-icon',
            html: `<div class="glowing-marker-hub ${glowClass}"><div class="marker-core" style="background:${color};"></div></div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
    }

    // Styles for glowing Leaflet markers
    const styleSheet = document.createElement("style");
    styleSheet.innerText = `
        .custom-leaflet-hud-icon { background: transparent !important; border: none !important; }
        .glowing-marker-hub {
            width: 20px;
            height: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            background: rgba(0,0,0,0.4);
            border: 1px solid rgba(255,255,255,0.1);
        }
        .marker-core {
            width: 8px;
            height: 8px;
            border-radius: 50%;
        }
        .glow-marker-red { box-shadow: 0 0 10px #ff0055, inset 0 0 4px #ff0055; }
        .glow-marker-magenta { box-shadow: 0 0 10px #ff007f, inset 0 0 4px #ff007f; }
        .glow-marker-yellow { box-shadow: 0 0 10px #ffb700, inset 0 0 4px #ffb700; }
        .glow-marker-green { box-shadow: 0 0 10px #00ff7f, inset 0 0 4px #00ff7f; }
    `;
    document.head.appendChild(styleSheet);

    function initLandingMap() {
        if (maps.landing) return;
        
        maps.landing = L.map('landing-map', {
            zoomControl: true,
            attributionControl: false,
            maxBounds: KARNATAKA_BOUNDS,
            minZoom: 6
        }).setView(DEFAULT_MAP_CENTER, MAP_ZOOM);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 20
        }).addTo(maps.landing);

        mapLayers.landingPotholes = L.layerGroup().addTo(maps.landing);
    }

    function initRouteMap() {
        if (maps.routes) return;
        
        maps.routes = L.map('routes-map', {
            zoomControl: true,
            attributionControl: false,
            maxBounds: KARNATAKA_BOUNDS,
            minZoom: 6
        }).setView(DEFAULT_MAP_CENTER, MAP_ZOOM);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 20
        }).addTo(maps.routes);

        mapLayers.routesPotholes = L.layerGroup().addTo(maps.routes);
        mapLayers.routesPaths.safest = L.layerGroup().addTo(maps.routes);
        mapLayers.routesPaths.balanced = L.layerGroup().addTo(maps.routes);
        mapLayers.routesPaths.fastest = L.layerGroup().addTo(maps.routes);
        
        // Auto trigger route calculations on load
        calculateRoutes();
    }

    function initDashboardMap() {
        if (maps.dashboard) return;
        
        maps.dashboard = L.map('dashboard-map', {
            zoomControl: false,
            attributionControl: false,
            maxBounds: KARNATAKA_BOUNDS,
            minZoom: 6
        }).setView(DEFAULT_MAP_CENTER, MAP_ZOOM - 1);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 20
        }).addTo(maps.dashboard);

        mapLayers.dashboardMarkers = L.layerGroup().addTo(maps.dashboard);
        mapLayers.dashboardHeatmap = L.layerGroup().addTo(maps.dashboard);
    }

    // Refresh telemetry nodes across all map displays
    async function fetchPotholes() {
        try {
            const response = await fetch('/api/hazards/live');
            const data = await response.json();
            state.potholes = data;
            
            updateMapMarkers();
            updateHUDStats();
            
            // Populate selector in Municipal console
            populateBlastSelector();
        } catch (e) {
            console.error("Telemetry fetch error:", e);
        }
    }

    function updateMapMarkers() {
        // Clear layers
        if (mapLayers.landingPotholes) mapLayers.landingPotholes.clearLayers();
        if (mapLayers.routesPotholes) mapLayers.routesPotholes.clearLayers();
        if (mapLayers.dashboardMarkers) mapLayers.dashboardMarkers.clearLayers();
        if (mapLayers.dashboardHeatmap) mapLayers.dashboardHeatmap.clearLayers();

        state.potholes.forEach(ph => {
            const popupContent = `
                <div style="font-family: var(--font-sans); padding:4px 8px; background:#0e0e12; color:#fff; border: 1px solid var(--color-border); border-radius:6px;">
                    <div style="font-size:9px; font-weight:700; color:var(--color-accent-blue); letter-spacing:0.05em; text-transform:uppercase;">DEFECT LOG ID: ${ph.id}</div>
                    <div style="font-size:12px; font-weight:600; margin: 4px 0;">${ph.street}</div>
                    <div style="font-size:11px; display:flex; justify-content:space-between; gap:20px;">
                        <span>SEVERITY:</span>
                        <span style="font-weight:700; color:${ph.severity === 'Critical' ? '#ff0055' : ph.severity === 'High Risk' ? '#ff007f' : '#ffb700'};">${ph.severity.toUpperCase()}</span>
                    </div>
                    <div style="font-size:10px; color:#71717a; margin-top:4px;">LIDAR HEALTH: ${ph.score}/100</div>
                </div>
            `;
            
            // Add custom markers
            const m1 = L.marker([ph.lat, ph.lng], { icon: getPotholeIcon(ph.severity) }).bindPopup(popupContent);
            const m2 = L.marker([ph.lat, ph.lng], { icon: getPotholeIcon(ph.severity) }).bindPopup(popupContent);
            const m3 = L.marker([ph.lat, ph.lng], { icon: getPotholeIcon(ph.severity) }).bindPopup(popupContent);
            
            if (mapLayers.landingPotholes) mapLayers.landingPotholes.addLayer(m1);
            if (mapLayers.routesPotholes) mapLayers.routesPotholes.addLayer(m2);
            if (mapLayers.dashboardMarkers) mapLayers.dashboardMarkers.addLayer(m3);
            
            // Add danger glowing rings (simulated heat radius) to dashboard heatmap layer
            if (mapLayers.dashboardHeatmap) {
                let heatColor = '#ffb700'; // Moderate
                let fillOpacity = 0.05;
                let radius = 100;
                
                if (ph.severity === 'Critical') {
                    heatColor = '#ff0055';
                    fillOpacity = 0.15;
                    radius = 250;
                } else if (ph.severity === 'High Risk') {
                    heatColor = '#ff007f';
                    fillOpacity = 0.1;
                    radius = 180;
                }
                
                const circle = L.circle([ph.lat, ph.lng], {
                    color: heatColor,
                    fillColor: heatColor,
                    fillOpacity: fillOpacity,
                    stroke: true,
                    weight: 1,
                    opacity: 0.25,
                    radius: radius
                });
                mapLayers.dashboardHeatmap.addLayer(circle);
            }
        });
    }

    function updateHUDStats() {
        const criticalCount = state.potholes.filter(p => p.severity === 'Critical').length;
        const totalHazards = state.potholes.length;
        
        // Calculate average city score
        let sum = 0;
        state.potholes.forEach(p => sum += p.score);
        const avgScore = totalHazards > 0 ? Math.round(sum / totalHazards) : 100;

        // Apply DOM updates
        const elHealth = document.getElementById('hud-city-health');
        if (elHealth) {
            elHealth.innerText = `${avgScore.toFixed(1)}%`;
            elHealth.className = avgScore > 75 ? 'hud-val text-green' : avgScore > 50 ? 'hud-val text-yellow' : 'hud-val text-magenta';
        }
        
        const elAlerts = document.getElementById('hud-active-alerts');
        if (elAlerts) elAlerts.innerText = criticalCount;
        
        const elHazards = document.getElementById('hud-hazard-count');
        if (elHazards) elHazards.innerText = totalHazards;
    }

    /* ==========================================================================
       GEOLOCATION LAYER
       ========================================================================== */

    function initGeolocation() {
        const dot = document.getElementById('gps-dot');
        const text = document.getElementById('gps-status-text');
        const latVal = document.getElementById('gps-lat');
        const lngVal = document.getElementById('gps-lng');
        const streetVal = document.getElementById('gps-street');
        
        if (!navigator.geolocation) {
            if (text) text.innerText = "GPS Not Supported By Browser";
            if (dot) dot.className = "gps-dot bg-red";
            return;
        }

        // Set state to loading
        if (text) text.innerText = "Synchronizing GPS Satellites...";
        if (dot) dot.className = "gps-dot pulsing text-blue";

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                let lat = pos.coords.latitude;
                let lng = pos.coords.longitude;
                
                // Keep strictly within Karnataka bounding box
                if (lat >= 11.5 && lat <= 18.5 && lng >= 74.0 && lng <= 78.5) {
                    state.userLocation.lat = lat;
                    state.userLocation.lng = lng;
                    if (text) text.innerText = "Location Sync Active // Karnataka Lock";
                } else {
                    state.userLocation.lat = 12.9716;
                    state.userLocation.lng = 77.5946;
                    if (text) text.innerText = "Location Synced // Sandbox Karnataka Lock";
                }
                state.userLocation.accuracy = pos.coords.accuracy;
                
                // Update views
                if (latVal) latVal.innerText = state.userLocation.lat.toFixed(6);
                if (lngVal) lngVal.innerText = state.userLocation.lng.toFixed(6);
                if (dot) {
                    dot.className = "gps-dot bg-green";
                    dot.style.boxShadow = "0 0 10px #00ff7f";
                }
                
                // Query coordinates street address
                geocodePosition(state.userLocation.lat, state.userLocation.lng, streetVal);
                
                // Recenter maps around user
                if (maps.landing) maps.landing.setView([state.userLocation.lat, state.userLocation.lng], MAP_ZOOM);
                if (maps.routes) maps.routes.setView([state.userLocation.lat, state.userLocation.lng], MAP_ZOOM);
            },
            (err) => {
                console.warn(`Geolocation error (${err.code}): ${err.message}. Falling back to default center.`);
                state.userLocation.lat = 12.9716;
                state.userLocation.lng = 77.5946;
                if (latVal) latVal.innerText = state.userLocation.lat.toFixed(6);
                if (lngVal) lngVal.innerText = state.userLocation.lng.toFixed(6);
                if (text) text.innerText = "Location Access Blocked (Using Karnataka Sandbox)";
                if (dot) dot.className = "gps-dot bg-yellow";
                if (streetVal) streetVal.innerText = "MG Road, Bengaluru, KA";
            },
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
        );
    }

    async function geocodePosition(lat, lng, element) {
        if (!element) return;
        element.innerText = "Querying municipal zoning database...";
        try {
            // Use openstreetmap reverse geocode API (unauthenticated)
            const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
            const data = await response.json();
            if (data && data.display_name) {
                // Shorten display name to keep layout minimal
                const addressParts = data.display_name.split(',');
                const shortAddress = addressParts.slice(0, 3).join(',');
                element.innerText = shortAddress;
            } else {
                element.innerText = `Sector GPS: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
            }
        } catch (e) {
            element.innerText = `Financial District Sector ${randomRange(1, 12)}`;
        }
    }

    document.getElementById('gps-manual-btn').addEventListener('click', initGeolocation);

    /* ==========================================================================
       ROADSENSE LAB PAGE (AI Detection & 3D LiDAR Mesh)
       ========================================================================== */
    
    // File inputs & DragDrop handlers
    const dropzone = document.getElementById('lab-dropzone');
    const fileInput = document.getElementById('lab-file-input');
    const imageDisplay = document.getElementById('lab-image-display');
    const displayPlaceholder = document.getElementById('lab-display-placeholder');
    const laserLine = document.getElementById('scan-laser-line');
    const scanLoader = document.getElementById('scanning-hud-loader');
    const scanIndicatorText = document.getElementById('scan-status-indicator');

    if (dropzone) {
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = 'var(--color-accent-blue)';
            dropzone.style.background = 'rgba(0, 210, 255, 0.04)';
        });
        
        dropzone.addEventListener('dragleave', () => {
            dropzone.style.borderColor = 'rgba(255, 255, 255, 0.15)';
            dropzone.style.background = 'rgba(255,255,255,0.01)';
        });
        
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = 'rgba(255, 255, 255, 0.15)';
            dropzone.style.background = 'rgba(255,255,255,0.01)';
            
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                processLabFile(e.dataTransfer.files[0]);
            }
        });
        
        dropzone.addEventListener('click', () => {
            fileInput.click();
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', () => {
            if (fileInput.files && fileInput.files[0]) {
                processLabFile(fileInput.files[0]);
            }
        });
    }

    // Demo samples
    document.querySelectorAll('.btn-sample').forEach(btn => {
        btn.addEventListener('click', () => {
            const sampleNum = btn.getAttribute('data-sample');
            loadDemoScan(sampleNum);
        });
    });

    async function loadDemoScan(sampleNum) {
        // Fetch pre-loaded demo pothole image buffers and send to predict endpoint
        // To make it run instantly without complex files, we can generate a mock File structure
        // with basic dummy image bytes or fetch beautiful placeholders, or send a request to a mock predict handler.
        // Let's make mock image files so it triggers a real HTTP request and does actual HUD rendering in Python!
        
        let sampleName = "pothole_sample.jpg";
        let width = 640;
        let height = 480;
        let color = "#ff007f";
        
        if (sampleNum === "2") {
            sampleName = "crack_sample.jpg";
            color = "#ffb700";
        } else if (sampleNum === "3") {
            sampleName = "highway_sample.jpg";
            color = "#00ff7f";
        }

        // Draw a simulated canvas image to upload
        const mockCanvas = document.createElement('canvas');
        mockCanvas.width = width;
        mockCanvas.height = height;
        const ctx = mockCanvas.getContext('2d');
        
        // Background road asphalt dark gray
        ctx.fillStyle = "#1e1e24";
        ctx.fillRect(0, 0, width, height);
        
        // Draw noise
        for (let i = 0; i < 2000; i++) {
            ctx.fillStyle = `rgba(255, 255, 255, ${randomRange(0.01, 0.05)})`;
            ctx.fillRect(randomRange(0, width), randomRange(0, height), randomRange(1, 3), randomRange(1, 3));
        }

        // Draw cracks or pothole shapes depending on sample
        if (sampleNum === "1") {
            // Draw dark hollow circle representing pothole
            ctx.beginPath();
            ctx.ellipse(320, 240, 100, 60, Math.PI * 0.05, 0, Math.PI * 2);
            ctx.fillStyle = "#0c0c0e";
            ctx.fill();
            
            // Draw highlighted damage zones ring
            ctx.beginPath();
            ctx.ellipse(320, 240, 95, 55, Math.PI * 0.05, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(255, 0, 85, 0.25)";
            ctx.lineWidth = 8;
            ctx.stroke();
        } else if (sampleNum === "2") {
            // Draw fractal line cracks
            ctx.strokeStyle = "#101014";
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(100, 120);
            ctx.lineTo(250, 240);
            ctx.lineTo(380, 290);
            ctx.lineTo(520, 400);
            ctx.stroke();
            
            ctx.strokeStyle = "rgba(255, 183, 0, 0.15)";
            ctx.lineWidth = 6;
            ctx.stroke();
        } else {
            // Smooth green line highway lanes
            ctx.strokeStyle = "rgba(255,255,255,0.15)";
            ctx.lineWidth = 4;
            ctx.setLineDash([20, 20]);
            ctx.beginPath();
            ctx.moveTo(320, 0);
            ctx.lineTo(320, height);
            ctx.stroke();
        }

        // Convert canvas to blob file
        mockCanvas.toBlob(blob => {
            const file = new File([blob], sampleName, { type: 'image/jpeg' });
            processLabFile(file);
        }, 'image/jpeg');
    }

    async function processLabFile(file) {
        if (state._processing) return;
        state._processing = true;

        // Toggle scan visual state
        if (scanLoader) scanLoader.style.display = 'flex';
        if (laserLine) {
            laserLine.style.display = 'block';
            laserLine.style.animation = 'scan-animation 2.5s ease-in-out infinite';
        }
        if (displayPlaceholder) displayPlaceholder.style.display = 'none';
        if (imageDisplay) imageDisplay.style.display = 'none';
        if (scanIndicatorText) {
            scanIndicatorText.innerText = "SCANNING";
            scanIndicatorText.style.color = "var(--color-accent-magenta)";
        }
        
        // Prepare Form Data
        const formData = new FormData();
        formData.append('file', file);
        formData.append('latitude', state.userLocation.lat);
        formData.append('longitude', state.userLocation.lng);
        
        // Fetch geocoded location to pass
        const tempGeoEl = document.createElement('div');
        await geocodePosition(state.userLocation.lat, state.userLocation.lng, tempGeoEl);
        formData.append('street', tempGeoEl.innerText || 'Sector Lock GPS');

        try {
            const response = await fetch('/api/diagnostics/upload-capture', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            
            // Artificial delay for cinematic scanning UX
            setTimeout(() => {
                renderLabDetections(data);
            }, 2500);
        } catch (e) {
            console.error("AI scan failed:", e);
            // Revert loaders on failure
            if (scanLoader) scanLoader.style.display = 'none';
            if (laserLine) laserLine.style.display = 'none';
            if (scanIndicatorText) scanIndicatorText.innerText = "ERROR";
            // Re-show placeholder
            if (displayPlaceholder) displayPlaceholder.style.display = 'flex';
            if (imageDisplay) imageDisplay.style.display = 'none';
        } finally {
            state._processing = false;
        }
    }

    function renderLabDetections(data) {
        // ── Stop loading UI ──────────────────────────────────────────────
        if (scanLoader) scanLoader.style.display = 'none';
        if (laserLine) {
            laserLine.style.display = 'none';
            laserLine.style.animation = '';
        }

        // ── Show annotated image ─────────────────────────────────────────
        if (imageDisplay) {
            imageDisplay.src = data.processed_image;
            imageDisplay.style.display = 'block';
        }

        if (scanIndicatorText) {
            scanIndicatorText.innerText = data.is_pothole ? 'ANOMALY DETECTED' : 'SCAN COMPLETE';
            scanIndicatorText.style.color = data.is_pothole
                ? 'var(--color-accent-red)'
                : 'var(--color-accent-green)';
        }

        // ── VERDICT BANNER ───────────────────────────────────────────────
        const banner       = document.getElementById('detection-verdict-banner');
        const verdictLabel = document.getElementById('verdict-label');
        const verdictSub   = document.getElementById('verdict-sublabel');
        const verdictBadge = document.getElementById('verdict-badge');
        const verdictIcon  = document.getElementById('verdict-icon');

        if (banner) {
            // Reset classes and re-trigger animation
            banner.className = 'detection-verdict-banner';
            banner.style.display = 'flex';
            // Force reflow to restart animation
            void banner.offsetWidth;

            if (data.is_pothole) {
                banner.classList.add('verdict-pothole');
                if (verdictLabel) verdictLabel.textContent = '⚠ POTHOLE DETECTED';
                const subTexts = {
                    'Critical':  'Critical pavement failure — immediate repair required',
                    'High Risk': 'Significant road damage — high vehicle impact risk',
                    'Moderate':  'Moderate surface defects — schedule maintenance soon',
                };
                if (verdictSub)   verdictSub.textContent  = subTexts[data.severity] || 'Road surface defect identified';
                if (verdictBadge) verdictBadge.textContent = data.severity.toUpperCase();
                if (verdictIcon) {
                    verdictIcon.setAttribute('data-lucide', 'alert-triangle');
                }
            } else {
                banner.classList.add('verdict-normal');
                if (verdictLabel) verdictLabel.textContent = '✓ NORMAL ROAD';
                if (verdictSub)   verdictSub.textContent  = `No significant pavement damage detected — road score ${data.road_score}/100`;
                if (verdictBadge) verdictBadge.textContent = 'CLEAR';
                if (verdictIcon) {
                    verdictIcon.setAttribute('data-lucide', 'shield-check');
                }
            }
            lucide.createIcons();
        }

        // ── Telemetry metrics ────────────────────────────────────────────
        const elConf = document.getElementById('metric-confidence');
        if (elConf) elConf.innerText = `${data.confidence.toFixed(1)}%`;

        const elCount = document.getElementById('metric-count');
        if (elCount) elCount.innerText = data.count;

        const elSev = document.getElementById('metric-severity');
        if (elSev) {
            elSev.innerText = data.severity.toUpperCase();
            elSev.className = `metric-num ${getSeverityColorClass(data.severity)}`;
        }

        const elUrg = document.getElementById('metric-urgency');
        if (elUrg) {
            const urgencyMap = {
                'Critical':  'IMMEDIATE',
                'High Risk': 'PRIORITY 1',
                'Moderate':  'SCHEDULED',
                'Stable':    'NONE'
            };
            elUrg.innerText   = urgencyMap[data.severity] || 'NONE';
            elUrg.className   = `metric-num ${getSeverityColorClass(data.severity)}`;
        }

        // ── Analysis breakdown (new fields) ──────────────────────────────
        if (data.analysis) {
            const elDark = document.getElementById('metric-dark-ratio');
            if (elDark) elDark.innerText = data.analysis.dark_ratio !== undefined
                ? `${(data.analysis.dark_ratio * 100).toFixed(2)}%`
                : '--';

            const elEdge = document.getElementById('metric-edge-density');
            if (elEdge) elEdge.innerText = data.analysis.edge_density !== undefined
                ? `${(data.analysis.edge_density * 100).toFixed(2)}%`
                : '--';

            const elVar = document.getElementById('metric-variance-cells');
            if (elVar) elVar.innerText = data.analysis.high_variance_cells !== undefined
                ? `${data.analysis.high_variance_cells} / 16 cells`
                : '--';
        }

        // ── Circular road health score ────────────────────────────────────
        const scoreEl      = document.getElementById('radial-health-score');
        const scoreLabel   = document.getElementById('radial-health-label');
        const strokeCircle = document.getElementById('radial-health-stroke');

        if (scoreEl) scoreEl.innerText = data.road_score;
        if (scoreLabel) {
            scoreLabel.innerText = data.road_score > 75 ? 'Optimal State'
                                 : data.road_score > 50 ? 'Moderate Wear'
                                 : 'Critical Decay';
            scoreLabel.style.color = getSeverityColor(data.severity);
        }
        if (strokeCircle) {
            const radius       = strokeCircle.r.baseVal.value;
            const circumference = 2 * Math.PI * radius;
            const offset       = circumference - (data.road_score / 100) * circumference;
            strokeCircle.style.strokeDashoffset = offset;
            strokeCircle.style.stroke           = getSeverityColor(data.severity);
            strokeCircle.style.filter           = `drop-shadow(0 0 5px ${getSeverityColor(data.severity)})`;
        }

        // ── LiDAR 3D mesh deformation ────────────────────────────────────
        triggerLidarCraters(data.potholes);

        // ── Refresh city hazard map ──────────────────────────────────────
        fetchPotholes();

        state._processing = false;
    }

    function getSeverityColorClass(sev) {
        if (sev === 'Critical') return 'text-red';
        if (sev === 'High Risk') return 'text-magenta';
        if (sev === 'Moderate') return 'text-yellow';
        return 'text-green';
    }

    function getSeverityColor(sev) {
        if (sev === 'Critical') return '#ff0055';
        if (sev === 'High Risk') return '#ff007f';
        if (sev === 'Moderate') return '#ffb700';
        return '#00ff7f';
    }

    /* ==========================================================================
       3D LIDAR TERRAIN CANVAS MESH
       ========================================================================== */
    
    let lidarCanvas, lidarCtx, lidarAnimId;

    function initLidarMesh() {
        lidarCanvas = document.getElementById('lidar-mesh-canvas');
        if (!lidarCanvas) return;
        lidarCtx = lidarCanvas.getContext('2d');
        
        // Resize canvas layout
        lidarCanvas.width = lidarCanvas.offsetWidth;
        lidarCanvas.height = lidarCanvas.offsetHeight;
        
        // Clear previous anim loop
        if (lidarAnimId) cancelAnimationFrame(lidarAnimId);
        
        // Render loop
        function drawMeshLoop() {
            renderLidarMeshGrid();
            state.lidarMeshAngle += 0.003;
            lidarAnimId = requestAnimationFrame(drawMeshLoop);
        }
        drawMeshLoop();
    }

    function renderLidarMeshGrid() {
        if (!lidarCtx) return;
        const w = lidarCanvas.width;
        const h = lidarCanvas.height;
        
        lidarCtx.fillStyle = '#020203';
        lidarCtx.fillRect(0, 0, w, h);
        
        // Perspective settings
        const cols = 28;
        const rows = 18;
        const cellW = w * 1.2 / cols;
        const cellH = h * 1.1 / rows;
        
        const centerX = w / 2;
        const centerY = h * 0.45;
        const pitch = 0.55; // vertical tilt factor
        const yaw = state.lidarMeshAngle;
        
        // Draw grid lines
        lidarCtx.strokeStyle = 'rgba(0, 210, 255, 0.15)';
        lidarCtx.lineWidth = 1;
        
        // Calculate all 3D mesh points projected onto 2D viewport
        let points = [];
        for (let r = 0; r < rows; r++) {
            points[r] = [];
            for (let c = 0; c < cols; c++) {
                // Centered coordinates
                let cx = (c - cols/2) * cellW;
                let cy = (r - rows/2) * cellH;
                
                // Rotate around Z axis (yaw)
                let rotX = cx * Math.cos(yaw) - cy * Math.sin(yaw);
                let rotY = cx * Math.sin(yaw) + cy * Math.cos(yaw);
                
                // Calculate height offset (Z axis)
                let z = 0;
                
                // Apply sine wave hills (ground noise)
                z += Math.sin(r * 0.4 + state.lidarMeshAngle * 4) * 3;
                
                // Apply custom pothole craters
                state.lidarMeshCraters.forEach(crater => {
                    // Distance from grid coordinate to crater center
                    const dx = c - crater.col;
                    const dy = r - crater.row;
                    const d = Math.sqrt(dx*dx + dy*dy);
                    
                    if (d < crater.radius) {
                        // Gaussian crater depression formula
                        const factor = 1 - (d / crater.radius);
                        z -= crater.depth * Math.pow(factor, 2);
                    }
                });
                
                // 3D perspective projection formula
                const dist = 500;
                const perspective = dist / (dist + rotY);
                
                const projX = centerX + rotX * perspective;
                const projY = centerY + (rotY * pitch - z) * perspective;
                
                points[r][c] = { x: projX, y: projY, z: z };
            }
        }
        
        // Render grid meshes: Horizontal lines
        for (let r = 0; r < rows; r++) {
            lidarCtx.beginPath();
            for (let c = 0; c < cols; c++) {
                const pt = points[r][c];
                if (c === 0) lidarCtx.moveTo(pt.x, pt.y);
                else lidarCtx.lineTo(pt.x, pt.y);
            }
            lidarCtx.stroke();
        }
        
        // Render grid meshes: Vertical lines
        for (let c = 0; c < cols; c++) {
            lidarCtx.beginPath();
            for (let r = 0; r < rows; r++) {
                const pt = points[r][c];
                if (r === 0) lidarCtx.moveTo(pt.x, pt.y);
                else lidarCtx.lineTo(pt.x, pt.y);
            }
            lidarCtx.stroke();
        }
        
        // Draw neon dots over crater centers
        state.lidarMeshCraters.forEach(crater => {
            if (crater.col < cols && crater.row < rows) {
                const pt = points[crater.row][crater.col];
                lidarCtx.beginPath();
                lidarCtx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
                lidarCtx.fillStyle = 'rgba(255, 0, 127, 0.8)';
                lidarCtx.fill();
                lidarCtx.strokeStyle = '#ff007f';
                lidarCtx.lineWidth = 1.5;
                lidarCtx.stroke();
            }
        });
    }

    function triggerLidarCraters(potholes) {
        state.lidarMeshCraters = [];
        
        const elLidarState = document.getElementById('lidar-mesh-state');
        
        if (!potholes || potholes.length === 0) {
            if (elLidarState) elLidarState.innerText = "STATUS: STEADY FLAT GRID";
            return;
        }
        
        if (elLidarState) elLidarState.innerText = `STATUS: WARPED CRATERS (${potholes.length} DETECTED)`;

        // Inject craters randomly distributed inside grid
        potholes.forEach((ph, i) => {
            state.lidarMeshCraters.push({
                col: randomRangeInt(8, 20),
                row: randomRangeInt(5, 13),
                radius: randomRange(2.5, 4.5),
                depth: ph.depth_mm ? ph.depth_mm * 0.4 : randomRange(15, 35)
            });
        });
    }

    /* ==========================================================================
       SAFE ROUTE ENGINE (Paths overlays & Voice warning simulation)
       ========================================================================== */
    
    async function geocodeAddress(query) {
        if (!query || query.trim() === "") {
            return { lat: state.userLocation.lat, lng: state.userLocation.lng, displayName: "Current Position" };
        }
        
        const qLower = query.toLowerCase().trim();
        
        // Robust local geocoding fallbacks for high reliability & rate-limiting resilience
        if (qLower === "my current position" || qLower === "my gps coordinates" || qLower === "current position") {
            return { lat: state.userLocation.lat, lng: state.userLocation.lng, displayName: "Current Position" };
        }
        if (qLower.includes("kanakapura")) {
            return { lat: 12.9080, lng: 77.5739, displayName: "Kanakapura Road, Bengaluru, Karnataka" };
        }
        if (qLower.includes("mysore road")) {
            return { lat: 12.9362, lng: 77.5340, displayName: "Mysore Road, Bengaluru, Karnataka" };
        }
        if (qLower.includes("indiranagar")) {
            return { lat: 12.9786, lng: 77.6408, displayName: "Indiranagar, Bengaluru, Karnataka" };
        }
        if (qLower.includes("mg road")) {
            return { lat: 12.9738, lng: 77.6119, displayName: "MG Road, Bengaluru, Karnataka" };
        }
        if (qLower.includes("koramangala")) {
            return { lat: 12.9352, lng: 77.6244, displayName: "Koramangala, Bengaluru, Karnataka" };
        }
        if (qLower.includes("jayanagar")) {
            return { lat: 12.9298, lng: 77.5815, displayName: "Jayanagar, Bengaluru, Karnataka" };
        }
        if (qLower.includes("malleshwaram")) {
            return { lat: 13.0032, lng: 77.5685, displayName: "Malleshwaram, Bengaluru, Karnataka" };
        }
        if (qLower.includes("hebbal")) {
            return { lat: 13.0358, lng: 77.5971, displayName: "Hebbal, Bengaluru, Karnataka" };
        }
        if (qLower.includes("mysore")) {
            return { lat: 12.2958, lng: 76.6394, displayName: "Mysore, Karnataka" };
        }
        if (qLower.includes("bengaluru") || qLower.includes("bangalore")) {
            return { lat: 12.9716, lng: 77.5946, displayName: "Bengaluru, Karnataka" };
        }
        
        // Append Karnataka, India context and restrict bounded viewbox to Karnataka bounds
        const searchQuery = `${query}, Karnataka, India`;
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&viewbox=74.0,18.5,78.5,11.5&bounded=1&limit=1`;
        
        try {
            const response = await fetch(url, {
                headers: { 'User-Agent': 'RoadSenseSystem/1.2' }
            });
            const data = await response.json();
            if (data && data.length > 0) {
                return {
                    lat: parseFloat(data[0].lat),
                    lng: parseFloat(data[0].lon),
                    displayName: data[0].display_name
                };
            }
        } catch (e) {
            console.error("Geocoding failed for: " + query, e);
        }
        
        // In case OSM call fails, return fallback within Bengaluru bounds
        return { lat: 12.9716, lng: 77.5946, displayName: query };
    }

    async function calculateRoutes() {
        const startVal = document.getElementById('route-start').value;
        const endVal = document.getElementById('route-end').value;

        // Perform geocoding restricted to Karnataka
        const startRes = await geocodeAddress(startVal);
        const endRes = await geocodeAddress(endVal);

        state.routeStartCoords = startRes;
        state.routeEndCoords = endRes;

        const payload = {
            start_coords: [startRes.lng, startRes.lat],
            end_coords: [endRes.lng, endRes.lat]
        };

        try {
            const response = await fetch('/api/routes/calculate-safe-path', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const routes = await response.json();
            state.routesData = routes;
            
            // Populate cards metrics
            updateRouteCards();
            
            // Render paths on Leaflet Map
            renderPathsOnMap();

            // Fit the route map bounds nicely around the queried locations
            if (maps.routes) {
                const routeBounds = L.latLngBounds([startRes.lat, startRes.lng], [endRes.lat, endRes.lng]);
                maps.routes.fitBounds(routeBounds, { padding: [50, 50] });
            }
        } catch (e) {
            console.error("Routing error:", e);
        }
    }

    function updateRouteCards() {
        if (!state.routesData) return;
        
        // Safest
        const s = state.routesData.safest;
        document.getElementById('val-safe-time').innerText = `${s.eta_mins} mins`;
        document.getElementById('val-safe-dist').innerText = `${s.distance_km} km`;
        document.getElementById('val-safe-score').innerText = `${s.road_score}/100`;
        document.getElementById('val-safe-density').innerText = `${s.pothole_density} /km`;
        
        // Balanced
        const b = state.routesData.balanced;
        document.getElementById('val-bal-time').innerText = `${b.eta_mins} mins`;
        document.getElementById('val-bal-dist').innerText = `${b.distance_km} km`;
        document.getElementById('val-bal-score').innerText = `${b.road_score}/100`;
        document.getElementById('val-bal-density').innerText = `${b.pothole_density} /km`;
        
        // Fastest
        const f = state.routesData.fastest;
        document.getElementById('val-fast-time').innerText = `${f.eta_mins} mins`;
        document.getElementById('val-fast-dist').innerText = `${f.distance_km} km`;
        document.getElementById('val-fast-score').innerText = `${f.road_score}/100`;
        document.getElementById('val-fast-density').innerText = `${f.pothole_density} /km`;
        
        // Refresh vehicle durability estimation
        updateDurabilityStats();
    }

    function renderPathsOnMap() {
        if (!maps.routes || !state.routesData) return;
        
        // Clear previous polylines
        Object.keys(mapLayers.routesPaths).forEach(key => {
            if (mapLayers.routesPaths[key]) mapLayers.routesPaths[key].clearLayers();
        });

        // Loop routes options and draw polylines
        Object.keys(state.routesData).forEach(key => {
            const route = state.routesData[key];
            
            // Safest = green, balanced = yellow, fastest = red
            let color = '#ff0055';
            let weight = 3;
            let opacity = 0.55;
            
            if (key === 'safest') color = '#00ff7f';
            else if (key === 'balanced') color = '#ffb700';
            
            // Highlight selected active route path thicker
            if (key === state.activeRouteType) {
                weight = 6;
                opacity = 0.9;
            }
            
            const poly = L.polyline(route.coordinates, {
                color: color,
                weight: weight,
                opacity: opacity,
                lineCap: 'round',
                lineJoin: 'round',
                dashArray: key === 'balanced' ? '5, 8' : null
            });
            
            mapLayers.routesPaths[key].addLayer(poly);
        });

        // Add start and end point markers to routes map dynamically
        const startMarker = L.circle([state.routeStartCoords.lat, state.routeStartCoords.lng], {
            color: '#00d2ff',
            fillColor: '#00d2ff',
            fillOpacity: 0.8,
            radius: 50
        }).bindPopup(`ROUTE ORIGIN: ${state.routeStartCoords.displayName ? state.routeStartCoords.displayName.split(',')[0] : "Start"}`);
        
        const endMarker = L.circle([state.routeEndCoords.lat, state.routeEndCoords.lng], {
            color: '#ff007f',
            fillColor: '#ff007f',
            fillOpacity: 0.8,
            radius: 50
        }).bindPopup(`ROUTE TERMINAL: ${state.routeEndCoords.displayName ? state.routeEndCoords.displayName.split(',')[0] : "Destination"}`);
        
        mapLayers.routesPaths.safest.addLayer(startMarker);
        mapLayers.routesPaths.safest.addLayer(endMarker);
    }

    function updateDurabilityStats() {
        if (!state.routesData) return;
        const route = state.routesData[state.activeRouteType];
        
        // Update durability bars width & classes
        const sBar = document.getElementById('durability-suspension-bar');
        const sVal = document.getElementById('durability-suspension-val');
        const tBar = document.getElementById('durability-tire-bar');
        const tVal = document.getElementById('durability-tire-val');
        const smoothVal = document.getElementById('durability-smoothness-val');
        const safetyVal = document.getElementById('durability-safety-val');

        let suspCoeff = 12;
        let tireDecay = 8;
        let smoothScore = route.road_score;
        let indexName = "A+ (92/100)";
        
        if (state.activeRouteType === 'balanced') {
            suspCoeff = 44;
            tireDecay = 28;
            indexName = "B (74/100)";
        } else if (state.activeRouteType === 'fastest') {
            suspCoeff = 82;
            tireDecay = 64;
            indexName = "D- (38/100)";
        }

        if (sBar) {
            sBar.style.width = `${suspCoeff}%`;
            sBar.className = `d-bar-fill ${suspCoeff < 30 ? 'fill-green' : suspCoeff < 60 ? 'fill-yellow' : 'fill-red'}`;
        }
        if (sVal) {
            sVal.innerText = suspCoeff < 30 ? `OPTIMAL (${suspCoeff}%)` : suspCoeff < 60 ? `MODERATE (${suspCoeff}%)` : `HIGH STRESS (${suspCoeff}%)`;
            sVal.className = `d-val ${suspCoeff < 30 ? 'text-green' : suspCoeff < 60 ? 'text-yellow' : 'text-magenta'}`;
        }

        if (tBar) {
            tBar.style.width = `${tireDecay}%`;
            tBar.className = `d-bar-fill ${tireDecay < 15 ? 'fill-green' : tireDecay < 40 ? 'fill-yellow' : 'fill-red'}`;
        }
        if (tVal) {
            tVal.innerText = `${tireDecay}%`;
            tVal.className = `d-val ${tireDecay < 15 ? 'text-green' : tireDecay < 40 ? 'text-yellow' : 'text-magenta'}`;
        }

        if (smoothVal) smoothVal.innerText = `${smoothScore}%`;
        if (safetyVal) {
            safetyVal.innerText = indexName;
            safetyVal.className = `d-val ${suspCoeff < 30 ? 'text-green' : suspCoeff < 60 ? 'text-yellow' : 'text-magenta'}`;
        }
    }

    // Toggle selected routes alternative cards
    document.querySelectorAll('.route-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('.route-card').forEach(c => c.classList.remove('active-card'));
            card.classList.add('active-card');
            
            state.activeRouteType = card.getAttribute('data-route');
            
            // Re-render map path thicknesses and refresh stats
            renderPathsOnMap();
            updateDurabilityStats();
        });
    });

    // Form submission calculation trigger
    document.getElementById('btn-calc-route').addEventListener('click', () => {
        calculateRoutes();
    });

    /* ==========================================================================
       DRIVER VOICE ALERT SIMULATION ENGINE (Text-To-Speech)
       ========================================================================== */
    
    const playSimBtn = document.getElementById('btn-toggle-sim');
    const playSimText = document.getElementById('sim-btn-text');
    const playSimIcon = document.getElementById('sim-play-icon');
    const warningBox = document.getElementById('proximity-warning-box');
    const warningSubText = document.getElementById('alert-sub-message');

    // Synthesis controllers
    const voiceToggle = document.getElementById('voice-toggle');
    const btnFemale = document.getElementById('btn-voice-female');
    const btnMale = document.getElementById('btn-voice-male');
    const volSlider = document.getElementById('voice-volume');

    if (voiceToggle) {
        voiceToggle.addEventListener('change', () => {
            state.voiceEnabled = voiceToggle.checked;
        });
    }

    if (btnFemale) {
        btnFemale.addEventListener('click', () => {
            btnMale.classList.remove('active');
            btnFemale.classList.add('active');
            state.voiceGender = 'female';
        });
    }

    if (btnMale) {
        btnMale.addEventListener('click', () => {
            btnFemale.classList.remove('active');
            btnMale.classList.add('active');
            state.voiceGender = 'male';
        });
    }

    if (volSlider) {
        volSlider.addEventListener('input', () => {
            state.voiceVolume = parseFloat(volSlider.value);
        });
    }

    if (playSimBtn) {
        playSimBtn.addEventListener('click', () => {
            if (state.simulating) {
                stopRouteSimulation();
            } else {
                startRouteSimulation();
            }
        });
    }

    function startRouteSimulation() {
        if (!state.routesData) return;
        
        state.simulating = true;
        if (playSimText) playSimText.innerText = "Stop Telemetry Simulation";
        if (playSimIcon) playSimIcon.setAttribute('data-lucide', 'square');
        lucide.createIcons();
        
        // Extract polyline coordinate nodes
        const activeRoute = state.routesData[state.activeRouteType];
        state.simCoords = activeRoute.coordinates;
        state.simIndex = 0;
        state.alertsSpoken.clear(); // reset warnings history
        
        // Remove old marker
        if (state.simMarker) {
            maps.routes.removeLayer(state.simMarker);
        }
        
        // Add car cursor marker
        state.simMarker = L.circleMarker(state.simCoords[0], {
            color: '#00d2ff',
            fillColor: '#040405',
            fillOpacity: 1,
            weight: 3,
            radius: 8
        }).addTo(maps.routes);
        
        // Start tracking timer loop (simulate vehicle movement)
        state.simulationInterval = setInterval(() => {
            if (state.simIndex >= state.simCoords.length) {
                stopRouteSimulation();
                return;
            }
            
            const currCoord = state.simCoords[state.simIndex];
            state.simMarker.setLatLng(currCoord);
            maps.routes.panTo(currCoord);
            
            // Trigger API warning check
            checkProximityAlerts(currCoord[0], currCoord[1]);
            
            state.simIndex++;
        }, 800); // speed increment
    }

    function stopRouteSimulation() {
        state.simulating = false;
        if (playSimText) playSimText.innerText = "Start Telemetry Simulation";
        if (playSimIcon) playSimIcon.setAttribute('data-lucide', 'play');
        lucide.createIcons();
        
        if (state.simulationInterval) {
            clearInterval(state.simulationInterval);
        }
        
        if (state.simMarker) {
            maps.routes.removeLayer(state.simMarker);
            state.simMarker = null;
        }

        // Hide alerts
        if (warningBox) warningBox.classList.add('inactive');
    }

    // Helper to calculate Haversine distance on client
    function getDistanceMeters(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const phi1 = lat1 * Math.PI / 180;
        const phi2 = lat2 * Math.PI / 180;
        const deltaPhi = (lat2 - lat1) * Math.PI / 180;
        const deltaLambda = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
                  Math.cos(phi1) * Math.cos(phi2) *
                  Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    async function checkProximityAlerts(lat, lng) {
        try {
            // Find closest critical or high risk pothole from current memory state
            let closestHazard = null;
            let minDistance = Infinity;

            state.potholes.forEach(ph => {
                if (ph.severity === 'Critical' || ph.severity === 'High Risk') {
                    const dist = getDistanceMeters(lat, lng, ph.lat, ph.lng);
                    if (dist < minDistance) {
                        minDistance = dist;
                        closestHazard = ph;
                    }
                }
            });

            if (closestHazard && minDistance <= 200.0) {
                // Show warning HUD
                if (warningBox) warningBox.classList.remove('inactive');
                if (warningSubText) warningSubText.innerText = `${closestHazard.severity.toUpperCase()} HAZARD DETECTED ${Math.round(minDistance)} METERS AHEAD`;
                
                // Voice warn check - fetch voice instructions from API
                if (state.voiceEnabled && !state.alertsSpoken.has(closestHazard.id)) {
                    const voiceResp = await fetch(`/api/copilot/generate-voice-alert?hazard_type=${closestHazard.severity}&distance=${Math.round(minDistance)}&street_name=${encodeURIComponent(closestHazard.street)}`);
                    const voiceData = await voiceResp.json();
                    if (voiceData && voiceData.text_to_speak) {
                        speakVocalAlert(voiceData.text_to_speak);
                        state.alertsSpoken.add(closestHazard.id);
                    }
                }
            } else {
                // Dim warning HUD
                if (warningBox) warningBox.classList.add('inactive');
            }
        } catch (e) {
            console.error("Proximity evaluation error:", e);
        }
    }

    function speakVocalAlert(text) {
        if (!state.voiceSynth) return;
        
        // Stop any ongoing speech immediately
        state.voiceSynth.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.volume = state.voiceVolume;
        utterance.rate = 1.05; // Slightly faster for OS command tone
        
        // Choose voice pitch/accent
        const voices = state.voiceSynth.getVoices();
        if (state.voiceGender === 'male') {
            // Find typical male voice index
            utterance.pitch = 0.85; 
        } else {
            utterance.pitch = 1.15; // Female alert pitch
        }
        
        state.voiceSynth.speak(utterance);
    }

    /* ==========================================================================
       PREDICTIVE ANALYTICS GRAPH (Custom SVGs)
       ========================================================================== */
    
    // Select tabs weather factor
    document.querySelectorAll('.btn-weather-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.btn-weather-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            state.weatherTab = tab.getAttribute('data-weather');
            renderWeatherCorrelationChart();
        });
    });

    async function renderSVGCharts() {
        try {
            const response = await fetch('/predictive-analysis', { method: 'POST' });
            const data = await response.json();
            
            // Plot trend lines
            plotTrendLines(data);
            
            // Plot weather overlay correlation
            renderWeatherCorrelationChart(data);
        } catch (e) {
            console.error("Analytics chart render error:", e);
        }
    }

    function plotTrendLines(data) {
        const svg = document.getElementById('svg-trend-chart');
        if (!svg) return;
        
        const w = 600;
        const h = 240;
        const padX = 50;
        const padY = 30;
        const plotW = w - padX - 50;
        const plotH = h - padY - 60;
        
        const timeline = data.timeline;
        const steps = timeline.length;
        
        // Clear old items
        document.getElementById('chart-x-labels').innerHTML = '';
        document.getElementById('chart-dots-corridors').innerHTML = '';
        document.getElementById('chart-dots-suburban').innerHTML = '';
        document.getElementById('chart-dots-express').innerHTML = '';

        // Draw X Axis labels
        timeline.forEach((lbl, i) => {
            const x = padX + (i / (steps - 1)) * plotW;
            const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
            text.setAttribute("x", x);
            text.setAttribute("y", h - 25);
            text.setAttribute("fill", "rgba(255,255,255,0.4)");
            text.setAttribute("font-size", "10");
            text.setAttribute("text-anchor", "middle");
            text.textContent = lbl;
            document.getElementById('chart-x-labels').appendChild(text);
        });

        // Helper to compile paths
        function buildSVGPath(pointsArray) {
            let pathD = "";
            pointsArray.forEach((val, i) => {
                const x = padX + (i / (steps - 1)) * plotW;
                // invert y: 100 health is at top (padY), 0 is at bottom (padY + plotH)
                const y = padY + plotH - ((val - 10) / 90) * plotH;
                
                if (i === 0) pathD += `M ${x} ${y}`;
                else pathD += ` L ${x} ${y}`;
            } );
            return pathD;
        }

        // Render path lines
        document.getElementById('chart-path-corridors').setAttribute("d", buildSVGPath(data.trends.corridors));
        document.getElementById('chart-path-suburban').setAttribute("d", buildSVGPath(data.trends.suburban));
        document.getElementById('chart-path-express').setAttribute("d", buildSVGPath(data.trends.express));
        
        // Add nodes dots details
        function appendDots(pointsArray, containerId, color) {
            const container = document.getElementById(containerId);
            pointsArray.forEach((val, i) => {
                const x = padX + (i / (steps - 1)) * plotW;
                const y = padY + plotH - ((val - 10) / 90) * plotH;
                
                const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                circle.setAttribute("cx", x);
                circle.setAttribute("cy", y);
                circle.setAttribute("r", "4");
                circle.setAttribute("fill", color);
                circle.setAttribute("stroke", "#040405");
                circle.setAttribute("stroke-width", "1.5");
                
                // Add pop tooltip hover
                const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
                title.textContent = `Score: ${val}/100`;
                circle.appendChild(title);
                
                container.appendChild(circle);
            });
        }
        
        appendDots(data.trends.corridors, 'chart-dots-corridors', '#ff007f');
        appendDots(data.trends.suburban, 'chart-dots-suburban', '#ffb700');
        appendDots(data.trends.express, 'chart-dots-express', '#00d2ff');
    }

    async function renderWeatherCorrelationChart(loadedData = null) {
        let data = loadedData;
        if (!data) {
            try {
                const response = await fetch('/predictive-analysis', { method: 'POST' });
                data = await response.json();
            } catch (e) {
                return;
            }
        }

        const svg = document.getElementById('svg-weather-chart');
        if (!svg) return;
        
        const w = 300;
        const h = 120;
        const padX = 20;
        const padY = 15;
        const plotW = w - padX - 20;
        const plotH = h - padY - 20;

        const timeline = data.timeline;
        const steps = timeline.length;

        // Clear axes
        document.getElementById('weather-x-axis').innerHTML = '';

        // Select correlation indicators
        const explanationText = document.getElementById('weather-explanation-text');
        
        let weatherSeries = [];
        let strokeColor = "rgba(0, 210, 255, 0.25)";
        
        if (state.weatherTab === 'rain') {
            weatherSeries = data.environmental.rainfall;
            strokeColor = "rgba(0, 210, 255, 0.4)";
            if (explanationText) explanationText.innerText = data.correlations[0];
        } else {
            weatherSeries = data.environmental.temperature;
            strokeColor = "rgba(255, 183, 0, 0.4)";
            if (explanationText) explanationText.innerText = data.correlations[1];
        }

        // Find max weather value for scaling
        const maxWeatherVal = Math.max(...weatherSeries);
        
        // Compile weather background graph bars
        let weatherPathD = "";
        weatherSeries.forEach((val, i) => {
            const x = padX + (i / (steps - 1)) * plotW;
            const y = padY + plotH - (val / maxWeatherVal) * plotH;
            
            if (i === 0) weatherPathD += `M ${x} ${padY + plotH} L ${x} ${y}`;
            else weatherPathD += ` L ${x} ${y}`;
        });
        // Close polygon to fill background grid nicely
        const startX = padX;
        const endX = padX + plotW;
        weatherPathD += ` L ${endX} ${padY+plotH} Z`;
        
        const fillBar = document.getElementById('weather-curve-bar');
        fillBar.setAttribute("d", weatherPathD);
        fillBar.setAttribute("fill", state.weatherTab === 'rain' ? 'rgba(0, 210, 255, 0.08)' : 'rgba(255, 183, 0, 0.08)');
        fillBar.setAttribute("stroke", strokeColor);

        // Compile pothole growth overlay curve (Red line)
        // Pothole growth correlates with degradation rates, let's plot inverse of corridor decay
        let growthD = "";
        data.trends.corridors.forEach((val, i) => {
            const x = padX + (i / (steps - 1)) * plotW;
            // Map 100 health -> 0 growth, 20 health -> max growth height
            const growthScore = 100 - val;
            const y = padY + plotH - (growthScore / 80) * plotH;
            
            if (i === 0) growthD += `M ${x} ${y}`;
            else growthD += ` L ${x} ${y}`;
        });
        
        document.getElementById('weather-pothole-growth').setAttribute("d", growthD);
        
        // Draw X axis timeline ticks
        timeline.forEach((lbl, i) => {
            if (i % 2 === 0) { // draw alternate labels to save space
                const x = padX + (i / (steps - 1)) * plotW;
                const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
                text.setAttribute("x", x);
                text.setAttribute("y", h - 4);
                text.setAttribute("fill", "rgba(255,255,255,0.3)");
                text.setAttribute("font-size", "8");
                text.setAttribute("text-anchor", "middle");
                text.textContent = lbl;
                document.getElementById('weather-x-axis').appendChild(text);
            }
        });
    }

    /* ==========================================================================
       MUNICIPAL PRIORITY DASHBOARD
       ========================================================================== */
    
    async function populateMunicipalViews() {
        try {
            const response = await fetch('/potholes');
            const data = await response.json();
            
            // Sort potholes by health scores ascending (worst road first)
            const sortedPotholes = [...data].sort((a, b) => a.score - b.score);
            
            // Render priority roads list
            renderPriorityQueue(sortedPotholes);
            
            // Update dashboard statistics
            const critCount = data.filter(p => p.severity === 'Critical').length;
            document.getElementById('gov-analyzed-total').innerText = data.length;
            document.getElementById('gov-critical-total').innerText = critCount;
            document.getElementById('gov-complaints-total').innerText = data.length + 14; // pre-seeded citizen complaints count
            
        } catch (e) {
            console.error("Dashboard queue build error:", e);
        }
    }

    function renderPriorityQueue(sortedPotholes) {
        const queueContainer = document.getElementById('priority-roads-list');
        if (!queueContainer) return;
        
        queueContainer.innerHTML = '';
        
        const countBadge = document.getElementById('dispatch-queue-badge');
        if (countBadge) countBadge.innerText = `${sortedPotholes.length} SEGMENTS`;
        
        if (sortedPotholes.length === 0) {
            queueContainer.innerHTML = '<div class="critical-item-loader">No active hazards logged in city database.</div>';
            return;
        }

        // Display Top 10 critical roads requiring urgent repair
        const displayLimit = Math.min(sortedPotholes.length, 10);
        for (let i = 0; i < displayLimit; i++) {
            const ph = sortedPotholes[i];
            
            let color = '#ff0055';
            if (ph.severity === 'High Risk') color = '#ff007f';
            else if (ph.severity === 'Moderate') color = '#ffb700';
            else if (ph.severity === 'Stable') color = '#00ff7f';
            
            const item = document.createElement('div');
            item.className = 'critical-road-item';
            item.style.cursor = 'default';
            item.innerHTML = `
                <div class="flex-center">
                    <span class="cr-rank">#${i+1}</span>
                    <div class="cr-details">
                        <span class="cr-street">${ph.street}</span>
                        <span class="cr-meta">ID: ${ph.id} // Status: <strong style="color:${ph.status === 'Dispatched' ? '#00d2ff' : color}">${ph.status || 'Active'}</strong></span>
                    </div>
                </div>
                <div class="cr-metrics" style="display:flex; align-items:center; gap:12px;">
                    <div style="text-align:right;">
                        <span class="cr-severity" style="color: ${color};">${ph.severity.toUpperCase()}</span>
                        <div class="cr-score">HEALTH: ${ph.score}/100</div>
                    </div>
                    ${ph.status !== 'Dispatched' ? `<button class="cta-pill secondary small dispatch-btn" data-id="${ph.id}" style="padding:4px 8px; font-size:10px; height:auto; line-height:1.2;">Dispatch</button>` : `<button class="cta-pill small" disabled style="padding:4px 8px; font-size:10px; height:auto; opacity:0.5; cursor:not-allowed; border-color:rgba(255,255,255,0.05); color:#71717a;">Dispatched</button>`}
                </div>
            `;
            queueContainer.appendChild(item);
        }

        // Attach event listeners for the dispatch buttons
        queueContainer.querySelectorAll('.dispatch-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const hid = btn.getAttribute('data-id');
                btn.innerText = "Sending...";
                btn.disabled = true;
                try {
                    const response = await fetch(`/api/dashboard/dispatch-repair/${hid}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: "Dispatched" })
                    });
                    const res = await response.json();
                    if (res.status === 'success') {
                        await fetchPotholes();
                        populateMunicipalViews();
                    }
                } catch (err) {
                    console.error("Dispatch failure:", err);
                    btn.innerText = "Error";
                    btn.disabled = false;
                }
            });
        });
    }

    // Social Auto Blast Dropdown Population
    function populateBlastSelector() {
        const selector = document.getElementById('blast-road-selector');
        if (!selector) return;
        
        // Save current selection value
        const currentSelection = selector.value;
        
        selector.innerHTML = '<option value="">Select Priority Segment</option>';
        
        // Find critical segments
        const criticalRoads = state.potholes.filter(p => p.severity === 'Critical' || p.severity === 'High Risk');
        
        criticalRoads.forEach(ph => {
            const opt = document.createElement('option');
            opt.value = ph.id;
            opt.textContent = `${ph.id} - ${ph.street} (Sev: ${ph.severity})`;
            selector.appendChild(opt);
        });
        
        // Restore select
        if (currentSelection) selector.value = currentSelection;
    }

    // Selector Change Event: Update Tweet Content Preview dynamically
    const blastRoadSelector = document.getElementById('blast-road-selector');
    const mockTweet = document.getElementById('mock-tweet-text');

    if (blastRoadSelector) {
        blastRoadSelector.addEventListener('change', () => {
            const selectedId = blastRoadSelector.value;
            if (!selectedId) {
                if (mockTweet) mockTweet.innerText = "Select a critical road segment above to compile an emergency alert broadcast card.";
                return;
            }
            
            const targetRoad = state.potholes.find(p => p.id === selectedId);
            if (targetRoad) {
                const tweetMsg = `⚠️ Critical road degradation detected near ${targetRoad.street}.\n\nCitizens are advised to drive cautiously.\n\nRoadSense AI has flagged this zone for urgent municipal repair. [ID: ${targetRoad.id}]`;
                if (mockTweet) mockTweet.innerText = tweetMsg;
            }
        });
    }

    // Blast Button Click Simulation
    const blastBtn = document.getElementById('btn-trigger-blast');
    const blastSuccessEl = document.getElementById('blast-success-banner');
    const blastTxt = document.getElementById('blast-success-txt');
    const blastSpinner = document.getElementById('blast-spinner');

    if (blastBtn) {
        blastBtn.addEventListener('click', async () => {
            const selectedId = blastRoadSelector.value;
            if (!selectedId) {
                alert("Please select a critical road segment to broadcast.");
                return;
            }

            const targetRoad = state.potholes.find(p => p.id === selectedId);
            if (!targetRoad) return;

            // Trigger loading state overlay
            if (blastSuccessEl) blastSuccessEl.classList.remove('inactive');
            if (blastSpinner) blastSpinner.style.display = 'block';
            if (blastTxt) blastTxt.innerText = "TRANSMITTING PUBLIC EMBARGO BROADCASTS...";
            
            try {
                const response = await fetch('/api/notifications/broadcast-advisory', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        target_sector_street: targetRoad.street,
                        health_index: targetRoad.score
                    })
                });
                const res = await response.json();
                
                if (blastSpinner) blastSpinner.style.display = 'none';
                
                if (res.status === 'success') {
                    if (blastTxt) blastTxt.innerText = "TWILIO SMS BROADCAST SENT SUCCESSFULLY ✓";
                } else if (res.status === 'simulated') {
                    if (blastTxt) blastTxt.innerText = "SMS SIMULATED: NO CREDENTIALS IN .ENV ✓";
                } else {
                    if (blastTxt) blastTxt.innerText = "BROADCAST COMPLETED WITH WARNINGS ✓";
                }
            } catch (err) {
                console.error("Advisory broadcast error:", err);
                if (blastSpinner) blastSpinner.style.display = 'none';
                if (blastTxt) blastTxt.innerText = "BROADCAST TRANSMISSION CORE ERROR ✗";
            }

            // Close banner after confirmation delay
            setTimeout(() => {
                if (blastSuccessEl) blastSuccessEl.classList.add('inactive');
            }, 3000);
        });
    }

    /* ==========================================================================
       KARNATAKA ROAD SENSE LOGIC
       ========================================================================== */

    async function initKarnatakaPage() {
        fetchKarnatakaInventory();
        
        const searchBtn = document.getElementById('btn-karnataka-search');
        if (searchBtn && !searchBtn.hasAttribute('data-listener')) {
            searchBtn.addEventListener('click', searchKarnatakaRoad);
            searchBtn.setAttribute('data-listener', 'true');
        }
    }

    async function fetchKarnatakaInventory() {
        const listEl = document.getElementById('karnataka-inventory-list');
        const countEl = document.getElementById('karnataka-inventory-count');
        if (!listEl) return;

        try {
            const response = await fetch('/api/karnataka/roads');
            const roads = await response.json();

            if (countEl) countEl.innerText = `${roads.length} RECORDS`;

            if (roads.length === 0) {
                listEl.innerHTML = '<div class="inventory-empty">No road telemetry found in Karnataka bounds.</div>';
                return;
            }

            listEl.innerHTML = '';
            roads.forEach(ph => {
                const item = document.createElement('div');
                item.className = `inventory-item border-${ph.severity === 'Critical' ? 'red' : ph.severity === 'High Risk' ? 'magenta' : 'yellow'}`;
                item.innerHTML = `
                    <div class="f-header">
                        <span class="f-street">${ph.street}</span>
                        <span class="f-probability text-${ph.severity === 'Critical' ? 'magenta' : 'yellow'}">${ph.score}/100 INDEX</span>
                    </div>
                    <div class="f-desc">Status: ${ph.severity.toUpperCase()} // ID: ${ph.id} // Coordinates: ${ph.lat.toFixed(4)}, ${ph.lng.toFixed(4)}</div>
                `;
                item.addEventListener('click', () => {
                    document.getElementById('karnataka-road-search').value = ph.street;
                    searchKarnatakaRoad();
                });
                listEl.appendChild(item);
            });
        } catch (err) {
            console.error("Karnataka inventory fetch error:", err);
            listEl.innerHTML = '<div class="inventory-error">Error retrieving regional telemetry.</div>';
        }
    }

    async function searchKarnatakaRoad() {
        const query = document.getElementById('karnataka-road-search').value;
        const resultCard = document.getElementById('karnataka-result-card');
        const nameEl = document.getElementById('karnataka-road-name');
        const scoreEl = document.getElementById('karnataka-health-score');
        const labelEl = document.getElementById('karnataka-health-label');
        const severityEl = document.getElementById('karnataka-severity');
        const scanEl = document.getElementById('karnataka-last-scan');
        const strokeEl = document.getElementById('karnataka-health-stroke');

        if (!query) return;

        // Visual feedback
        if (resultCard) resultCard.classList.remove('inactive');
        if (labelEl) labelEl.innerText = "Analyzing...";

        try {
            // Step 1: Geocode restricted to Karnataka
            const coords = await geocodeAddress(query);
            
            // Step 2: Fetch health score from backend
            const response = await fetch('/api/karnataka/road-score', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lat: coords.lat,
                    lng: coords.lng,
                    street: coords.displayName || query
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || error.error || "Analysis failed");
            }

            const result = await response.json();

            // Step 3: Update UI
            if (nameEl) nameEl.innerText = result.street.split(',')[0].toUpperCase();
            if (scoreEl) scoreEl.innerText = result.score;
            if (severityEl) {
                severityEl.innerText = result.severity.toUpperCase();
                severityEl.className = `metric-num ${result.score > 75 ? 'text-green' : result.score > 50 ? 'text-yellow' : 'text-magenta'}`;
            }
            if (labelEl) labelEl.innerText = result.in_db ? "Active Telemetry" : "Simulated Intelligence";
            if (scanEl) scanEl.innerText = result.timestamp;

            // Update radial progress
            if (strokeEl) {
                const radius = 50;
                const circumference = 2 * Math.PI * radius;
                const offset = circumference - (result.score / 100) * circumference;
                strokeEl.style.strokeDasharray = `${circumference} ${circumference}`;
                strokeEl.style.strokeDashoffset = offset;
                strokeEl.style.stroke = result.score > 75 ? '#00ff7f' : result.score > 50 ? '#ffb700' : '#ff0055';
            }

        } catch (err) {
            console.error("Karnataka search error:", err);
            if (labelEl) labelEl.innerText = "Error: " + err.message;
            if (nameEl) nameEl.innerText = "SCAN FAILED";
        }
    }

    /* ==========================================================================
       HELPERS & ALGORITHMS
       ========================================================================== */
    
    function randomRange(min, max) {
        return Math.random() * (max - min) + min;
    }

    function randomRangeInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function randomChoice(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    /* ==========================================================================
       APP LAUNCH SEQUENCE
       ========================================================================== */
    
    function init() {
        initBackgroundParticles();
        initLandingMap();
        initGeolocation();
        
        // Fetch initially seeded potholes
        fetchPotholes();
        
        // Support direct hash loading
        const initialHash = window.location.hash.substring(1);
        const mappedHash = initialHash === 'home' ? 'landing' : initialHash;
        if (['landing', 'lab', 'routes', 'karnataka', 'analytics', 'dashboard'].includes(mappedHash)) {
            navigateToPage(mappedHash);
        } else {
            navigateToPage('landing');
        }
    }
    
    init();
});
