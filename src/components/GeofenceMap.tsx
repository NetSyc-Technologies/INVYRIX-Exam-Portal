import { useEffect, useRef, useState } from 'react';
import { GeofenceConfig } from '../types';

interface GeofenceMapProps {
    initialPoints?: GeofenceConfig | { lat: number; lng: number }[];
    onChange: (config: GeofenceConfig) => void;
}

declare global {
    interface Window {
        L: any;
    }
}

export default function GeofenceMap({ initialPoints, onChange }: GeofenceMapProps) {
    const mapRef = useRef<any>(null);
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const [leafletLoaded, setLeafletLoaded] = useState(false);

    // Parse initial settings with backward compatibility
    const parsedInitial = initialPoints
        ? (Array.isArray(initialPoints) 
            ? { type: 'polygon' as const, points: initialPoints }
            : initialPoints)
        : null;

    const [geofenceType, setGeofenceType] = useState<'circle' | 'polygon'>(
        parsedInitial?.type || 'circle'
    );
    const [points, setPoints] = useState<{ lat: number; lng: number }[]>(
        parsedInitial?.type === 'polygon' ? parsedInitial.points : []
    );
    const [center, setCenter] = useState<{ lat: number; lng: number } | null>(
        parsedInitial?.type === 'circle' ? parsedInitial.center : null
    );
    const [radius, setRadius] = useState<number>(
        parsedInitial?.type === 'circle' ? parsedInitial.radius : 100
    );

    const [searchQuery, setSearchQuery] = useState('');
    const [searching, setSearching] = useState(false);

    const markersRef = useRef<any[]>([]);
    const shapeRef = useRef<any>(null); // holds circle or polygon Leaflet layer

    // Load Leaflet CDN
    useEffect(() => {
        if (window.L) {
            setLeafletLoaded(true);
            return;
        }

        const cssLink = document.createElement('link');
        cssLink.rel = 'stylesheet';
        cssLink.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(cssLink);

        const jsScript = document.createElement('script');
        jsScript.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        jsScript.onload = () => {
            setLeafletLoaded(true);
        };
        document.body.appendChild(jsScript);
    }, []);

    // Initialize Map and Layer Controls
    useEffect(() => {
        if (!leafletLoaded || !mapContainerRef.current || mapRef.current) return;

        const L = window.L;

        // Neutral overview until an institute selects its exam location.
        let initialCenter = [20, 0];
        if (parsedInitial) {
            if (parsedInitial.type === 'circle') {
                initialCenter = [parsedInitial.center.lat, parsedInitial.center.lng];
            } else if (parsedInitial.type === 'polygon' && parsedInitial.points.length > 0) {
                initialCenter = [parsedInitial.points[0].lat, parsedInitial.points[0].lng];
            }
        }

        const map = L.map(mapContainerRef.current).setView(initialCenter, parsedInitial ? 16 : 2);
        mapRef.current = map;

        // Define Base Layers
        const streetTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors'
        });

        const satelliteTiles = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS'
        });

        streetTiles.addTo(map);

        const baseMaps = {
            "🗺️ Street View": streetTiles,
            "🛰️ Satellite View": satelliteTiles
        };

        // Standard layer control
        L.control.layers(baseMaps).addTo(map);

        // Click handler on map
        map.on('click', (e: any) => {
            const { lat, lng } = e.latlng;
            handleMapClick(lat, lng);
        });

        return () => {
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
                markersRef.current = [];
                shapeRef.current = null;
            }
        };
    }, [leafletLoaded]);

    // Draw layers when state changes
    useEffect(() => {
        if (!leafletLoaded || !mapRef.current) return;
        drawGeofence();
    }, [leafletLoaded, geofenceType, points, center, radius]);

    const handleMapClick = (lat: number, lng: number) => {
        if (geofenceType === 'circle') {
            // Set single center marker
            setCenter({ lat, lng });
            const config: GeofenceConfig = { type: 'circle', center: { lat, lng }, radius };
            onChange(config);
        } else {
            // Add up to 4 polygon points
            setPoints((prev) => {
                if (prev.length >= 4) {
                    alert('You have already selected 4 points. Please clear to redraw.');
                    return prev;
                }
                const newPoints = [...prev, { lat, lng }];
                if (newPoints.length === 4) {
                    const config: GeofenceConfig = { type: 'polygon', points: newPoints };
                    onChange(config);
                }
                return newPoints;
            });
        }
    };

    const drawGeofence = () => {
        const L = window.L;
        const map = mapRef.current;

        // Clear existing markers
        markersRef.current.forEach(marker => map.removeLayer(marker));
        markersRef.current = [];

        // Clear existing shapes
        if (shapeRef.current) {
            map.removeLayer(shapeRef.current);
            shapeRef.current = null;
        }

        if (geofenceType === 'circle' && center) {
            // Draw center marker
            const marker = L.marker([center.lat, center.lng]).addTo(map);
            markersRef.current.push(marker);

            // Draw circle shape
            const circle = L.circle([center.lat, center.lng], {
                radius: radius,
                color: '#3b82f6',
                fillColor: '#3b82f6',
                fillOpacity: 0.15,
                weight: 2
            }).addTo(map);
            shapeRef.current = circle;
        } else if (geofenceType === 'polygon' && points.length > 0) {
            // Draw point markers
            points.forEach((p) => {
                const marker = L.marker([p.lat, p.lng]).addTo(map);
                markersRef.current.push(marker);
            });

            // Draw polygon shape if we have at least 3 points
            if (points.length >= 3) {
                const polygon = L.polygon(points.map(p => [p.lat, p.lng]), {
                    color: '#10b981',
                    fillColor: '#10b981',
                    fillOpacity: 0.15,
                    weight: 2
                }).addTo(map);
                shapeRef.current = polygon;
            }
        }
    };

    const handleRadiusChange = (val: number) => {
        setRadius(val);
        if (center) {
            onChange({ type: 'circle', center, radius: val });
        }
    };

    const handleClear = () => {
        setPoints([]);
        setCenter(null);
        if (mapRef.current && shapeRef.current) {
            mapRef.current.removeLayer(shapeRef.current);
            shapeRef.current = null;
        }
        markersRef.current.forEach(m => mapRef.current.removeLayer(m));
        markersRef.current = [];
    };

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!searchQuery.trim() || !mapRef.current) return;

        setSearching(true);
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=1`);
            const data = await res.json();
            if (data && data.length > 0) {
                const { lat, lon } = data[0];
                mapRef.current.setView([parseFloat(lat), parseFloat(lon)], 16);
            } else {
                alert('Location not found. Please check spelling.');
            }
        } catch (err) {
            console.error('Error searching address:', err);
        } finally {
            setSearching(false);
        }
    };

    const handleLocateMe = () => {
        if (!mapRef.current) return;
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const { latitude, longitude } = pos.coords;
                mapRef.current.setView([latitude, longitude], 17);
            },
            (err) => {
                alert(`Locate failed: ${err.message}`);
            }
        );
    };

    return (
        <div>
            {/* Search and Locate toolbar */}
            <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', marginBottom: 'var(--space-md)' }}>
                <form onSubmit={handleSearch} style={{ display: 'flex', gap: 'var(--space-xs)', flex: 1, minWidth: '250px' }}>
                    <input
                        type="text"
                        className="input"
                        placeholder="Search address (e.g. your institute, airport...)"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{ flex: 1, padding: '6px 12px', fontSize: '0.85rem' }}
                    />
                    <button type="submit" className="btn btn-secondary btn-sm" disabled={searching}>
                        {searching ? '...' : '🔍'} Search
                    </button>
                </form>
                <button type="button" className="btn btn-secondary btn-sm" onClick={handleLocateMe} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    🎯 Locate Me
                </button>
            </div>

            {/* Mode Toggle */}
            <div style={{ display: 'flex', gap: 'var(--space-xs)', marginBottom: 'var(--space-md)' }}>
                <button
                    type="button"
                    className={`btn btn-sm ${geofenceType === 'circle' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => {
                        setGeofenceType('circle');
                        handleClear();
                    }}
                >
                    ⭕ Circle Geofence (Easy)
                </button>
                <button
                    type="button"
                    className={`btn btn-sm ${geofenceType === 'polygon' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => {
                        setGeofenceType('polygon');
                        handleClear();
                    }}
                >
                    ⬡ Polygon Geofence (4 Points)
                </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-sm)' }}>
                <span className="text-secondary text-sm">
                    {geofenceType === 'circle' ? (
                        center 
                            ? 'Center coordinates defined! Use slider to resize area.' 
                            : 'Click on the map to set the geofence center point.'
                    ) : (
                        points.length < 4 
                            ? `Click on the map to place boundary points (${points.length}/4 points)` 
                            : 'Geofence area defined! Click Clear to redraw.'
                    )}
                </span>
                {(center || points.length > 0) && (
                    <button 
                        type="button" 
                        className="btn btn-secondary btn-sm" 
                        onClick={handleClear}
                        style={{ padding: '2px 8px', fontSize: '0.8rem' }}
                    >
                        Reset Boundary
                    </button>
                )}
            </div>

            {/* Map Canvas */}
            <div 
                ref={mapContainerRef} 
                style={{ 
                    height: '350px', 
                    borderRadius: 'var(--radius-lg)', 
                    border: '1px solid var(--border-color)', 
                    background: '#f8fafc' 
                }} 
            />

            {/* Circle Config Panel */}
            {geofenceType === 'circle' && center && (
                <div style={{ marginTop: 'var(--space-md)', background: 'var(--bg-surface)', padding: 'var(--space-md)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Geofence Radius: {radius} meters</span>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            Center: {center.lat.toFixed(5)}, {center.lng.toFixed(5)}
                        </span>
                    </div>
                    <input
                        type="range"
                        min={10}
                        max={1000}
                        step={10}
                        value={radius}
                        onChange={(e) => handleRadiusChange(parseInt(e.target.value))}
                        style={{ width: '100%', accentColor: 'var(--primary)', cursor: 'pointer' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        <span>10m</span>
                        <span>500m</span>
                        <span>1000m</span>
                    </div>
                </div>
            )}

            {/* Polygon Config Panel */}
            {geofenceType === 'polygon' && points.length > 0 && (
                <div style={{ marginTop: 'var(--space-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    <strong>Selected Boundary Vertices:</strong>
                    <ul style={{ margin: '4px 0 0 0', paddingLeft: 'var(--space-md)' }}>
                        {points.map((p, idx) => (
                            <li key={idx}>Vertex {idx + 1}: {p.lat.toFixed(6)}, {p.lng.toFixed(6)}</li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
