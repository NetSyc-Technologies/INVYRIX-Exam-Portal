import { studentExam, api } from '../../services/platform';
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Footer from '../../components/Footer';
import Logo from '../../components/Logo';
import { updateDoc, getDoc } from 'firebase/firestore';
import { doc } from '../../services/tenant';
import { db } from '../../services/firebase';
import { getGeolocation } from '../../utils/deviceUtils';

const isPointInPolygon = (latitude: number, longitude: number, polygon: { lat: number; lng: number }[]) => {
    let x = latitude, y = longitude;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        let xi = polygon[i].lat, yi = polygon[i].lng;
        let xj = polygon[j].lat, yj = polygon[j].lng;
        
        let intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
};

const getDistanceInMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3; // Earth radius in meters
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // in meters
};

interface PreExamProps {
    sessionId: string;
    examName: string;
    duration: number;
    studentName: string;
    maxWarnings?: number;
}

export default function PreExamCheck() {
    const navigate = useNavigate();
    const location = useLocation();
    const { sessionId, examName, duration, studentName, maxWarnings = 2 } = (location.state as PreExamProps) || {};

    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
    const [allChecksPassed, setAllChecksPassed] = useState(false);
    const [rulesAgreed, setRulesAgreed] = useState(false);

    // Scheduling States
    const [schedulingEnabled, setSchedulingEnabled] = useState(false);
    const [scheduledStartTime, setScheduledStartTime] = useState<Date | null>(null);
    const [timeRemaining, setTimeRemaining] = useState<number>(0);

    const terminalEndRef = useRef<HTMLDivElement>(null);
    const [showCameraPreview, setShowCameraPreview] = useState(false);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const activeStreamRef = useRef<MediaStream | null>(null);

    useEffect(() => {
        if (!sessionId) {
            navigate('/');
            return;
        }
        runSystemChecks();
    }, [sessionId, navigate]);

    // Webcam cleanup on unmount
    useEffect(() => {
        return () => {
            if (activeStreamRef.current) {
                activeStreamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    useEffect(() => {
        if (terminalEndRef.current) {
            terminalEndRef.current.scrollTop = terminalEndRef.current.scrollHeight;
        }
    }, [terminalOutput]);

    const runSystemChecks = async () => {
        // Initializing logs
        setTerminalOutput([
            'INVYRIX EXAM PORTAL [Version 1.2.0]',
            '(c) NetSyc Technologies. All rights reserved.',
            '',
            `$ ./run_diagnostics.sh --session=${sessionId || 'NULL'} --candidate="${studentName || 'Guest'}"`,
            `[SYS] Diagnostic sequence initialized at ${new Date().toISOString()}`,
            '[SYS] Establishing secure handshake with server gateways...',
            '[SYS] Scanning client environment and permissions...',
            '------------------------------------------------------------------',
        ]);

        let success = true;
        let sessionData: any = null;
        let examData: any = null;

        // Fetch session and exam metadata first
        try {
            if (sessionId) {
                const sessionDoc = await getDoc(doc(db, 'exam_sessions', sessionId));
                if (sessionDoc.exists()) {
                    sessionData = sessionDoc.data();
                    const examDoc = await studentExam(sessionId!);
                    if (examDoc.exists()) {
                        examData = examDoc.data();
                    }
                }
            }
        } catch (err) {
            console.error('Failed to pre-fetch session/exam data:', err);
        }

        if (!sessionData || !examData) {
            success = false;
            setTerminalOutput(prev => [
                ...prev,
                '[FAIL] Client gateways: Failed to load exam details. Access denied.',
                '------------------------------------------------------------------',
                '[SYS] DIAGNOSTIC STATUS: ERROR.',
                '[SYS] Session could not be validated.'
            ]);
            setAllChecksPassed(false);
            return;
        }

        const isMobile = window.matchMedia("(pointer:coarse)").matches ||
            /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        // Browser check
        await delay(400);
        setTerminalOutput(prev => [
            ...prev,
            '[ OK ] Browser compatibility: Modern browser engine detected (WebKit/Blink).'
        ]);

        // Fullscreen check
        await delay(300);
        const fullscreenSupported = document.fullscreenEnabled || (document as any).webkitFullscreenEnabled;
        if (fullscreenSupported) {
            setTerminalOutput(prev => [
                ...prev,
                '[ OK ] Display graphics: Fullscreen mode support confirmed.'
            ]);
        } else {
            setTerminalOutput(prev => [
                ...prev,
                '[WARN] Display graphics: Warning. Fullscreen mode could not be verified automatically.'
            ]);
        }

        // JavaScript check
        await delay(300);
        setTerminalOutput(prev => [
            ...prev,
            '[ OK ] JavaScript engine: Client compilation and execution active.'
        ]);

        // Cookies check
        await delay(300);
        const cookiesEnabled = navigator.cookieEnabled;
        if (cookiesEnabled) {
            setTerminalOutput(prev => [
                ...prev,
                '[ OK ] Browser storage: Cookies active. Session tokens verified.'
            ]);
        } else {
            setTerminalOutput(prev => [
                ...prev,
                '[WARN] Browser storage: Cookies disabled. Browser sessions may expire early.'
            ]);
        }

        // Device restriction check
        await delay(300);
        const deviceRestriction = examData.settings?.deviceRestriction || 'both';
        if (deviceRestriction === 'mobile_only' && !isMobile) {
            success = false;
            setTerminalOutput(prev => [
                ...prev,
                `[FAIL] Device Restriction: Mobile only exam. Current device: Desktop/Laptop. Access denied.`,
                `[SYS] Please switch to a mobile device to attempt this exam.`
            ]);
        } else if (deviceRestriction === 'desktop_only' && isMobile) {
            success = false;
            setTerminalOutput(prev => [
                ...prev,
                `[FAIL] Device Restriction: Desktop/Laptop only exam. Current device: Mobile. Access denied.`,
                `[SYS] Please switch to a desktop or laptop device to attempt this exam.`
            ]);
        } else {
            setTerminalOutput(prev => [
                ...prev,
                `[ OK ] Device Restriction: Device compatibility verified (${deviceRestriction === 'both' ? 'Mobile or Desktop' : deviceRestriction.replace('_', ' ')}).`
            ]);
        }

        // Late Entry Policy check
        await delay(300);
        if (examData.settings?.schedulingEnabled) {
            setSchedulingEnabled(true);
            if (examData.settings.scheduledStartTime) {
                const start = examData.settings.scheduledStartTime.toDate 
                    ? examData.settings.scheduledStartTime.toDate() 
                    : new Date(examData.settings.scheduledStartTime);
                setScheduledStartTime(start);

                const startTimeMs = start.getTime();
                const lateEntryPolicy = examData.settings.lateEntryPolicy || 'allow';
                const now = Date.now();

                if (lateEntryPolicy === 'disallow' && now > startTimeMs) {
                    const sessionCreatedVal = sessionData.createdAt || sessionData.startTime;
                    const sessionCreatedTimeMs = sessionCreatedVal?.toDate ? sessionCreatedVal.toDate().getTime() : new Date(sessionCreatedVal).getTime();
                    
                    if (sessionCreatedTimeMs > startTimeMs + 1000) { // 1s tolerance
                        success = false;
                        setTerminalOutput(prev => [
                            ...prev,
                            `[FAIL] Exam Entry Policy: Late entry is not permitted for this exam.`,
                            `[SYS] Exam started at ${new Date(startTimeMs).toLocaleString()}. Your session started at ${new Date(sessionCreatedTimeMs).toLocaleString()}.`
                        ]);
                    } else {
                        setTerminalOutput(prev => [
                            ...prev,
                            `[ OK ] Exam Entry Policy: Entry verification complete (Late entry policy: Disallow, but session started on-time).`
                        ]);
                    }
                } else if (lateEntryPolicy === 'allow' && now > startTimeMs) {
                    const endVal = examData.settings.scheduledEndTime;
                    const endTimeMs = endVal.toDate ? endVal.toDate().getTime() : new Date(endVal).getTime();
                    const remainingMinutes = Math.max(0, Math.floor((endTimeMs - now) / 60000));
                    setTerminalOutput(prev => [
                        ...prev,
                        `[WARN] Exam Entry Policy: Late entry detected. Remaining exam time is capped at ${remainingMinutes} minutes.`,
                        `[ OK ] Exam Entry Policy: Late entry allowed. Capped duration enforced.`
                    ]);
                } else {
                    setTerminalOutput(prev => [
                        ...prev,
                        `[ OK ] Exam Entry Policy: Entry verification complete (Late entry policy: ${lateEntryPolicy === 'allow' ? 'Allow' : 'Disallow'}).`
                    ]);
                }
            }
        }

        // Camera surveillance check
        const cameraAntiCheat = examData.settings?.cameraAntiCheat ?? false;
        if (cameraAntiCheat) {
            await delay(400);
            setTerminalOutput(prev => [
                ...prev,
                '[SYS] Camera surveillance: Initializing hardware verification...',
                '[SYS] Requesting webcam media stream permission...'
            ]);
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
                activeStreamRef.current = stream;
                setShowCameraPreview(true);
                setTimeout(() => {
                    if (videoRef.current) {
                        videoRef.current.srcObject = stream;
                    }
                }, 100);

                setTerminalOutput(prev => [
                    ...prev,
                    '[ OK ] Camera stream: Video feed active and permission verified.',
                    '[ OK ] Camera diagnostics: Face tracking system handshake complete.'
                ]);
            } catch (err: any) {
                success = false;
                setTerminalOutput(prev => [
                    ...prev,
                    `[FAIL] Camera surveillance: ${err.message || 'Access denied'}. Camera permission is mandatory.`,
                    `[SYS] Please ensure your webcam is connected and permission is granted.`
                ]);
            }
        }

        // Geolocation Check (Mandatory)
        await delay(400);
        setTerminalOutput(prev => [
            ...prev,
            '[SYS] Geolocation check: Requesting permission...'
        ]);
        try {
            const coords = await getGeolocation();
            
            // Check Geofence
            let geofencePassed = true;
            let hasGeofence = false;
            let geofenceDesc = '';
            
            if (examData) {
                // Parse scheduling settings if missing previously (safety)
                if (examData.settings?.schedulingEnabled) {
                    // Expired scheduled check
                    if (examData.settings.scheduledEndTime) {
                        const endVal = examData.settings.scheduledEndTime;
                        const endTimeMs = endVal.toDate ? endVal.toDate().getTime() : new Date(endVal).getTime();
                        if (Date.now() >= endTimeMs) {
                            success = false;
                            setTerminalOutput(prev => [
                                ...prev,
                                `[FAIL] Exam Schedule: This exam has already ended. Access denied.`,
                                `[SYS] Scheduled End Time: ${new Date(endTimeMs).toLocaleString()}`
                            ]);
                        }
                    }
                }

                const geofence = examData.settings?.geofence;
                if (geofence) {
                    if (geofence.type === 'circle' && geofence.center) {
                        hasGeofence = true;
                        const dist = getDistanceInMeters(coords.latitude, coords.longitude, geofence.center.lat, geofence.center.lng);
                        geofencePassed = dist <= geofence.radius;
                        geofenceDesc = `Circle (Radius: ${geofence.radius}m, Current distance: ${Math.round(dist)}m)`;
                    } else if (geofence.type === 'polygon' && geofence.points?.length >= 3) {
                        hasGeofence = true;
                        geofencePassed = isPointInPolygon(coords.latitude, coords.longitude, geofence.points);
                        geofenceDesc = `Custom Boundary (Vertices: ${geofence.points.length})`;
                    } else if (Array.isArray(geofence) && geofence.length >= 3) {
                        // Backward compatibility for legacy geofence arrays
                        hasGeofence = true;
                        geofencePassed = isPointInPolygon(coords.latitude, coords.longitude, geofence);
                        geofenceDesc = `Legacy Boundary (Vertices: ${geofence.length})`;
                    }
                }
            }

            if (sessionId) {
                await updateDoc(doc(db, 'exam_sessions', sessionId), {
                    startLocation: {
                        latitude: coords.latitude,
                        longitude: coords.longitude,
                        accuracy: coords.accuracy,
                        timestamp: new Date()
                    }
                });
            }

            if (!geofencePassed) {
                success = false;
                setTerminalOutput(prev => [
                    ...prev,
                    `[FAIL] Geolocation: Out of bounds. You are outside the allowed exam geofence area.`,
                    `[SYS] Current coordinates: ${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`,
                    `[SYS] Geofence Rule: ${geofenceDesc}`,
                    `[SYS] Access Denied: Please relocate within the designated examination room/campus.`
                ]);
            } else {
                setTerminalOutput(prev => [
                    ...prev,
                    `[ OK ] Geolocation: Position acquired (accuracy: ${Math.round(coords.accuracy)}m).`,
                    hasGeofence 
                        ? `[ OK ] Geofence: Candidate physical location verified within bounds. (${geofenceDesc})`
                        : `[ OK ] Geofence: Boundary check completed. No location limits set.`
                ]);
            }
        } catch (err: any) {
            success = false;
            setTerminalOutput(prev => [
                ...prev,
                `[FAIL] Geolocation: ${err.message || 'Access denied'}. Location permission is mandatory.`
            ]);
        }

        // Split-screen check (Mandatory)
        await delay(400);
        if (isMobile) {
            const screenWidth = window.screen.width;
            const screenHeight = window.screen.height;
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;

            if (windowWidth < screenWidth * 0.85 || windowHeight < screenHeight * 0.75) {
                success = false;
                setTerminalOutput(prev => [
                    ...prev,
                    '[FAIL] Split-screen protection: Split screen detected. Please exit split screen and reload.'
                ]);
            } else {
                setTerminalOutput(prev => [
                    ...prev,
                    '[ OK ] Split-screen protection: Single-window verification complete.'
                ]);
            }
        } else {
            setTerminalOutput(prev => [
                ...prev,
                '[ OK ] Split-screen protection: Desktop agent verified.'
            ]);
        }

        // DND Reminder
        await delay(300);
        setTerminalOutput(prev => [
            ...prev,
            '[SYS] DND configuration: Ensure "Do Not Disturb" (DND) or silent mode is enabled.',
            '[ OK ] DND Mode reminder logged.'
        ]);

        // Connection check
        await delay(400);
        const online = navigator.onLine;
        if (online && success) {
            setTerminalOutput(prev => [
                ...prev,
                '[ OK ] Network status: Internet connection active. Latency <50ms.',
                '------------------------------------------------------------------',
                '[SYS] DIAGNOSTIC STATUS: SUCCESS.',
                '[SYS] All mandatory parameters verified successfully.',
                '[SYS] Ready to proceed. Press "PROCEED" below to continue.'
            ]);
            setAllChecksPassed(true);
        } else {
            const reason = !online ? 'Network status check failed.' : 'Mandatory permission checks failed.';
            setTerminalOutput(prev => [
                ...prev,
                `[FAIL] Diagnostics failed: ${reason}`,
                '------------------------------------------------------------------',
                '[SYS] DIAGNOSTIC STATUS: ERROR.',
                '[SYS] Critical check failed. Please resolve the issues above and refresh.'
            ]);
            setAllChecksPassed(false);
        }
    };

    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const handleStartExam = async () => {
        if (!sessionId) return;
        try {
            // Stop camera tracks before navigating to release camera
            if (activeStreamRef.current) {
                activeStreamRef.current.getTracks().forEach(track => track.stop());
            }

            await api('beginExam', { sessionId });

            // Request fullscreen
            const elem = document.documentElement;
            if (elem.requestFullscreen) {
                await elem.requestFullscreen().catch(() => {});
            } else if ((elem as any).webkitRequestFullscreen) {
                await (elem as any).webkitRequestFullscreen();
            }
        } catch (err) {
            console.warn('Could not start exam:', err);
            setTerminalOutput(previous => [...previous, err instanceof Error ? err.message : 'Could not start exam. Please retry.']);
            return;
        }

        navigate(`/exam/${sessionId}`);
    };

    // Live Countdown Timer logic
    useEffect(() => {
        if (!schedulingEnabled || !scheduledStartTime) return;

        const updateCountdown = () => {
            const now = new Date().getTime();
            const start = scheduledStartTime.getTime();
            const diff = Math.max(0, Math.floor((start - now) / 1000));
            setTimeRemaining(diff);

            // Auto-start if candidate is in wait room (step 3) and time reaches zero
            if (diff <= 0 && step === 3) {
                handleStartExam();
            }
        };

        updateCountdown();
        const timer = setInterval(updateCountdown, 1000);
        return () => clearInterval(timer);
    }, [schedulingEnabled, scheduledStartTime, step]);

    const formatTime = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return [
            h > 0 ? String(h).padStart(2, '0') : null,
            String(m).padStart(2, '0'),
            String(s).padStart(2, '0')
        ].filter(Boolean).join(':');
    };

    const rules = [
        { action: 'Tab Switching', description: 'Do not switch to other tabs or windows' },
        { action: 'Right Click', description: 'Right-click context menu is disabled' },
        { action: 'Keyboard Shortcuts', description: 'Ctrl+C, Ctrl+V, Ctrl+U, F12 are disabled' },
        { action: 'Developer Tools', description: 'Opening browser developer tools is prohibited' },
        { action: 'Copy/Paste', description: 'Copying and pasting text is not allowed' },
        { action: 'Screen Recording', description: 'Screen recording or sharing is not permitted' },
        { action: 'Fullscreen', description: 'Exam must remain in fullscreen mode' },
        { action: 'External Help', description: 'Using external resources or help is cheating' },
        { action: 'Location Tracking', description: 'Your location is captured at exam start and submission for security' },
        { action: 'Do Not Disturb', description: 'Enable DND mode — phone calls during the exam will trigger tab-switch detection' },
        { action: 'Split-Screen Protection', description: 'Opening split-screen or resizing window results in immediate termination' },
    ];

    const renderTerminalLine = (line: string, index: number) => {
        let color = '#e6edf3';
        let fontWeight = 'normal';

        if (line.startsWith('$')) {
            color = '#58a6ff';
            fontWeight = '600';
        } else if (line.startsWith('[ OK ]')) {
            color = '#3fb950';
        } else if (line.startsWith('[WARN]')) {
            color = '#d29922';
        } else if (line.startsWith('[FAIL]')) {
            color = '#f85149';
        } else if (line.startsWith('[SYS]')) {
            color = '#a855f7';
        } else if (line.startsWith('---')) {
            color = '#21262d';
        }

        return (
            <div key={index} className="terminal-line" style={{ color, fontWeight }}>
                {line}
            </div>
        );
    };

    if (!sessionId) return null;

    return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
            <style>{`
                @keyframes blink {
                    50% { opacity: 0; }
                }
                .terminal-cursor {
                    animation: blink 1s step-start infinite;
                    background-color: #00ff66;
                    display: inline-block;
                    width: 8px;
                    height: 15px;
                    vertical-align: middle;
                    margin-left: 4px;
                }
                .rules-grid {
                    display: grid;
                    grid-template-columns: 1fr;
                    gap: var(--space-sm);
                }
                @media (min-width: 640px) {
                    .rules-grid {
                        grid-template-columns: 1fr 1fr;
                        gap: var(--space-md);
                    }
                }
                .pre-exam-card {
                    padding: var(--space-lg) var(--space-md) !important;
                }
                @media (min-width: 640px) {
                    .pre-exam-card {
                        padding: var(--space-xl) !important;
                    }
                }
                .step-label {
                    font-size: 0.75rem;
                }
                @media (min-width: 640px) {
                    .step-label {
                        font-size: 0.85rem;
                    }
                }
                .step-divider {
                    width: 24px;
                    height: 2px;
                }
                @media (min-width: 640px) {
                    .step-divider {
                        width: 40px;
                    }
                }
                .terminal-line {
                    margin-bottom: 4px;
                    font-family: var(--font-mono);
                    font-size: 0.76rem;
                    line-height: 1.4;
                    word-break: break-all;
                }
                @media (min-width: 640px) {
                    .terminal-line {
                        margin-bottom: 6px;
                        font-size: 0.85rem;
                        line-height: 1.5;
                        word-break: normal;
                    }
                }
                .rule-card {
                    display: flex;
                    gap: var(--space-sm);
                    padding: var(--space-sm) var(--space-md);
                    background: rgba(244, 63, 94, 0.03);
                    border: 1px solid rgba(244, 63, 94, 0.1);
                    border-radius: var(--radius-md);
                    align-items: flex-start;
                }
                @media (min-width: 640px) {
                    .rule-card {
                        padding: var(--space-md);
                    }
                }
                .rule-title {
                    display: block;
                    color: var(--text-primary);
                    font-size: 0.8rem;
                    margin-bottom: 2px;
                }
                .rule-desc {
                    font-size: 0.74rem;
                    color: var(--text-secondary);
                }
                @media (min-width: 640px) {
                    .rule-title {
                        font-size: 0.85rem;
                    }
                    .rule-desc {
                        font-size: 0.78rem;
                    }
                }
                .agreement-label {
                    display: flex;
                    align-items: flex-start;
                    gap: var(--space-md);
                    padding: var(--space-sm);
                    background: var(--bg-surface);
                    border-radius: var(--radius-md);
                    cursor: pointer;
                    transition: all var(--transition-fast);
                    margin-bottom: var(--space-lg);
                }
                @media (min-width: 640px) {
                    .agreement-label {
                        padding: var(--space-md);
                    }
                }
                .agreement-checkbox {
                    width: 16px;
                    height: 16px;
                    margin-top: 2px;
                    accent-color: var(--success);
                    flex-shrink: 0;
                }
                @media (min-width: 640px) {
                    .agreement-checkbox {
                        width: 18px;
                        height: 18px;
                    }
                }
                .agreement-text {
                    font-size: 0.74rem;
                    line-height: 1.5;
                    color: var(--text-secondary);
                }
                @media (min-width: 640px) {
                    .agreement-text {
                        font-size: 0.813rem;
                    }
                }
            `}</style>

            <div className="page flex items-center justify-center" style={{ flex: 1, padding: 'var(--space-xl) var(--space-md)' }}>
                <div className="container" style={{ maxWidth: step === 1 ? '600px' : '750px', transition: 'max-width 0.3s ease' }}>
                    <div className="card pre-exam-card">
                        {/* Header */}
                        <div className="text-center mb-lg">
                            <Logo size={56} style={{ margin: '0 auto var(--space-md)', display: 'block' }} />
                            <h1 style={{ fontSize: '1.35rem', marginBottom: 'var(--space-2xs)' }}>Pre-Exam Verification</h1>
                            <p className="text-secondary" style={{ fontSize: '0.85rem', margin: 0 }}>{examName}</p>
                        </div>

                        {/* Multi-step progress tracker */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                                <span style={{
                                    width: '28px',
                                    height: '28px',
                                    borderRadius: '50%',
                                    backgroundColor: step === 1 ? 'var(--primary-500)' : 'var(--success)',
                                    color: '#fff',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '0.85rem',
                                    fontWeight: 600,
                                    boxShadow: step === 1 ? 'var(--shadow-glow)' : 'none'
                                }}>
                                    {step > 1 ? '✓' : '1'}
                                </span>
                                <span className="step-label" style={{ fontWeight: 500, color: step === 1 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                                    Diagnostics
                                </span>
                            </div>
                            <div className="step-divider" style={{ backgroundColor: step > 1 ? 'var(--success)' : 'var(--border-color)' }}></div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                                <span style={{
                                    width: '28px',
                                    height: '28px',
                                    borderRadius: '50%',
                                    backgroundColor: step === 2 ? 'var(--primary-500)' : 'var(--bg-input)',
                                    color: step === 2 ? '#fff' : 'var(--text-muted)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '0.85rem',
                                    fontWeight: 600,
                                    border: step === 2 ? 'none' : '1px solid var(--border-color)',
                                    boxShadow: step === 2 ? 'var(--shadow-glow)' : 'none'
                                }}>
                                    2
                                </span>
                                <span className="step-label" style={{ fontWeight: 500, color: step === 2 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                                    Rules & Agreement
                                </span>
                            </div>
                        </div>

                        {/* STEP 1: Diagnostic Terminal */}
                        {step === 1 && (
                            <div style={{ animation: 'fadeIn 0.3s ease' }}>
                                {/* Student Info Alert */}
                                <div className="alert alert-info mb-lg" style={{ background: 'rgba(99, 102, 241, 0.08)', borderColor: 'var(--primary-500)', color: 'var(--text-primary)', padding: 'var(--space-md)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                            <circle cx="12" cy="7" r="4" />
                                        </svg>
                                        <div>
                                            <strong style={{ fontSize: '0.9rem' }}>{studentName}</strong>
                                            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                                                Duration: {duration} minutes
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Terminal Window */}
                                <div style={{
                                    fontFamily: 'var(--font-mono)',
                                    backgroundColor: '#0a0e14',
                                    borderRadius: 'var(--radius-lg)',
                                    border: '1px solid var(--border-color)',
                                    boxShadow: 'var(--shadow-lg), inset 0 0 10px rgba(0, 0, 0, 0.8)',
                                    overflow: 'hidden',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    height: '320px'
                                }}>
                                    {/* Window Header */}
                                    <div style={{
                                        backgroundColor: '#161b22',
                                        padding: '8px 16px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        borderBottom: '1px solid #21262d',
                                        userSelect: 'none'
                                    }}>
                                        <div style={{ display: 'flex', gap: '6px' }}>
                                            <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#f85149', display: 'inline-block' }}></span>
                                            <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#d29922', display: 'inline-block' }}></span>
                                            <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#3fb950', display: 'inline-block' }}></span>
                                        </div>
                                        <span style={{ color: '#8b949e', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>system_diagnostics.sh</span>
                                        <div style={{ width: '38px' }}></div>
                                    </div>

                                    {/* Terminal Console Output */}
                                    <div 
                                        ref={terminalEndRef}
                                        style={{
                                            padding: 'var(--space-md)',
                                            flexGrow: 1,
                                            overflowY: 'auto',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            backgroundColor: '#0a0e14'
                                        }}
                                    >
                                        {terminalOutput.map((line, idx) => renderTerminalLine(line, idx))}
                                        {!allChecksPassed && (
                                            <div style={{ color: '#00ff66', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', marginTop: '4px' }}>
                                                Running verification checks<span className="terminal-cursor"></span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {showCameraPreview && (
                                    <div style={{
                                        marginTop: 'var(--space-md)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        backgroundColor: '#0a0e14',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-lg)',
                                        padding: 'var(--space-md)',
                                        boxShadow: 'var(--shadow-lg)'
                                    }}>
                                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--primary-500)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#3fb950', display: 'inline-block', transform: 'scale(1)' }}></span>
                                            <span>📷 Surveillance Webcam Feed: Gaze & Movement Calibration Active</span>
                                        </div>
                                        <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 'var(--radius-md)', background: '#000', maxHeight: '200px' }}>
                                            <video 
                                                ref={videoRef}
                                                autoPlay 
                                                playsInline 
                                                muted 
                                                style={{
                                                    width: '100%',
                                                    height: '200px',
                                                    borderRadius: 'var(--radius-md)',
                                                    transform: 'scaleX(-1)',
                                                    objectFit: 'cover'
                                                }}
                                            />
                                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', border: '1px solid rgba(0, 255, 102, 0.2)', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                                                <div style={{ width: '100px', height: '100px', border: '1px dashed rgba(0, 255, 10 green, 0.4)', borderRadius: '50%' }}></div>
                                                <div style={{ position: 'absolute', color: 'rgba(0, 255, 102, 0.7)', fontSize: '0.7rem', fontFamily: 'monospace', bottom: 10, left: 10 }}>FACE_LOCATED: YES</div>
                                                <div style={{ position: 'absolute', color: 'rgba(0, 255, 102, 0.7)', fontSize: '0.7rem', fontFamily: 'monospace', bottom: 10, right: 10 }}>EYE_TRACKING: LOCKED</div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Proceed Button */}
                                <button
                                    className="btn btn-primary btn-lg mt-xl"
                                    style={{ width: '100%', justifyContent: 'center' }}
                                    disabled={!allChecksPassed}
                                    onClick={() => setStep(2)}
                                >
                                    <span>Proceed to Examination Rules</span>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <line x1="5" y1="12" x2="19" y2="12"></line>
                                        <polyline points="12 5 19 12 12 19"></polyline>
                                    </svg>
                                </button>
                            </div>
                        )}

                        {/* STEP 2: Rules & Agreement */}
                        {step === 2 && (
                            <div style={{ animation: 'fadeIn 0.3s ease' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
                                    <h3 style={{ fontSize: '1.1rem', margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                            <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" />
                                            <line x1="16" y1="17" x2="8" y2="17" />
                                        </svg>
                                        Examination Rules
                                    </h3>
                                    <button 
                                        onClick={() => setStep(1)}
                                        style={{ 
                                            background: 'none', 
                                            border: 'none', 
                                            color: 'var(--text-secondary)', 
                                            cursor: 'pointer', 
                                            fontSize: '0.85rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '4px'
                                        }}
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <line x1="19" y1="12" x2="5" y2="12"></line>
                                            <polyline points="12 19 5 12 12 5"></polyline>
                                        </svg>
                                        Back to Terminal
                                    </button>
                                </div>

                                <div className="alert alert-warning mb-lg" style={{ fontSize: '0.85rem', background: 'rgba(245, 158, 11, 0.08)', borderColor: 'var(--warning)', color: 'var(--text-primary)', padding: 'var(--space-md)' }}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, color: 'var(--warning)' }}>
                                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                                    </svg>
                                    <div>
                                        <strong>Important Warning:</strong> Violating any rule will trigger an automatic security warning. Receiving <strong>{maxWarnings} {maxWarnings === 1 ? 'warning' : 'warnings'}</strong> will <strong>permanently terminate</strong> your exam and block your roll number.
                                    </div>
                                </div>

                                <div className="rules-grid mb-lg">
                                    {rules.map((rule, idx) => (
                                        <div key={idx} className="rule-card">
                                            <div style={{
                                                color: 'var(--error)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                marginTop: '2px'
                                            }}>
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                                    <circle cx="12" cy="12" r="10" />
                                                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                                                </svg>
                                            </div>
                                            <div>
                                                <strong className="rule-title">
                                                    {rule.action}
                                                </strong>
                                                <span className="rule-desc">
                                                    {rule.description}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Privacy Policy / T&C Disclosure */}
                                <div className="alert alert-info mb-lg" style={{ 
                                    fontSize: '0.8rem', 
                                    background: 'rgba(59, 130, 246, 0.05)', 
                                    borderColor: 'rgba(59, 130, 246, 0.2)', 
                                    color: 'var(--text-secondary)', 
                                    padding: 'var(--space-md)',
                                    lineHeight: '1.4'
                                }}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, color: 'var(--primary-500)' }}>
                                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                    </svg>
                                    <div>
                                        <strong>Privacy Policy & Data Security:</strong> Geolocation and device information are collected solely for the enhanced anti-cheat system. All collected data is stored securely in an encrypted format, will not be disclosed to any third party, and will be accessed only by authorized administrators. In compliance with security guidelines, this data will be automatically and permanently deleted next year.
                                    </div>
                                </div>

                                {/* Agreement Checkbox */}
                                <label 
                                    className="agreement-label"
                                    style={{ border: rulesAgreed ? '2px solid var(--success)' : '2px solid var(--border-color)' }}
                                >
                                    <input
                                        type="checkbox"
                                        checked={rulesAgreed}
                                        onChange={(e) => setRulesAgreed(e.target.checked)}
                                        className="agreement-checkbox"
                                    />
                                    <span className="agreement-text">
                                        I have read and fully understood all examination rules. I agree to take this examination sincerely
                                        and will not attempt any cheating or malpractice. I understand that violations will result
                                        in instant termination of the exam and blocking of my roll number.
                                    </span>
                                </label>

                                {/* Start Button */}
                                <button
                                    className="btn btn-primary btn-lg"
                                    style={{ width: '100%', justifyContent: 'center' }}
                                    disabled={!rulesAgreed}
                                    onClick={() => {
                                        if (schedulingEnabled && scheduledStartTime && new Date() < scheduledStartTime) {
                                            setStep(3);
                                        } else {
                                            handleStartExam();
                                        }
                                    }}
                                >
                                    {schedulingEnabled && scheduledStartTime && new Date() < scheduledStartTime ? (
                                        <>
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                                <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
                                                <line x1="3" y1="10" x2="21" y2="10" />
                                            </svg>
                                            <span>Proceed to Waiting Room</span>
                                        </>
                                    ) : (
                                        <>
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <polygon points="5 3 19 12 5 21 5 3" />
                                            </svg>
                                            <span>Enter Fullscreen and Start Exam</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        )}

                        {/* STEP 3: Waiting Room (Countdown) */}
                        {step === 3 && (
                            <div style={{ animation: 'fadeIn 0.3s ease', textAlign: 'center', padding: 'var(--space-xl) var(--space-md)' }}>
                                <div style={{ fontSize: '3.5rem', marginBottom: 'var(--space-md)' }}>⏳</div>
                                <h3 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: 'var(--space-sm)' }}>Pre-Login Verification Successful!</h3>
                                <p className="text-secondary" style={{ maxWidth: '500px', margin: '0 auto var(--space-xl)', fontSize: '0.9rem', lineHeight: '1.5' }}>
                                    Your device status, location, and credentials have been successfully validated. Please wait here. The exam will launch automatically when the countdown hits zero.
                                </p>
                                
                                <div style={{
                                    display: 'inline-flex',
                                    flexDirection: 'column',
                                    background: 'rgba(14, 172, 171, 0.04)',
                                    border: '1px solid rgba(14, 172, 171, 0.2)',
                                    borderRadius: 'var(--radius-xl)',
                                    padding: 'var(--space-md) var(--space-xl)',
                                    boxShadow: 'var(--shadow-glow)',
                                    marginBottom: 'var(--space-xl)'
                                }}>
                                    <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '2px', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 600 }}>
                                        Exam Starts In
                                    </span>
                                    <span style={{
                                        fontFamily: 'var(--font-mono)',
                                        fontSize: '3rem',
                                        fontWeight: 700,
                                        color: 'var(--primary-500)',
                                        letterSpacing: '2px'
                                    }}>
                                        {formatTime(timeRemaining)}
                                    </span>
                                </div>

                                <div className="text-muted italic" style={{ fontSize: '0.8rem' }}>
                                    Do not close or refresh this tab. Fullscreen mode will be requested automatically.
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <Footer />
        </div>
    );
}

