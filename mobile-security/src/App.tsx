import { useState, useEffect, useRef, useCallback } from 'react';
import { doc as globalDoc, updateDoc, onSnapshot, arrayUnion, increment, collection, getDocs, query, where, limit, getDoc } from 'firebase/firestore';
import { db, auth } from './services/firebase';
import { doc, tenantId } from './services/tenant';
import { signInAnonymously } from 'firebase/auth';
import Logo from './components/Logo';

export default function App() {
    const [institute, setInstitute] = useState<any>(null);
    const [accessMessage, setAccessMessage] = useState('');
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [session, setSession] = useState<any>(null);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [isLocked, setIsLocked] = useState(false);
    const [isViolated, setIsViolated] = useState(false);
    const [localWarnings, setLocalWarnings] = useState<string[]>([]);
    const [examEnded, setExamEnded] = useState(false);

    // Mobile Camera Anti-Cheat States & Refs
    const [examSettings, setExamSettings] = useState<any>({});
    const [isCameraActive, setIsCameraActive] = useState(false);
    const [faceDetected, setFaceDetected] = useState(false);
    const [isPositioning, setIsPositioning] = useState(false);
    const [positioningTimeLeft, setPositioningTimeLeft] = useState<number | null>(null);

    const mobileVideoRef = useRef<HTMLVideoElement | null>(null);
    const mobileCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const mobileStreamRef = useRef<MediaStream | null>(null);
    const mobileLastMotionVectorRef = useRef({ x: 0, y: 0 });

    const consecutiveFocusLoss = useRef(0);
    const isLockingInProgressRef = useRef(false);
    const lastViolationTimeRef = useRef(0); // debounce rapid-fire violations
    const wakeLockRef = useRef<any>(null);
    const heartbeatWorkerRef = useRef<Worker | null>(null);
    const staticFeedFramesCountRef = useRef(0);
    const [livenessScore, setLivenessScore] = useState(0);

    // Callback ref for Video elements to ensure srcObject binds immediately on mount
    const setVideoRef = useCallback((node: HTMLVideoElement | null) => {
        mobileVideoRef.current = node;
        if (node && mobileStreamRef.current) {
            // Always rebind srcObject — critical after re-lock camera recovery
            if (node.srcObject !== mobileStreamRef.current) {
                node.srcObject = mobileStreamRef.current;
            }
        }
    }, []);

    // Screen Wake Lock — keeps the phone screen on during the exam
    const acquireWakeLock = useCallback(async () => {
        try {
            if ('wakeLock' in navigator) {
                wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
            }
        } catch (e) {
            console.warn('Wake Lock not available:', e);
        }
    }, []);

    const releaseWakeLock = useCallback(() => {
        if (wakeLockRef.current) {
            wakeLockRef.current.release().catch(() => {});
            wakeLockRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (!tenantId) { setError('Open the mobile link from your institute exam screen.'); return; }
        let profile: any;
        const verifyAccess = () => {
            if (!profile || profile.status !== 'active' || profile.expiresAt?.toMillis() <= Date.now()) {
                setAccessMessage(profile?.message || 'This institute is inactive. Contact your administrator.');
                setExamEnded(true); setIsLocked(false);
                mobileStreamRef.current?.getTracks().forEach(track => track.stop());
                void releaseWakeLock();
            }
        };
        const unsubscribe = onSnapshot(globalDoc(db, 'institutes', tenantId), snapshot => {
            profile = snapshot.data();
            setInstitute(profile);
            verifyAccess();
        }, () => setError('Unable to verify institute access.'));
        const timer = setInterval(() => { if (profile) verifyAccess(); }, 1000);
        return () => { unsubscribe(); clearInterval(timer); };
    }, []);
    // 1. Verify code and fetch student details
    const handleVerifyCode = useCallback(async (verifyCode: string) => {
        if (!verifyCode.trim()) return;

        setLoading(true);
        setError('');

        try {
            if (!tenantId) throw new Error('Use the mobile link shared on your exam screen.');
            await auth.authStateReady();
            if (!auth.currentUser) await signInAnonymously(auth);
            const code = verifyCode.trim().toUpperCase();
            const matches = await getDocs(query(collection(db, 'institutes', tenantId, 'exam_sessions'), where('mobileLockCode', '==', code), limit(1)));
            if (matches.empty) throw new Error('Invalid pairing code.');
            const sessionDoc = matches.docs[0];
            const current = sessionDoc.data();
            if (current.status !== 'started' || (current.deadline?.toMillis?.() || 0) <= Date.now()) throw new Error('This exam session has ended.');
            if (current.mobileUid && current.mobileUid !== auth.currentUser?.uid) throw new Error('A phone is already paired with this session.');
            await updateDoc(sessionDoc.ref, { mobileUid: auth.currentUser?.uid });
            const examDoc = await getDoc(globalDoc(db, 'institutes', tenantId, 'exams', current.examId));
            setExamSettings(examDoc.data()?.settings || {});
            setSession({ ...current, mobileUid: auth.currentUser?.uid });
            setSessionId(sessionDoc.id);
        } catch (err: any) {
            console.error('Error verifying code:', err);
            setError(err.message || 'Handshake failed. Check your connection.');
        } finally {
            setLoading(false);
        }
    }, []);

    const handleVerifyFormSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        handleVerifyCode(code);
    };

    // Auto-populate and auto-verify from URL query parameters (e.g. ?code=A1B2C3)
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const urlCode = params.get('code') || params.get('passcode');
        if (urlCode) {
            const upperCode = urlCode.toUpperCase();
            setCode(upperCode);
            handleVerifyCode(upperCode);
        }
    }, [handleVerifyCode]);

    // Auto-start camera when student detail is loaded (Step 3: Confirm Identity)
    useEffect(() => {
        if (!session || examEnded || !examSettings.mobileCameraAntiCheat || isCameraActive) return;

        const startConfirmationCamera = async () => {
            try {
                const facing = examSettings.mobileCameraSource === 'rear' ? 'environment' : 'user';
                const stream = await navigator.mediaDevices.getUserMedia({ 
                    video: { facingMode: facing, width: 320, height: 240 } 
                });
                mobileStreamRef.current = stream;
                setIsCameraActive(true);
                setError('');
            } catch (err) {
                console.error('Failed to pre-activate mobile camera:', err);
                setError('Camera permission is required for mobile surveillance. Please allow browser camera access.');
            }
        };

        startConfirmationCamera();
    }, [session, examSettings, isCameraActive, examEnded]);

    // 2. Lock device - Request fullscreen & update status
    const handleLockDevice = async () => {
        if (!sessionId || !session) return;

        // Force Face Detection requirement if camera anti-cheat is enabled
        if (examSettings.mobileCameraAntiCheat && !faceDetected) {
            setError('Face Alignment Required: Please point the camera properly at your face before locking.');
            return;
        }

        setLoading(true);
        setError('');
        isLockingInProgressRef.current = true;

        try {
            // Request Fullscreen
            const el = document.documentElement;
            if (el.requestFullscreen) {
                await el.requestFullscreen();
            } else if ((el as any).webkitRequestFullscreen) {
                await (el as any).webkitRequestFullscreen();
            }

            // Update Firebase status to locked
            await updateDoc(doc(db, 'exam_sessions', sessionId), {
                mobileLockStatus: 'locked',
                lastActiveHeartbeat: new Date()
            });

            setIsLocked(true);
            setIsViolated(false);
            setLocalWarnings([]);

            // Acquire wake lock to keep screen on
            await acquireWakeLock();

            // Hold lock progress ref for 2 seconds to bypass permission and screen settle events
            setTimeout(() => {
                isLockingInProgressRef.current = false;
            }, 2000);
        } catch (err) {
            console.warn('Locking failed:', err);
            setError('Device lock engagement error. Please try again.');
            isLockingInProgressRef.current = false;
        } finally {
            setLoading(false);
        }
    };

    // 3. Listen to exam ending (unlock device automatically)
    useEffect(() => {
        if (!sessionId) return;

        const unsubscribe = onSnapshot(doc(db, 'exam_sessions', sessionId), (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                if (data.status === 'completed' || data.status === 'terminated' || data.mobileLockStatus === 'unlocked') {
                    setExamEnded(true);
                    setIsLocked(false);
                    setIsViolated(false);
                    setIsPositioning(false);
                    // Release camera tracks
                    if (mobileStreamRef.current) {
                        mobileStreamRef.current.getTracks().forEach(track => track.stop());
                    }
                    setIsCameraActive(false);
                    releaseWakeLock();
                    if (document.fullscreenElement) {
                        document.exitFullscreen().catch(() => {});
                    }
                } else if (data.mobileLockStatus === 'violated') {
                    setIsViolated(true);
                } else if (data.mobileLockStatus === 'locked') {
                    setIsViolated(false);
                }
            }
        });

        return () => unsubscribe();
    }, [sessionId, releaseWakeLock]);

    // Clean up tracks on unmount
    useEffect(() => {
        return () => {
            if (mobileStreamRef.current) {
                mobileStreamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    // 4. Mobile focus and fullscreen violation tracking
    useEffect(() => {
        if (!sessionId || !isLocked || examEnded) return;

        const recordViolation = async (details: string) => {
            if (isLockingInProgressRef.current) {
                console.log('Skipping violation check: Lock engagement in progress');
                return;
            }

            // Debounce: skip if another violation was logged within the last 2 seconds
            // This prevents blur+visibilitychange+fullscreenchange from firing 3 writes
            const now = Date.now();
            if (now - lastViolationTimeRef.current < 2000) return;
            lastViolationTimeRef.current = now;

            try {
                consecutiveFocusLoss.current += 1;
                const event = {
                    type: 'mobile_lock_violation',
                    timestamp: new Date(),
                    details: `Mobile Lock Violation: ${details}`,
                    severity: 'high'
                };
                
                await updateDoc(doc(db, 'exam_sessions', sessionId), {
                    warningCount: increment(1),
                    cheatingEvents: arrayUnion(event),
                    mobileLockViolationsCount: increment(1),
                    mobileLockStatus: 'violated',
                    mobileLockViolatedAt: new Date()
                });

                setLocalWarnings(prev => [
                    ...prev,
                    `[${new Date().toLocaleTimeString()}] ALERT: ${details}`
                ]);
                setIsViolated(true);
            } catch (e) {
                console.error('Failed to log mobile lock violation:', e);
            }
        };

        const handleVisibilityChange = () => {
            if (document.hidden) {
                recordViolation('Switched apps, minimized browser, or locked screen.');
            }
        };

        const handleBlur = () => {
            recordViolation('Mobile browser lost window focus.');
        };

        const handleFullscreenChange = () => {
            if (!document.fullscreenElement && !examEnded) {
                recordViolation('Exited fullscreen lock mode.');
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('blur', handleBlur);
        document.addEventListener('fullscreenchange', handleFullscreenChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('blur', handleBlur);
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        };
    }, [sessionId, isLocked, examEnded]);

    // 4.5. Background Security Heartbeat Web Worker (prevents browser tab throttling)
    useEffect(() => {
        if (!sessionId || examEnded) return;
        if (!isLocked && !isPositioning) {
            if (heartbeatWorkerRef.current) {
                heartbeatWorkerRef.current.postMessage({ action: 'stop' });
            }
            return;
        }

        // Initialize Web Worker if not active
        if (!heartbeatWorkerRef.current) {
            const workerCode = `
                let timer = null;
                self.onmessage = function(e) {
                    if (e.data.action === 'start') {
                        if (timer) clearInterval(timer);
                        timer = setInterval(() => {
                            self.postMessage('heartbeat');
                        }, e.data.interval);
                    } else if (e.data.action === 'stop') {
                        if (timer) {
                            clearInterval(timer);
                            timer = null;
                        }
                    }
                };
            `;
            const blob = new Blob([workerCode], { type: 'application/javascript' });
            heartbeatWorkerRef.current = new Worker(URL.createObjectURL(blob));
        }

        const handleHeartbeatTick = async () => {
            try {
                await updateDoc(doc(db, 'exam_sessions', sessionId), {
                    lastActiveHeartbeat: new Date()
                });
            } catch (e) {
                console.warn('Heartbeat offline tick error:', e);
            }
        };

        heartbeatWorkerRef.current.onmessage = (e) => {
            if (e.data === 'heartbeat') {
                handleHeartbeatTick();
            }
        };

        // Start heartbeat ticking every 3000ms
        heartbeatWorkerRef.current.postMessage({ action: 'start', interval: 3000 });

        // Trigger first heartbeat immediately
        handleHeartbeatTick();

        return () => {
            if (heartbeatWorkerRef.current) {
                heartbeatWorkerRef.current.postMessage({ action: 'stop' });
            }
        };
    }, [sessionId, isLocked, isPositioning, examEnded]);

    // Send camera tracking violations
    const triggerMobileCameraViolation = async (reasonStr: string) => {
        if (!sessionId) return;
        try {
            const event = {
                type: 'mobile_camera_violation',
                timestamp: new Date(),
                details: `Mobile Surveillance violation: ${reasonStr}`,
                severity: 'high'
            };

            await updateDoc(doc(db, 'exam_sessions', sessionId), {
                warningCount: increment(1),
                cheatingEvents: arrayUnion(event),
                mobileLockViolationsCount: increment(1)
            });

            setLocalWarnings(prev => [
                ...prev,
                `[${new Date().toLocaleTimeString()}] ALERT: Gaze / face shift detected`
            ]);
        } catch (e) {
            console.error('Failed to log mobile camera violation:', e);
        }
    };

    const prevGridFrameRef = useRef<number[] | null>(null);
    const faceConfidenceRef = useRef(0); // rolling confidence counter

    // Live Face Detection Variance, Skin Color, Geometric Landmarks & Anti-Spoofing Check helper
    const detectHumanFace = (data: Uint8ClampedArray, w: number, h: number): boolean => {
        // Facial bounding box dimensions (centered patch of size 80x80)
        const patchW = 80;
        const patchH = 80;
        const startX = Math.max(0, Math.floor(w / 2) - Math.floor(patchW / 2));
        const startY = Math.max(0, Math.floor(h / 2) - Math.floor(patchH / 2));

        // 1. Check skin-color density and build structural luma grid
        let skinCount = 0;
        let totalCount = 0;
        const grid = Array.from({ length: 6 }, () => Array(6).fill(0));
        const gridCount = Array.from({ length: 6 }, () => Array(6).fill(0));

        // Divide the 80x80 patch into a 6x6 grid
        const cellW = patchW / 6;
        const cellH = patchH / 6;

        for (let py = 0; py < patchH; py += 2) {
            for (let px = 0; px < patchW; px += 2) {
                const x = startX + px;
                const y = startY + py;
                if (x >= w || y >= h) continue;

                const idx = (y * w + x) * 4;
                const r = data[idx];
                const g = data[idx+1];
                const b = data[idx+2];

                // Filter out extreme specular highlights (eyewear glare / reflections)
                if (r > 248 && g > 248 && b > 248) continue;

                const luma = 0.299 * r + 0.587 * g + 0.114 * b;

                // Skin color check (warmer/redder bounds)
                const isSkin = (r > 95 && g > 40 && b > 20 && (r - Math.min(g, b)) > 15 && Math.abs(r - g) > 15 && r > g && r > b);
                if (isSkin) {
                    skinCount++;
                }
                totalCount++;

                // Map pixel to its 6x6 grid cell index
                const cx = Math.min(5, Math.floor(px / cellW));
                const cy = Math.min(5, Math.floor(py / cellH));
                grid[cy][cx] += luma;
                gridCount[cy][cx]++;
            }
        }

        if (totalCount < 100) return false;

        // Skin density check: Face must have skin-toned pixels (>20% of facial bounding box)
        const skinRatio = skinCount / totalCount;
        if (skinRatio < 0.20) return false;

        // Normalize grid cells to average luma
        let totalLuma = 0;
        let activeCellsCount = 0;
        for (let cy = 0; cy < 6; cy++) {
            for (let cx = 0; cx < 6; cx++) {
                if (gridCount[cy][cx] > 0) {
                    grid[cy][cx] = grid[cy][cx] / gridCount[cy][cx];
                    totalLuma += grid[cy][cx];
                    activeCellsCount++;
                } else {
                    grid[cy][cx] = 127;
                }
            }
        }

        // 2. Geometric Landmark Analysis (proportion check to filter out hands/books)
        // Left Eye zone (row 1-2, col 1-2)
        const leftEye = (grid[1][1] + grid[1][2] + grid[2][1] + grid[2][2]) / 4;
        
        // Right Eye zone (row 1-2, col 3-4)
        const rightEye = (grid[1][3] + grid[1][4] + grid[2][3] + grid[2][4]) / 4;

        // Forehead (row 0, center cols)
        const forehead = (grid[0][2] + grid[0][3]) / 2;

        // Nose Bridge (row 2-3, center cols)
        const noseBridge = (grid[2][2] + grid[2][3] + grid[3][2] + grid[3][3]) / 4;

        // Cheeks (outer columns)
        const leftCheek = (grid[3][0] + grid[4][0]) / 2;
        const rightCheek = (grid[3][5] + grid[4][5]) / 2;

        // Mouth (row 4-5, center cols)
        const mouth = (grid[4][2] + grid[4][3] + grid[5][2] + grid[5][3]) / 4;

        // Human face geometric structural constraints:
        // A. Eyes are recessed in sockets, so they must be darker than forehead/nose bridge
        const isLeftEyeValid = leftEye < forehead + 4 && leftEye < noseBridge + 10;
        const isRightEyeValid = rightEye < forehead + 4 && rightEye < noseBridge + 10;

        // B. Cheeks must be brighter than or equal to the dark eye sockets
        const areCheeksValid = leftCheek > leftEye - 8 && rightCheek > rightEye - 8;

        // C. Mouth is a valley recess, so it must be darker than the nose tip or cheeks
        const isMouthValid = mouth < noseBridge + 6 || mouth < (leftCheek + rightCheek) / 2;

        const structuralScore = (isLeftEyeValid ? 1 : 0) + (isRightEyeValid ? 1 : 0) + (areCheeksValid ? 1 : 0) + (isMouthValid ? 1 : 0);
        // Requires at least 3 out of 4 geometric constraints to match a human face outline
        const matchesFacialStructure = structuralScore >= 3;

        // 3. Temporal Liveness Check
        let hasLiveness = true;
        let avgDiff = 0.05;
        const flatGrid = grid.flat();

        if (prevGridFrameRef.current && prevGridFrameRef.current.length === flatGrid.length) {
            let diffSum = 0;
            for (let i = 0; i < flatGrid.length; i++) {
                diffSum += Math.abs(flatGrid[i] - prevGridFrameRef.current[i]);
            }
            avgDiff = diffSum / flatGrid.length;

            if (avgDiff < 0.02) {
                staticFeedFramesCountRef.current++;
                if (staticFeedFramesCountRef.current > 20) {
                    hasLiveness = false; // Frozen spoofing detected
                }
            } else {
                staticFeedFramesCountRef.current = Math.max(0, staticFeedFramesCountRef.current - 1);
            }

            if (avgDiff < 0.08 || avgDiff > 35) {
                hasLiveness = false;
            }
        }

        prevGridFrameRef.current = flatGrid;

        // Calculate dynamic real-time Liveness/Confidence Score percentage (0% to 100%)
        let score = 0;
        if (matchesFacialStructure) score += 40;
        score += structuralScore * 10;
        if (hasLiveness) {
            const livenessPct = Math.min(20, Math.max(0, (avgDiff - 0.08) * 4));
            score += livenessPct;
        }
        setLivenessScore(Math.round(Math.min(100, score)));

        return skinRatio > 0.20 && matchesFacialStructure && hasLiveness;
    };

    const lastFaceDetectedRef = useRef(false);

    // Combined face validation & tracking surveillance loop (throttled & stabilized)
    useEffect(() => {
        if (!isCameraActive || examEnded) return;

        let animationFrameId: number;
        let prevFrame: Uint8ClampedArray | null = null;
        let consecutiveViolationsCount = 0;
        let lastLoggedViolationTime = 0;
        let frameCount = 0;

        const checkMobileCameraFrame = () => {
            const video = mobileVideoRef.current;
            const canvas = mobileCanvasRef.current;

            if (!video || !canvas || video.paused || video.ended) {
                animationFrameId = requestAnimationFrame(checkMobileCameraFrame);
                return;
            }

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                animationFrameId = requestAnimationFrame(checkMobileCameraFrame);
                return;
            }

            frameCount++;
            const w = canvas.width;
            const h = canvas.height;

            // Draw video to canvas once per frame
            ctx.drawImage(video, 0, 0, w, h);

            // Only run heavy analysis every 5th frame (~12fps) to prevent mobile CPU thrashing
            if (frameCount % 5 === 0) {
                try {
                    const imgData = ctx.getImageData(0, 0, w, h);
                    const data = imgData.data;

                    // Run face validation
                    const isFacePresent = detectHumanFace(data, w, h);
                    
                    // Rolling confidence smoother: require 3 consecutive agreeing frames
                    // to change state, preventing single-frame glitch flips
                    if (isFacePresent) {
                        faceConfidenceRef.current = Math.min(3, faceConfidenceRef.current + 1);
                    } else {
                        faceConfidenceRef.current = Math.max(-3, faceConfidenceRef.current - 1);
                    }

                    const stableFaceDetected = faceConfidenceRef.current >= 2;
                    if (stableFaceDetected !== lastFaceDetectedRef.current) {
                        lastFaceDetectedRef.current = stableFaceDetected;
                        setFaceDetected(stableFaceDetected);
                    }

                    // Motion sector analysis for gaze deviation
                    const thirdW = Math.floor(w / 3);
                    let leftIntensity = 0;
                    let centerIntensity = 0;
                    let rightIntensity = 0;

                    if (prevFrame) {
                        for (let y = 0; y < h; y += 6) {
                            for (let x = 0; x < w; x += 6) {
                                const idx = (y * w + x) * 4;
                                const rDiff = Math.abs(data[idx] - prevFrame[idx]);
                                const gDiff = Math.abs(data[idx+1] - prevFrame[idx+1]);
                                const bDiff = Math.abs(data[idx+2] - prevFrame[idx+2]);
                                const diff = (rDiff + gDiff + bDiff) / 3;

                                if (diff > 18) {
                                    if (x < thirdW) leftIntensity++;
                                    else if (x < 2 * thirdW) centerIntensity++;
                                    else rightIntensity++;
                                }
                            }
                        }
                    }

                    prevFrame = new Uint8ClampedArray(data);

                    const total = leftIntensity + centerIntensity + rightIntensity;
                    let devX = 0;
                    
                    if (total > 50) {
                        const leftPct = leftIntensity / total;
                        const rightPct = rightIntensity / total;
                        devX = (rightPct - leftPct) * 12;
                    }

                    const currentVectorX = mobileLastMotionVectorRef.current.x * 0.8 + devX * 0.2;
                    mobileLastMotionVectorRef.current = { x: currentVectorX, y: 0 };

                    // Only record deviation warnings when actively in locked state
                    if (isLocked) {
                        const threshold = 1.8;
                        const time = Date.now();
                        
                        // Detect frozen spoofing attempt violation explicitly
                        if (staticFeedFramesCountRef.current > 25) {
                            if (time - lastLoggedViolationTime > 4000) {
                                lastLoggedViolationTime = time;
                                triggerMobileCameraViolation('Frozen / static camera loop detected.');
                            }
                        } else if (Math.abs(currentVectorX) > threshold || !stableFaceDetected) {
                            consecutiveViolationsCount++;
                            if (consecutiveViolationsCount > 20) {
                                if (time - lastLoggedViolationTime > 3000) {
                                    lastLoggedViolationTime = time;
                                    triggerMobileCameraViolation(!stableFaceDetected ? 'Face missing from camera view.' : 'Face turned away.');
                                }
                            }
                        } else {
                            consecutiveViolationsCount = Math.max(0, consecutiveViolationsCount - 2);
                        }
                    }

                } catch (e) {
                    // Fail silently on getImageData cross-origin or timing errors
                }
            }

            // Draw lightweight overlay guides (runs every frame for smooth visuals)
            const isFace = lastFaceDetectedRef.current;
            const time = Date.now();

            // 1. Draw glowing corner frames around face target zone
            const bx = w / 2 - 30;
            const by = h / 2 - 35;
            const bw = 60;
            const bh = 70;
            ctx.strokeStyle = isFace ? '#00ff66' : '#ef4444';
            ctx.lineWidth = 2.5;

            // Top-left
            ctx.beginPath(); ctx.moveTo(bx, by + 10); ctx.lineTo(bx, by); ctx.lineTo(bx + 10, by); ctx.stroke();
            // Top-right
            ctx.beginPath(); ctx.moveTo(bx + bw, by + 10); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw - 10, by); ctx.stroke();
            // Bottom-left
            ctx.beginPath(); ctx.moveTo(bx, by + bh - 10); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + 10, by + bh); ctx.stroke();
            // Bottom-right
            ctx.beginPath(); ctx.moveTo(bx + bw, by + bh - 10); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw - 10, by + bh); ctx.stroke();

            // 2. Draw eye tracking and facial target locks when face is secured
            if (isFace) {
                ctx.lineWidth = 1;
                
                // Left Eye Target
                ctx.strokeStyle = 'rgba(0, 255, 102, 0.6)';
                ctx.beginPath();
                ctx.arc(w / 2 - 14, h / 2 - 12, 5, 0, 2 * Math.PI);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(w / 2 - 14, h / 2 - 15); ctx.lineTo(w / 2 - 14, h / 2 - 9);
                ctx.moveTo(w / 2 - 17, h / 2 - 12); ctx.lineTo(w / 2 - 11, h / 2 - 12);
                ctx.stroke();

                // Right Eye Target
                ctx.beginPath();
                ctx.arc(w / 2 + 14, h / 2 - 12, 5, 0, 2 * Math.PI);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(w / 2 + 14, h / 2 - 15); ctx.lineTo(w / 2 + 14, h / 2 - 9);
                ctx.moveTo(w / 2 + 11, h / 2 - 12); ctx.lineTo(w / 2 + 17, h / 2 - 12);
                ctx.stroke();

                // Nose Center crosshair
                ctx.strokeStyle = 'rgba(0, 255, 102, 0.8)';
                ctx.beginPath();
                ctx.moveTo(w / 2, h / 2 + 2); ctx.lineTo(w / 2, h / 2 + 8);
                ctx.moveTo(w / 2 - 3, h / 2 + 5); ctx.lineTo(w / 2 + 3, h / 2 + 5);
                ctx.stroke();

                // Mouth tracking bracket
                ctx.strokeStyle = 'rgba(0, 255, 102, 0.5)';
                ctx.beginPath();
                ctx.arc(w / 2, h / 2 + 20, 8, 0, Math.PI);
                ctx.stroke();
            }

            // Scanning radar sweep line
            const scanY = h / 2 + Math.sin(time * 0.002) * (h / 2 - 5);
            ctx.strokeStyle = isFace ? 'rgba(0, 255, 102, 0.25)' : 'rgba(239, 68, 68, 0.25)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(10, scanY);
            ctx.lineTo(w - 10, scanY);
            ctx.stroke();

            // Tracking alignment dot
            const pointerX = w / 2 + mobileLastMotionVectorRef.current.x * 4;
            ctx.fillStyle = isFace ? '#00ff66' : '#ef4444';
            ctx.beginPath();
            ctx.arc(pointerX, h / 2, 3.5, 0, 2 * Math.PI);
            ctx.fill();

            // Top Status Panel
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(4, 4, 70, 12);
            ctx.fillStyle = isFace ? '#00ff66' : '#ef4444';
            ctx.font = 'bold 7px monospace';
            ctx.fillText(isFace ? 'EYE TRACK: SECURED' : 'EYE TRACK: RE-ALIGNING', 6, 12);

            animationFrameId = requestAnimationFrame(checkMobileCameraFrame);
        };

        checkMobileCameraFrame();

        return () => cancelAnimationFrame(animationFrameId);
    }, [isLocked, isCameraActive, isPositioning, examEnded]);

    // Callback to trigger locked state upon successful alignment
    const triggerRelockSuccess = async () => {
        if (!sessionId) return;
        isLockingInProgressRef.current = true;
        try {
            await updateDoc(doc(db, 'exam_sessions', sessionId), {
                mobileLockStatus: 'locked',
                mobileLockViolatedAt: null
            });
            setIsPositioning(false);
            setIsViolated(false);
            setIsLocked(true);
            setPositioningTimeLeft(null);
            setLocalWarnings([]);

            // Re-acquire wake lock
            await acquireWakeLock();

            setTimeout(() => {
                isLockingInProgressRef.current = false;
            }, 2000);
        } catch (e) {
            console.error('Relock update failed:', e);
            isLockingInProgressRef.current = false;
        }
    };

    // Callback to terminate session on grace period timeout
    const triggerGracePeriodFailure = async () => {
        if (!sessionId) return;
        try {
            await updateDoc(doc(db, 'exam_sessions', sessionId), {
                status: 'terminated',
                endTime: new Date(),
                terminationReason: 'Failed to position face during mobile camera alignment grace period',
                mobileLockStatus: 'unlocked'
            });
            setIsPositioning(false);
            setIsViolated(false);
            setIsLocked(false);
            setPositioningTimeLeft(null);
            setExamEnded(true);
        } catch (e) {
            console.error('Timeout termination write failed:', e);
        }
    };

    // Force Re-Lock (if fullscreen got exited)
    const handleReLock = async () => {
        if (!sessionId) return;
        
        setError('');
        isLockingInProgressRef.current = true;

        // Reset face confidence so re-lock requires fresh face detection
        faceConfidenceRef.current = 0;
        lastFaceDetectedRef.current = false;
        setFaceDetected(false);
        prevGridFrameRef.current = null;
        
        try {
            // Re-acquire fresh media stream tracks
            if (examSettings.mobileCameraAntiCheat) {
                try {
                    if (mobileStreamRef.current) {
                        mobileStreamRef.current.getTracks().forEach(track => track.stop());
                    }
                    const facing = examSettings.mobileCameraSource === 'rear' ? 'environment' : 'user';
                    const stream = await navigator.mediaDevices.getUserMedia({ 
                        video: { facingMode: facing, width: 320, height: 240 } 
                    });
                    mobileStreamRef.current = stream;
                    setIsCameraActive(true);
                    // Rebind stream to any existing video element
                    if (mobileVideoRef.current) {
                        mobileVideoRef.current.srcObject = stream;
                    }
                } catch (camErr) {
                    console.error('Camera recovery failed:', camErr);
                    setError('Camera permission is required to lock device.');
                    isLockingInProgressRef.current = false;
                    return;
                }
            }

            const el = document.documentElement;
            if (el.requestFullscreen) {
                await el.requestFullscreen();
            } else if ((el as any).webkitRequestFullscreen) {
                await (el as any).webkitRequestFullscreen();
            }
            
            // If camera surveillance is active, enter positioning grace phase
            if (examSettings.mobileCameraAntiCheat) {
                setIsPositioning(true);
                setIsViolated(false);
                setIsLocked(false);
                setPositioningTimeLeft(examSettings.mobileLockGracePeriod || 10);

                setTimeout(() => {
                    isLockingInProgressRef.current = false;
                }, 2000);
            } else {
                // Otherwise directly lock device
                await updateDoc(doc(db, 'exam_sessions', sessionId), {
                    mobileLockStatus: 'locked',
                    mobileLockViolatedAt: null,
                    lastActiveHeartbeat: new Date()
                });
                setIsViolated(false);
                setIsLocked(true);
                setLocalWarnings([]);
                await acquireWakeLock();

                setTimeout(() => {
                    isLockingInProgressRef.current = false;
                }, 2000);
            }
        } catch (e) {
            console.warn(e);
            isLockingInProgressRef.current = false;
        }
    };

    // Camera positioning grace period check loop (stable — uses refs, not state deps)
    useEffect(() => {
        if (!isPositioning || examEnded) return;

        const graceDuration = examSettings.mobileLockGracePeriod || 10;
        let secondsLeft = graceDuration;
        setPositioningTimeLeft(secondsLeft);

        const timer = setInterval(() => {
            // Read face status from ref to avoid dependency churn
            if (lastFaceDetectedRef.current) {
                clearInterval(timer);
                setPositioningTimeLeft(0);
                triggerRelockSuccess();
                return;
            }

            secondsLeft -= 1;
            setPositioningTimeLeft(secondsLeft);

            if (secondsLeft <= 0) {
                clearInterval(timer);
                if (lastFaceDetectedRef.current) {
                    triggerRelockSuccess();
                } else {
                    triggerGracePeriodFailure();
                }
            }
        }, 1000);

        return () => clearInterval(timer);
    }, [isPositioning, examEnded]);

    // Render 1: Exam has ended (Unlock Screen)
    if (examEnded) {
        return (
            <div className="page flex items-center justify-center" style={{ minHeight: '100vh', backgroundColor: '#070a13', color: '#fff', padding: '24px' }}>
                <div className="card text-center" style={{ maxWidth: '400px', border: '1px solid rgba(34, 197, 94, 0.3)', background: 'rgba(3, 7, 18, 0.6)', backdropFilter: 'blur(10px)', boxShadow: '0 8px 32px rgba(34, 197, 94, 0.15)', borderRadius: '16px', padding: '32px' }}>
                    <div style={{ fontSize: '3.5rem', marginBottom: '16px', filter: 'drop-shadow(0 0 10px rgba(34, 197, 94, 0.3))' }}>🔓</div>
                    <h2 style={{ color: '#4ade80', fontWeight: 700, letterSpacing: '0.5px' }}>Device Unlocked</h2>
                    <p style={{ margin: '16px 0', color: '#94a3b8', fontSize: '0.9rem', lineHeight: '1.5' }}>
                        {accessMessage || 'The examination session has ended. Your device lock has been released successfully.'}
                    </p>
                    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', padding: '16px', borderRadius: '12px', fontSize: '0.85rem', color: '#cbd5e1', textAlign: 'left', marginBottom: '24px' }}>
                        Roll No: <strong style={{ color: '#fff' }}>{session?.studentRollNo}</strong><br />
                        Name: <strong style={{ color: '#fff' }}>{session?.studentName}</strong>
                    </div>
                    <button className="btn btn-success" style={{ width: '100%', height: '45px', borderRadius: '8px', fontWeight: 600 }} onClick={() => window.close()}>
                        Close Tab
                    </button>
                </div>
            </div>
        );
    }

    // Render 1.5: Positioning/Alignment Grace Period
    if (isPositioning) {
        return (
            <div style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: '#070a13',
                backgroundImage: 'radial-gradient(circle at center, #0f172a 0%, #020617 100%)',
                color: '#fff',
                zIndex: 99999,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '24px',
                textAlign: 'center',
                fontFamily: 'var(--font-sans)'
            }}>
                <style>{`
                    @keyframes pulse-yellow {
                        0% { opacity: 0.3; transform: scale(0.95); }
                        50% { opacity: 1; transform: scale(1.05); }
                        100% { opacity: 0.3; transform: scale(0.95); }
                    }
                `}</style>
                
                <div style={{ position: 'relative', marginBottom: '20px' }}>
                    <div style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        width: '90px',
                        height: '90px',
                        borderRadius: '50%',
                        border: '2px solid #eab308',
                        animation: 'pulse-yellow 2s infinite',
                        opacity: 0.5
                    }}></div>
                    <div style={{ fontSize: '3rem', filter: 'drop-shadow(0 0 10px rgba(234, 179, 8, 0.3))' }}>
                        ⚙️
                    </div>
                </div>

                <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0 0 8px 0', letterSpacing: '0.5px', color: '#eab308' }}>
                    CAMERA ALIGNMENT
                </h1>
                
                <p style={{ fontSize: '0.85rem', lineHeight: '1.5', maxWidth: '300px', color: '#cbd5e1', margin: '0 0 20px 0' }}>
                    Show your face properly to the camera. The system will automatically unlock your exam once face alignment is verified.
                </p>

                {/* Live camera view with active canvas guide */}
                {isCameraActive && (
                    <div style={{
                        position: 'relative',
                        width: '240px',
                        height: '180px',
                        borderRadius: '8px',
                        overflow: 'hidden',
                        border: faceDetected ? '2px solid #00ff66' : '2px solid #ef4444',
                        marginBottom: '10px',
                        backgroundColor: '#000',
                        boxShadow: faceDetected ? '0 0 20px rgba(0, 255, 102, 0.2)' : 'none'
                    }}>
                        <video
                            ref={setVideoRef}
                            autoPlay
                            playsInline
                            muted
                            style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover',
                                transform: examSettings.mobileCameraSource === 'rear' ? 'none' : 'scaleX(-1)'
                            }}
                        />
                        <canvas
                            ref={mobileCanvasRef}
                            width={240}
                            height={180}
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: '100%',
                                pointerEvents: 'none'
                            }}
                        />
                    </div>
                )}

                {/* Liveness Confidence Bar */}
                {isCameraActive && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '16px' }}>
                        <div style={{ width: '240px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                            <div style={{ width: `${livenessScore}%`, background: livenessScore > 65 ? '#00ff66' : livenessScore > 35 ? '#eab308' : '#ef4444', height: '100%', transition: 'width 0.3s ease, background-color 0.3s ease' }}></div>
                        </div>
                        <span style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: '4px', letterSpacing: '0.5px' }}>
                            ANTI-CHEAT CONFIDENCE: {livenessScore}%
                        </span>
                    </div>
                )}

                <div style={{
                    fontSize: '1.4rem',
                    fontWeight: 800,
                    color: faceDetected ? '#00ff66' : '#eab308',
                    marginBottom: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '4px'
                }}>
                    <span>{faceDetected ? '✅ Face Aligned' : `⌛ Align face: ${positioningTimeLeft}s`}</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#94a3b8' }}>
                        {faceDetected ? 'Resuming exam now...' : 'Pointing camera properly towards face'}
                    </span>
                </div>

                <div style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    padding: '12px',
                    borderRadius: '8px',
                    fontSize: '0.725rem',
                    color: '#94a3b8',
                    maxWidth: '300px',
                    lineHeight: '1.4'
                }}>
                    Place your mobile device properly on the desk pointing the camera at your face from the front side.
                </div>
            </div>
        );
    }

    // Render 2: Device Locked or Violated Takeover Screen
    if (isLocked || isViolated) {
        const showViolationState = isViolated;
        return (
            <div style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: showViolationState ? '#5f0f0f' : '#080d19',
                backgroundImage: showViolationState 
                    ? 'radial-gradient(circle at center, #7f1d1d 0%, #450a0a 100%)' 
                    : 'radial-gradient(circle at center, #0f172a 0%, #020617 100%)',
                color: '#fff',
                zIndex: 99999,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '24px',
                textAlign: 'center',
                fontFamily: 'var(--font-sans)',
                transition: 'background-color 0.5s ease'
            }}>
                <style>{`
                    @keyframes spin {
                        from { transform: rotate(0deg); }
                        to { transform: rotate(360deg); }
                    }
                    @keyframes pulse {
                        0% { opacity: 0.3; transform: scale(0.95); }
                        50% { opacity: 1; transform: scale(1.05); }
                        100% { opacity: 0.3; transform: scale(0.95); }
                    }
                `}</style>

                {/* Padlock pulse animation */}
                <div style={{ position: 'relative', marginBottom: '16px' }}>
                    <div style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        width: '100px',
                        height: '100px',
                        borderRadius: '50%',
                        border: showViolationState ? '2px solid #ef4444' : '2px solid var(--primary-500)',
                        animation: 'pulse 2s infinite',
                        opacity: 0.5
                    }}></div>
                    <div style={{
                        fontSize: '3.5rem',
                        filter: showViolationState 
                            ? 'drop-shadow(0 0 15px rgba(239, 68, 68, 0.4))' 
                            : 'drop-shadow(0 0 15px rgba(99, 102, 241, 0.4))'
                    }}>
                        {showViolationState ? '⚠️' : '🔒'}
                    </div>
                </div>

                <h1 style={{ fontSize: '1.65rem', fontWeight: 800, margin: '0 0 8px 0', letterSpacing: '1px', textTransform: 'uppercase', color: showViolationState ? '#ef4444' : '#fff' }}>
                    {showViolationState ? 'Security Lock Broken' : 'Phone Lock Enabled'}
                </h1>
                
                <p style={{ fontSize: '0.9rem', lineHeight: '1.6', maxWidth: '320px', color: showViolationState ? '#fca5a5' : '#94a3b8', margin: '0 0 20px 0' }}>
                    {showViolationState 
                        ? 'Your desktop exam session has been PAUSED. To resume, you must click the button below to re-engage the secure fullscreen mode.'
                        : 'Your mobile device is locked. Keep this screen active and do not exit fullscreen or lock your phone.'}
                </p>

                {/* Live secondary camera preview inside the locked overlay */}
                {isCameraActive && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div style={{
                            position: 'relative',
                            width: '240px',
                            height: '180px',
                            borderRadius: '8px',
                            overflow: 'hidden',
                            border: '2px solid rgba(0,255,102,0.4)',
                            marginBottom: '8px',
                            backgroundColor: '#000',
                            boxShadow: '0 4px 20px rgba(0, 255, 102, 0.15)'
                        }}>
                            <video
                                ref={setVideoRef}
                                autoPlay
                                playsInline
                                muted
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'cover',
                                    transform: examSettings.mobileCameraSource === 'rear' ? 'none' : 'scaleX(-1)'
                                }}
                            />
                            <canvas
                                ref={mobileCanvasRef}
                                width={240}
                                height={180}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    height: '100%',
                                    pointerEvents: 'none'
                                }}
                            />
                        </div>
                        {/* Liveness Confidence Bar */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '12px' }}>
                             <div style={{ width: '240px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                                 <div style={{ width: `${livenessScore}%`, background: livenessScore > 65 ? '#00ff66' : livenessScore > 35 ? '#eab308' : '#ef4444', height: '100%', transition: 'width 0.3s ease, background-color 0.3s ease' }}></div>
                             </div>
                             <span style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: '4px', letterSpacing: '0.5px' }}>
                                 LIVENESS CONFIDENCE: {livenessScore}%
                             </span>
                         </div>
                        <small style={{ color: '#94a3b8', fontSize: '0.7rem', display: 'block', maxWidth: '200px', marginBottom: '20px', lineHeight: '1.3' }}>
                            Place your phone on the desk pointing the camera properly towards your face.
                        </small>
                    </div>
                )}

                <div style={{
                    background: 'rgba(3, 7, 18, 0.6)',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    width: '100%',
                    maxWidth: '320px',
                    fontSize: '0.825rem',
                    textAlign: 'left',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    marginBottom: '20px',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
                }}>
                    <div style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '6px', marginBottom: '6px' }}>
                        Candidate: <strong style={{ color: '#fff' }}>{session?.studentName}</strong> <br />
                        Roll No: <strong style={{ color: '#fff' }}>{session?.studentRollNo}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Lock Status:</span>
                        {showViolationState ? (
                            <span style={{ color: '#ef4444', fontWeight: 700, animation: 'pulse 1.5s infinite' }}>● VIOLATED</span>
                        ) : (
                            <span style={{ color: '#4ade80', fontWeight: 700 }}>● SECURED</span>
                        )}
                    </div>
                </div>

                {/* Violation list logs */}
                {localWarnings.length > 0 && (
                    <div style={{
                        background: 'rgba(3, 7, 18, 0.85)',
                        padding: '12px',
                        borderRadius: '8px',
                        width: '100%',
                        maxWidth: '320px',
                        fontSize: '0.75rem',
                        textAlign: 'left',
                        maxHeight: '100px',
                        overflowY: 'auto',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        color: '#fca5a5',
                        fontFamily: 'monospace',
                        marginBottom: '20px'
                    }}>
                        <div style={{ color: '#ef4444', fontWeight: 700, marginBottom: '4px' }}>VIOLATIONS LOG:</div>
                        {localWarnings.map((warn, idx) => (
                            <div key={idx} style={{ marginBottom: '2px' }}>{warn}</div>
                        ))}
                    </div>
                )}

                {/* Re-lock button */}
                {showViolationState && (
                    <button 
                        onClick={handleReLock}
                        style={{
                            background: '#ef4444',
                            backgroundImage: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '8px',
                            width: '100%',
                            maxWidth: '320px',
                            height: '48px',
                            fontWeight: 700,
                            fontSize: '0.95rem',
                            cursor: 'pointer',
                            boxShadow: '0 8px 24px rgba(239, 68, 68, 0.3)',
                            letterSpacing: '0.5px'
                        }}
                    >
                        🔒 RE-ENGAGE LOCK & RESUME
                    </button>
                )}
            </div>
        );
    }

    // Render 3: Confirm Identity Screen
    if (session) {
        return (
            <div className="page flex items-center justify-center" style={{ minHeight: '100vh', backgroundColor: '#070a13', padding: '24px' }}>
                <div className="card" style={{ maxWidth: '400px', width: '100%', border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(3, 7, 18, 0.6)', backdropFilter: 'blur(10px)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', borderRadius: '16px', padding: '32px' }}>
                    <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                        <div style={{ fontSize: '3rem', marginBottom: '8px' }}>👤</div>
                        <h3 style={{ color: '#fff', fontSize: '1.25rem', fontWeight: 700 }}>Confirm Identity</h3>
                        <p className="text-secondary" style={{ fontSize: '0.825rem' }}>Verify details before engaging security lock</p>
                    </div>

                    {isCameraActive && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '20px' }}>
                            <div style={{
                                position: 'relative',
                                width: '240px',
                                height: '180px',
                                borderRadius: '8px',
                                overflow: 'hidden',
                                border: faceDetected ? '2px solid #00ff66' : '2px solid #ef4444',
                                backgroundColor: '#000',
                                boxShadow: faceDetected ? '0 0 15px rgba(0,255,102,0.25)' : 'none'
                            }}>
                                <video
                                    ref={setVideoRef}
                                    autoPlay
                                    playsInline
                                    muted
                                    style={{
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'cover',
                                        transform: examSettings.mobileCameraSource === 'rear' ? 'none' : 'scaleX(-1)'
                                    }}
                                />
                                <canvas
                                    ref={mobileCanvasRef}
                                    width={240}
                                    height={180}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: '100%',
                                        height: '100%',
                                        pointerEvents: 'none'
                                    }}
                                />
                            </div>
                            
                            {/* Liveness Confidence Bar */}
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '10px' }}>
                                <div style={{ width: '240px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                                    <div style={{ width: `${livenessScore}%`, background: livenessScore > 65 ? '#00ff66' : livenessScore > 35 ? '#eab308' : '#ef4444', height: '100%', transition: 'width 0.3s ease, background-color 0.3s ease' }}></div>
                                </div>
                                <span style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: '4px', letterSpacing: '0.5px' }}>
                                    ANTI-CHEAT CONFIDENCE: {livenessScore}%
                                </span>
                            </div>
                            
                            <div style={{
                                marginTop: '10px',
                                fontSize: '0.8rem',
                                fontWeight: 700,
                                color: faceDetected ? '#00ff66' : '#ef4444',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px'
                            }}>
                                <span>{faceDetected ? '✅ Face Detected (Lock Available)' : '⚠️ Face Missing / Align Face'}</span>
                            </div>
                        </div>
                    )}

                    <div style={{
                        background: 'rgba(255, 255, 255, 0.02)',
                        border: '1px solid rgba(255,255,255,0.05)',
                        borderRadius: '12px',
                        padding: '12px 16px',
                        marginBottom: '16px'
                    }}>
                        <div style={{ marginBottom: '8px', fontSize: '0.85rem' }}>
                            <span className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Student Name:</span>
                            <div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#fff', marginTop: '2px' }}>{session.studentName}</div>
                        </div>
                        <div style={{ fontSize: '0.85rem' }}>
                            <span className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Roll Number:</span>
                            <div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#fff', marginTop: '2px' }}>{session.studentRollNo}</div>
                        </div>
                    </div>

                    <div style={{
                        fontSize: '0.75rem',
                        lineHeight: '1.4',
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.05)',
                        color: '#94a3b8',
                        padding: '12px',
                        borderRadius: '8px',
                        marginBottom: '20px'
                    }}>
                        ℹ️ <strong>Desk Placement Instructions:</strong><br />
                        Place your phone on the desk pointing the camera properly towards your face from the front side. Lock will only activate when a human face is aligned.
                    </div>

                    {error && (
                        <div className="alert alert-error mb-md" style={{ fontSize: '0.78rem', padding: '10px 14px', borderRadius: '8px', marginBottom: '16px' }}>
                            {error}
                        </div>
                    )}

                    <div className="flex flex-column gap-md">
                        <button 
                            className="btn btn-primary" 
                            style={{ 
                                width: '100%', 
                                height: '48px', 
                                justifyContent: 'center', 
                                borderRadius: '8px', 
                                fontWeight: 600,
                                opacity: (examSettings.mobileCameraAntiCheat && !faceDetected) ? 0.5 : 1
                            }} 
                            onClick={handleLockDevice} 
                            disabled={loading || ((examSettings.mobileCameraAntiCheat && !faceDetected) ? true : false)}
                        >
                            {loading ? <span className="spinner spinner-sm"></span> : '🔒 CONFIRM & LOCK DEVICE'}
                        </button>
                        <button className="btn btn-outline" style={{ width: '100%', height: '48px', borderRadius: '8px' }} onClick={() => setSession(null)}>
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Render 4: Enter passcode verification input screen
    return (
        <div className="page flex items-center justify-center" style={{ minHeight: '100vh', backgroundColor: '#070a13', padding: '24px' }}>
            <div className="card" style={{ maxWidth: '400px', width: '100%', border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(3, 7, 18, 0.6)', backdropFilter: 'blur(10px)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', borderRadius: '16px', padding: '32px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '28px' }}>
                    {institute?.logoUrl ? <img src={institute.logoUrl} alt={institute.name} width="64" height="64" style={{ objectFit: 'contain' }} /> : <Logo />}
                    <p>{institute?.name || 'INVYRIX by NetSyc Technologies'}</p>
                    <h3 className="mt-md" style={{ color: '#fff', fontSize: '1.2rem', fontWeight: 700 }}>Mobile Security Lock</h3>
                    <p className="text-secondary text-center" style={{ fontSize: '0.8rem', marginTop: '6px', lineHeight: '1.4' }}>
                        Enter the unique passcode displayed on your desktop exam verification screen.
                    </p>
                </div>

                <form onSubmit={handleVerifyFormSubmit}>
                    <div className="input-group" style={{ marginBottom: '20px' }}>
                        <label className="input-label" style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Enter Passcode</label>
                        <input
                            type="text"
                            maxLength={10}
                            className="input text-center animate-pulse"
                            placeholder="A1B2C3"
                            value={code}
                            onChange={(e) => setCode(e.target.value.toUpperCase())}
                            style={{
                                width: '100%',
                                boxSizing: 'border-box',
                                fontSize: '1.75rem',
                                letterSpacing: '4px',
                                textTransform: 'uppercase',
                                fontWeight: 800,
                                padding: '14px',
                                background: 'rgba(255,255,255,0.02)',
                                border: '1px solid rgba(255,255,255,0.08)',
                                borderRadius: '8px',
                                color: '#fff'
                            }}
                            required
                        />
                    </div>

                    {error && (
                        <div className="alert alert-error mb-lg" style={{ fontSize: '0.78rem', padding: '10px 14px', borderRadius: '8px' }}>
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        className="btn btn-primary btn-lg"
                        style={{ width: '100%', height: '48px', justifyContent: 'center', borderRadius: '8px', fontWeight: 600 }}
                        disabled={loading}
                    >
                        {loading ? <span className="spinner spinner-sm"></span> : 'Verify & Proceed'}
                    </button>
                </form>
            </div>
        </div>
    );
}
