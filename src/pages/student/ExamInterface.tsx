import { tenantId } from '../../services/tenant';
import { studentExam, api } from '../../services/platform';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getDoc, updateDoc, arrayUnion, increment, onSnapshot } from 'firebase/firestore';
import { doc } from '../../services/tenant';
import { db } from '../../services/firebase';
import { ExamSession, Exam, Question, Answer, CheatingEvent } from '../../types';
import { useAntiCheat } from '../../hooks/useAntiCheat';
import { getGeolocation } from '../../utils/deviceUtils';

// Deterministic seed-based pseudo-random number generator (Mulberry32)
function seedRandom(seedStr: string) {
    let h = 0;
    for (let i = 0; i < seedStr.length; i++) {
        h = Math.imul(31, h) + seedStr.charCodeAt(i) | 0;
    }
    return function() {
        let t = h += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Deterministic array shuffle using a seed
function shuffleArray<T>(array: T[], seed: string): T[] {
    const shuffled = [...array];
    const rand = seedRandom(seed);
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const temp = shuffled[i];
        shuffled[i] = shuffled[j];
        shuffled[j] = temp;
    }
    return shuffled;
}

export default function ExamInterface() {
    const { sessionId } = useParams<{ sessionId: string }>();
    const navigate = useNavigate();

    const [session, setSession] = useState<ExamSession | null>(null);
    const [exam, setExam] = useState<Exam | null>(null);
    const [questions, setQuestions] = useState<Question[]>([]);
    const [shuffledOptionsMap, setShuffledOptionsMap] = useState<Map<string, { text: string; originalIndex: number }[]>>(new Map());
    const [currentIndex, setCurrentIndex] = useState(0);
    const [answers, setAnswers] = useState<Map<string, Answer>>(new Map());
    const [timeLeft, setTimeLeft] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const syncRef = useRef<{ serverTime: number; perfTime: number } | null>(null);

    const getSyncNow = useCallback(() => {
        if (!syncRef.current) return Date.now();
        const elapsed = performance.now() - syncRef.current.perfTime;
        return syncRef.current.serverTime + elapsed;
    }, []);

    const getMobileLockUrl = () => {
        const local = ['localhost','127.0.0.1'].includes(window.location.hostname);
        const base = local ? window.location.protocol + '//' + window.location.hostname + ':5174/mobile/' : (import.meta.env.VITE_MOBILE_LOCK_URL || window.location.origin + '/mobile/');
        return base + '?institute=' + encodeURIComponent(tenantId || '');
    };
    const [showWarning, setShowWarning] = useState(false);
    const [warningMessage, setWarningMessage] = useState('');
    const [warningCount, setWarningCount] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    const answersRef = useRef(answers);
    answersRef.current = answers;
    const submitBusy = useRef(false);
    const [isMobilePaused, setIsMobilePaused] = useState(false);
    const [isHeartbeatPaused, setIsHeartbeatPaused] = useState(false);
    const [reengageTimeLeft, setReengageTimeLeft] = useState<number | null>(null);
    const violatedAtMsRef = useRef<number | null>(null);
    const lastHeartbeatTimeRef = useRef<number>(Date.now());

    // Camera Surveillance State & Refs
    const [showCamera, setShowCamera] = useState(false);
    const [isCameraActive, setIsCameraActive] = useState(false);
    const activeStreamRef = useRef<MediaStream | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const baselineRef = useRef<Uint8ClampedArray | null>(null);
    const consecutiveViolationsRef = useRef(0);
    const lastMotionVectorRef = useRef({ x: 0, y: 0 });

    const triggerCameraViolation = useCallback(async (reason: string, details: string) => {
        let maxLimit = 2;
        if (exam?.settings?.maxWarnings !== undefined) {
            maxLimit = exam.settings.maxWarnings;
        }

        setWarningCount(prev => {
            const newCount = prev + 1;
            setWarningMessage(`📷 CAMERA SURVEILLANCE WARNING:\n\n${reason}\n\nYour suspicious activity is noted and logged. Do not do it again or your exam will be terminated.`);
            setShowWarning(true);

            if (sessionId) {
                const event: CheatingEvent = {
                    type: 'split_screen',
                    timestamp: new Date(),
                    details: `Camera Surveillance Gaze/Face Deviation: ${details}`,
                    severity: newCount >= maxLimit ? 'high' : 'medium'
                };
                updateDoc(doc(db, 'exam_sessions', sessionId), {
                    cheatingEvents: arrayUnion(event),
                    warningCount: increment(1)
                }).catch(err => console.error('Error logging camera event:', err));

                if (newCount >= maxLimit) {
                    updateDoc(doc(db, 'exam_sessions', sessionId), {
                        status: 'terminated',
                        endTime: new Date(),
                        terminationReason: 'Camera Surveillance Gaze/Face Deviation',
                        mobileLockStatus: 'unlocked'
                    }).catch(err => console.error('Error terminating session:', err));
                    if (document.fullscreenElement) {
                        document.exitFullscreen().catch(() => {});
                    }
                    navigate('/exam/terminated', { state: { reason: 'Exam terminated due to camera surveillance rule violations.' } });
                }
            }
            return newCount;
        });
    }, [sessionId, exam, session, navigate]);

    // Anti-cheat
    useAntiCheat({
        sessionId: sessionId || '',
        maxWarnings: exam?.settings?.maxWarnings ?? 2,
        initialWarningCount: session?.warningCount || 0,
        getSyncNow,
        onWarning: (message?: string) => {
            setWarningMessage(message || 'Rule violation detected');
            setWarningCount(prev => prev + 1);
            setShowWarning(true);
        },
        onTerminate: async (reason) => {
            if (sessionId && session && exam) {
            }
            // Exit fullscreen on termination
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => { });
            }
            navigate('/exam/terminated', { state: { reason: `Exam terminated: ${reason}` } });
        }
    });

    // Fullscreen enforcement
    useEffect(() => {
        const handleFullscreenChange = () => {
            if (!document.fullscreenElement && !loading && exam) {
                // Try to re-enter fullscreen
                document.documentElement.requestFullscreen().catch(() => {
                    // If can't re-enter, show warning
                    setWarningMessage('Fullscreen mode is required for the exam');
                    setShowWarning(true);
                });
            }
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, [loading, exam]);


    // Fetch data
    useEffect(() => {
        const fetchData = async () => {
            if (!sessionId) return;
            try {
                // Sync clock with server to neutralize local time tampering
                let serverTime = Date.now();
                let perfTime = performance.now();
                try {
                    const startFetch = performance.now();
                    const response = await fetch(window.location.origin + '/?t=' + Date.now(), { method: 'HEAD' });
                    const serverDateStr = response.headers.get('date');
                    if (serverDateStr) {
                        const endFetch = performance.now();
                        const latency = (endFetch - startFetch) / 2;
                        serverTime = new Date(serverDateStr).getTime() + latency;
                        perfTime = performance.now();
                    }
                } catch (e) {
                    console.warn('Failed to sync server time, falling back to local clock:', e);
                }
                syncRef.current = { serverTime, perfTime };

                const sessionDoc = await getDoc(doc(db, 'exam_sessions', sessionId));
                if (!sessionDoc.exists() || sessionDoc.data().status !== 'started') {
                    navigate('/'); return;
                }
                if (!sessionDoc.data().beganAt) { navigate('/exam/verify', { state: { sessionId, examName: 'Exam', duration: 0, studentName: sessionDoc.data().studentName } }); return; }
                const sessionData = { id: sessionDoc.id, ...sessionDoc.data() } as ExamSession;
                setSession(sessionData);
                setWarningCount(sessionData.warningCount || 0);

                const examDoc = await studentExam(sessionId!);
                if (examDoc.exists()) {
                    const examData = { ...examDoc.data(), id: examDoc.id } as Exam;
                    setExam(examData);
                    
                    // Enforce Device Restriction
                    const deviceRestriction = examData.settings?.deviceRestriction || 'both';
                    const isMobile = window.matchMedia("(pointer:coarse)").matches ||
                        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                    if (deviceRestriction === 'mobile_only' && !isMobile) {
                        navigate('/exam/terminated', { state: { reason: 'Access Denied: This exam is restricted to mobile devices only.' } });
                        return;
                    } else if (deviceRestriction === 'desktop_only' && isMobile) {
                        navigate('/exam/terminated', { state: { reason: 'Access Denied: This exam is restricted to desktop or laptop devices only.' } });
                        return;
                    }

                    // Enforce Late Entry Policy
                    if (examData.settings?.schedulingEnabled) {
                        const startVal = examData.settings.scheduledStartTime;
                        const startTimeMs = startVal.toDate ? startVal.toDate().getTime() : new Date(startVal).getTime();
                        const lateEntryPolicy = examData.settings.lateEntryPolicy || 'allow';
                        
                        if (lateEntryPolicy === 'disallow' && getSyncNow() > startTimeMs) {
                            const sessionCreatedVal = sessionData.createdAt || sessionData.startTime;
                            const sessionCreatedTimeMs = sessionCreatedVal?.toDate ? sessionCreatedVal.toDate().getTime() : new Date(sessionCreatedVal).getTime();
                            
                            if (sessionCreatedTimeMs > startTimeMs + 1000) {
                                navigate('/exam/terminated', { state: { reason: 'Access Denied: Late entry is not permitted for this exam.' } });
                                return;
                            }
                        }
                    }
                    
                    let loadedQuestions = examData.questions || [];
                    if (examData.settings?.shuffleQuestions) {
                        loadedQuestions = shuffleArray(loadedQuestions, sessionId || '');
                    }
                    setQuestions(loadedQuestions);

                    // Setup shuffled MCQ options
                    const optionsMap = new Map<string, { text: string; originalIndex: number }[]>();
                    loadedQuestions.forEach(q => {
                        if (q.type === 'mcq' && q.options) {
                            const optsWithIdx = q.options.map((opt, i) => ({ text: opt, originalIndex: i }));
                            if (examData.settings?.shuffleOptions) {
                                optionsMap.set(q.id, shuffleArray(optsWithIdx, (sessionId || '') + q.id));
                            } else {
                                optionsMap.set(q.id, optsWithIdx);
                            }
                        }
                    });
                    setShuffledOptionsMap(optionsMap);

                    // Properly convert Firestore Timestamp to Date
                    const startTimeData = sessionDoc.data().startTime;
                    const startTimeMs = startTimeData?.toDate ? startTimeData.toDate().getTime() : startTimeData?.getTime?.() || getSyncNow();
                    const elapsed = Math.floor((getSyncNow() - startTimeMs) / 1000);
                    let remaining = Math.max(0, examData.duration * 60 - elapsed);

                    if (examData.settings?.schedulingEnabled && examData.settings?.scheduledEndTime) {
                        const endVal = examData.settings.scheduledEndTime;
                        const endTimeMs = endVal.toDate ? endVal.toDate().getTime() : new Date(endVal).getTime();
                        const scheduleRemaining = Math.max(0, Math.floor((endTimeMs - getSyncNow()) / 1000));
                        remaining = Math.min(remaining, scheduleRemaining);
                    }
                    setTimeLeft(remaining);
                }

                // Load saved answers
                const savedAnswers = new Map<string, Answer>();
                sessionData.answers?.forEach(a => savedAnswers.set(a.questionId, a));
                setAnswers(savedAnswers);
            } catch (err) { console.error(err); }
            finally { setLoading(false); }
        };
        fetchData();
    }, [sessionId, navigate]);

    // Timer - Sync with Wall Clock to prevent drift
    useEffect(() => {
        if (!session || !exam || loading) return;

        const calculateTimeLeft = () => {
            const startTimeData = session.startTime;
            // Handle Firestore Timestamp or Date object
            const startTimeMs = startTimeData instanceof Date
                ? startTimeData.getTime()
                : (startTimeData as any).toDate().getTime();

            const elapsedSeconds = Math.floor((getSyncNow() - startTimeMs) / 1000);
            let remaining = Math.max(0, exam.duration * 60 - elapsedSeconds);

            if (exam.settings?.schedulingEnabled && exam.settings?.scheduledEndTime) {
                const endVal = exam.settings.scheduledEndTime;
                const endTimeMs = endVal.toDate ? endVal.toDate().getTime() : new Date(endVal).getTime();
                const scheduleRemaining = Math.max(0, Math.floor((endTimeMs - getSyncNow()) / 1000));
                remaining = Math.min(remaining, scheduleRemaining);
            }
            return remaining;
        };

        // Initial set
        setTimeLeft(calculateTimeLeft());


        const timer = setInterval(() => {
            const remaining = calculateTimeLeft();
            setTimeLeft(remaining);

            if (remaining <= 0) {
                clearInterval(timer);
                handleSubmit();
            }
        }, 1000);

        return () => clearInterval(timer);
    }, [session, exam, loading]);

    // Camera Surveillance activation hook
    useEffect(() => {
        if (!exam?.settings?.cameraAntiCheat) return;

        const startSurveillance = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
                activeStreamRef.current = stream;
                setShowCamera(true);
                setIsCameraActive(true);
                setTimeout(() => {
                    if (videoRef.current) {
                        videoRef.current.srcObject = stream;
                    }
                }, 200);
            } catch (err) {
                console.error('Failed to launch webcam surveillance:', err);
                triggerCameraViolation(
                    'Surveillance Camera stream disconnected or access denied.',
                    'Webcam feed could not be verified or was disabled during the exam.'
                );
            }
        };

        startSurveillance();

        return () => {
            if (activeStreamRef.current) {
                activeStreamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, [exam, triggerCameraViolation]);

    // Real-time listener for session warnings and status updates (syncing mobile lock violations)
    useEffect(() => {
        if (!sessionId) return;

        const unsubscribe = onSnapshot(doc(db, 'exam_sessions', sessionId), (snap: any) => {
            if (snap.exists()) {
                const data = snap.data() as ExamSession;
                
                // If status became terminated
                if (data.status === 'terminated') {
                    if (document.fullscreenElement) {
                        document.exitFullscreen().catch(() => {});
                    }
                    navigate('/exam/terminated', { 
                        state: { reason: `Exam terminated: ${data.terminationReason || 'Security violations detected'}` } 
                    });
                    return;
                }

                // Sync warning count and show popups for mobile lock violations
                if (data.warningCount !== undefined && data.warningCount > warningCount) {
                    const events = data.cheatingEvents || [];
                    const lastEvent = events[events.length - 1];
                    
                    if (lastEvent && lastEvent.type === 'mobile_lock_violation') {
                        setWarningCount(data.warningCount);
                        setWarningMessage(`📱 MOBILE LOCK SECURITY ALERT:\n\n${lastEvent.details}\n\nYour suspicious mobile activity has been noted and logged. Do not touch your mobile device or your exam will get terminated.`);
                        setShowWarning(true);
                    } else if (lastEvent && lastEvent.type === 'mobile_camera_violation') {
                        setWarningCount(data.warningCount);
                        setWarningMessage(`📷 SECONDARY MOBILE CAMERA WARNING:\n\n${lastEvent.details}\n\nSuspicious head rotation, gaze shift, or movement away from the secondary mobile camera lens detected.\n\nPlease place your mobile device properly on the desk and face both screens. Continued violations will terminate your exam.`);
                        setShowWarning(true);
                    } else {
                        setWarningCount(data.warningCount);
                    }
                }

                // Sync heartbeat timestamp
                if (data.lastActiveHeartbeat) {
                    let heartbeatMs = Date.now();
                    if (typeof data.lastActiveHeartbeat.toDate === 'function') {
                        heartbeatMs = data.lastActiveHeartbeat.toDate().getTime();
                    } else if (data.lastActiveHeartbeat instanceof Date) {
                        heartbeatMs = data.lastActiveHeartbeat.getTime();
                    } else if (typeof data.lastActiveHeartbeat === 'string') {
                        heartbeatMs = new Date(data.lastActiveHeartbeat).getTime();
                    } else if (data.lastActiveHeartbeat.seconds) {
                        heartbeatMs = data.lastActiveHeartbeat.seconds * 1000;
                    }
                    lastHeartbeatTimeRef.current = heartbeatMs;
                }

                if (data.mobileLockStatus === 'violated') {
                    setIsMobilePaused(true);
                    let violatedAtMs = Date.now();
                    if (data.mobileLockViolatedAt) {
                        if (typeof data.mobileLockViolatedAt.toDate === 'function') {
                            violatedAtMs = data.mobileLockViolatedAt.toDate().getTime();
                        } else if (data.mobileLockViolatedAt instanceof Date) {
                            violatedAtMs = data.mobileLockViolatedAt.getTime();
                        } else if (typeof data.mobileLockViolatedAt === 'string') {
                            violatedAtMs = new Date(data.mobileLockViolatedAt).getTime();
                        } else if (data.mobileLockViolatedAt.seconds) {
                            violatedAtMs = data.mobileLockViolatedAt.seconds * 1000;
                        }
                    }
                    violatedAtMsRef.current = violatedAtMs;
                } else if (data.mobileLockStatus === 'locked') {
                    setIsMobilePaused(false);
                    violatedAtMsRef.current = null;
                    setReengageTimeLeft(null);
                }
            }
        });

        return () => unsubscribe();
    }, [sessionId, warningCount, navigate]);

    // Callback to terminate when mobile lock timeout is exceeded
    const handleTimeoutTermination = useCallback(async () => {
        if (!sessionId) return;
        try {
            await updateDoc(doc(db, 'exam_sessions', sessionId), {
                status: 'terminated',
                endTime: new Date(),
                terminationReason: 'Mobile Lock re-engagement timeout exceeded',
                mobileLockStatus: 'unlocked'
            });

            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
            }
            navigate('/exam/terminated', { state: { reason: 'Exam terminated because you failed to relock your mobile phone within the required limit.' } });
        } catch (e) {
            console.error('Failed to terminate on mobile lock timeout:', e);
        }
    }, [sessionId, exam, session, navigate]);

    // Timer countdown loop for mobile lock re-engagement
    useEffect(() => {
        if (!isMobilePaused || violatedAtMsRef.current === null) {
            setReengageTimeLeft(null);
            return;
        }

        const limit = exam?.settings?.mobileLockReengageLimit || 30;

        const checkTime = () => {
            if (violatedAtMsRef.current === null) return;
            const elapsed = Math.floor((Date.now() - violatedAtMsRef.current) / 1000);
            const remaining = Math.max(0, limit - elapsed);
            setReengageTimeLeft(remaining);

            if (remaining <= 0) {
                clearInterval(interval);
                handleTimeoutTermination();
            }
        };

        const interval = setInterval(checkTime, 1000);
        checkTime();
        return () => clearInterval(interval);
    }, [isMobilePaused, exam, handleTimeoutTermination]);

    // Real-Time Mobile Connection Heartbeat monitoring loop (checks in-memory every 3 seconds for zero database reads)
    useEffect(() => {
        if (!sessionId || !exam?.settings?.mobileLocking || loading) return;

        const checkHeartbeat = async () => {
            const elapsed = Date.now() - lastHeartbeatTimeRef.current;
            
            // If phone heartbeat is missing for more than 10 seconds (offline or closed app)
            if (session?.mobileLockStatus === 'locked' && elapsed > 10000) {
                setIsHeartbeatPaused(true);
                try {
                    // Set local state immediately to pause screen for instant UX response
                    setIsMobilePaused(true);
                    // Update DB to register the lock violation
                    await updateDoc(doc(db, 'exam_sessions', sessionId), {
                        mobileLockStatus: 'violated',
                        mobileLockViolatedAt: new Date()
                    });
                } catch (e) {
                    console.warn('Heartbeat violation state update failed:', e);
                }
            } else if (elapsed <= 10000) {
                setIsHeartbeatPaused(false);
            }
        };

        // Run checking interval slightly faster (3s) to match the mobile worker cadence
        const interval = setInterval(checkHeartbeat, 3000);
        return () => clearInterval(interval);
    }, [sessionId, exam, loading, session?.mobileLockStatus]);

    // Eyemovement & Face tracking animation feed draw loop
    useEffect(() => {
        if (!isCameraActive || !canvasRef.current || !videoRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationFrameId: number;
        let frameCount = 0;

        const drawTrackingOverlay = () => {
            frameCount++;
            if (!videoRef.current || !canvas) return;

            // Clear
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const w = canvas.width;
            const h = canvas.height;

            // 1. Core optical analysis loop (runs every 3 frames for high performance)
            if (frameCount % 3 === 0) {
                try {
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = 40;
                    tempCanvas.height = 30;
                    const tempCtx = tempCanvas.getContext('2d');
                    if (tempCtx && videoRef.current) {
                        tempCtx.drawImage(videoRef.current, 0, 0, 40, 30);
                        const imgData = tempCtx.getImageData(0, 0, 40, 30);
                        const pixels = imgData.data;

                        if (!baselineRef.current) {
                            // Capture baseline after frame has stabilized (about 2s)
                            if (frameCount > 30) {
                                baselineRef.current = new Uint8ClampedArray(pixels);
                            }
                        } else {
                            let leftDiff = 0, centerDiff = 0, rightDiff = 0;
                            let leftCount = 0, centerCount = 0, rightCount = 0;

                            for (let y = 0; y < 30; y++) {
                                for (let x = 0; x < 40; x++) {
                                    const idx = (y * 40 + x) * 4;
                                    const rDiff = Math.abs(pixels[idx] - baselineRef.current[idx]);
                                    const gDiff = Math.abs(pixels[idx + 1] - baselineRef.current[idx + 1]);
                                    const bDiff = Math.abs(pixels[idx + 2] - baselineRef.current[idx + 2]);
                                    const pixelDiff = (rDiff + gDiff + bDiff) / 3;

                                    if (x < 13) {
                                        leftDiff += pixelDiff;
                                        leftCount++;
                                    } else if (x > 26) {
                                        rightDiff += pixelDiff;
                                        rightCount++;
                                    } else {
                                        centerDiff += pixelDiff;
                                        centerCount++;
                                    }
                                }
                            }

                            const avgLeft = leftDiff / leftCount;
                            const avgCenter = centerDiff / centerCount;
                            const avgRight = rightDiff / rightCount;

                            // Calculate horizontal/vertical motion differential vector
                            const diffLR = avgLeft - avgRight;
                            // Dampen vector with smoothing filter
                            const motionVectorX = diffLR * 1.5;
                            const motionVectorY = (avgCenter - (avgLeft + avgRight) / 2) * 1.2;

                            lastMotionVectorRef.current = {
                                x: lastMotionVectorRef.current.x * 0.7 + motionVectorX * 0.3,
                                y: lastMotionVectorRef.current.y * 0.7 + motionVectorY * 0.3
                            };

                            // Thresholds for head movement/rotation
                            const rotThreshold = 22;
                            const vertThreshold = 25;

                            if (Math.abs(lastMotionVectorRef.current.x) > rotThreshold || Math.abs(lastMotionVectorRef.current.y) > vertThreshold) {
                                consecutiveViolationsRef.current += 1;
                                if (consecutiveViolationsRef.current >= 10) { // ~2 seconds of continuous deviation
                                    consecutiveViolationsRef.current = 0;
                                    triggerCameraViolation(
                                        'Gaze deviation or head rotation detected.',
                                        `Candidate turned their face away from the screen (X-offset: ${lastMotionVectorRef.current.x.toFixed(1)}, Y-offset: ${lastMotionVectorRef.current.y.toFixed(1)}).`
                                    );
                                }
                            } else {
                                if (consecutiveViolationsRef.current > 0) {
                                    consecutiveViolationsRef.current = Math.max(0, consecutiveViolationsRef.current - 0.4);
                                }
                            }
                        }
                    }
                } catch (e) {
                    // Fail silently
                }
            }

            // 2. Render overlays
            // Scanning reticle bounding edges
            ctx.strokeStyle = consecutiveViolationsRef.current > 4 ? 'rgba(239, 68, 68, 0.4)' : 'rgba(0, 255, 102, 0.4)';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(8, 20); ctx.lineTo(8, 8); ctx.lineTo(20, 8); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(w - 8, 20); ctx.lineTo(w - 8, 8); ctx.lineTo(w - 20, 8); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(8, h - 20); ctx.lineTo(8, h - 8); ctx.lineTo(20, h - 8); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(w - 8, h - 20); ctx.lineTo(w - 8, h - 8); ctx.lineTo(w - 20, h - 8); ctx.stroke();

            // Tracking crosshair from centroid
            const crosshairX = w / 2 - lastMotionVectorRef.current.x * 2.2;
            const crosshairY = h / 2 + lastMotionVectorRef.current.y * 1.2;

            // Draw tracking bounding box around face region
            const bWidth = 110;
            const bHeight = 120;
            const bx = (w - bWidth) / 2 + (crosshairX - w / 2) * 0.4;
            const by = (h - bHeight) / 2 - 5 + (crosshairY - h / 2) * 0.4;

            ctx.strokeStyle = consecutiveViolationsRef.current > 4 ? 'rgba(239, 68, 68, 0.7)' : 'rgba(0, 255, 102, 0.7)';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(bx, by, bWidth, bHeight);

            // Bounding Corner indicators
            ctx.fillStyle = consecutiveViolationsRef.current > 4 ? 'rgba(239, 68, 68, 0.9)' : 'rgba(0, 255, 102, 0.9)';
            ctx.fillRect(bx - 3, by - 3, 6, 6);
            ctx.fillRect(bx + bWidth - 3, by - 3, 6, 6);
            ctx.fillRect(bx - 3, by + bHeight - 3, 6, 6);
            ctx.fillRect(bx + bWidth - 3, by + bHeight - 3, 6, 6);

            // Eye lock indicators (dynamic tracking dots that target pupil clusters)
            const leftEyeX = bx + 30 + (crosshairX - w / 2) * 0.15;
            const leftEyeY = by + 40 + (crosshairY - h / 2) * 0.15;
            const rightEyeX = bx + 80 + (crosshairX - w / 2) * 0.15;
            const rightEyeY = by + 40 + (crosshairY - h / 2) * 0.15;

            ctx.strokeStyle = consecutiveViolationsRef.current > 4 ? 'rgba(239, 68, 68, 0.8)' : 'rgba(0, 255, 102, 0.8)';
            ctx.lineWidth = 1;
            
            // Left Eye crosshair
            ctx.beginPath(); ctx.arc(leftEyeX, leftEyeY, 4, 0, 2 * Math.PI); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(leftEyeX - 7, leftEyeY); ctx.lineTo(leftEyeX + 7, leftEyeY); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(leftEyeX, leftEyeY - 7); ctx.lineTo(leftEyeX, leftEyeY + 7); ctx.stroke();

            // Right Eye crosshair
            ctx.beginPath(); ctx.arc(rightEyeX, rightEyeY, 4, 0, 2 * Math.PI); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(rightEyeX - 7, rightEyeY); ctx.lineTo(rightEyeX + 7, rightEyeY); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(rightEyeX, rightEyeY - 7); ctx.lineTo(rightEyeX, rightEyeY + 7); ctx.stroke();

            // Eyewear filter label
            ctx.fillStyle = 'rgba(0, 255, 102, 0.8)';
            ctx.font = '7px monospace';
            ctx.fillText('👓 EYEWEAR_COMPATIBLE_MODE: ACTIVE', bx + 5, by + 110);

            // Gaze tracking pointer dot
            ctx.fillStyle = consecutiveViolationsRef.current > 4 ? 'rgba(239, 68, 68, 0.95)' : 'rgba(0, 255, 102, 0.95)';
            ctx.beginPath();
            ctx.arc(crosshairX, crosshairY, 4, 0, 2 * Math.PI);
            ctx.fill();

            // Vector lines
            ctx.strokeStyle = consecutiveViolationsRef.current > 4 ? 'rgba(239, 68, 68, 0.4)' : 'rgba(0, 255, 102, 0.4)';
            ctx.beginPath();
            ctx.moveTo(w / 2, h / 2);
            ctx.lineTo(crosshairX, crosshairY);
            ctx.stroke();

            // Radar Sweep line
            const scanY = by + (Math.sin(frameCount * 0.04) + 1) * (bHeight / 2);
            ctx.strokeStyle = consecutiveViolationsRef.current > 4 ? 'rgba(239, 68, 68, 0.3)' : 'rgba(0, 255, 102, 0.3)';
            ctx.beginPath(); ctx.moveTo(bx, scanY); ctx.lineTo(bx + bWidth, scanY); ctx.stroke();

            // Labels
            ctx.fillStyle = consecutiveViolationsRef.current > 4 ? 'rgba(239, 68, 68, 0.9)' : 'rgba(0, 255, 102, 0.9)';
            ctx.font = '8px monospace';
            ctx.fillText('CAM_SURVEILLANCE: ENGAGED', 12, 20);
            ctx.fillText(`GAZE_OFFSET_X: ${lastMotionVectorRef.current.x.toFixed(1)}`, 12, 30);
            ctx.fillText(`GAZE_OFFSET_Y: ${lastMotionVectorRef.current.y.toFixed(1)}`, 12, 40);
            
            if (consecutiveViolationsRef.current > 4) {
                ctx.fillText(`⚠️ ROTATION_DEVIATION: ${Math.round(consecutiveViolationsRef.current * 10)}%`, 12, 50);
            } else {
                ctx.fillText(`TRACKING: ACTIVE (OK)`, 12, 50);
            }

            animationFrameId = requestAnimationFrame(drawTrackingOverlay);
        };

        drawTrackingOverlay();

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [isCameraActive]);

    // Gaze Deviation Trigger: Gaze slips out of browser viewport boundary
    useEffect(() => {
        if (!exam?.settings?.cameraAntiCheat) return;

        const handleMouseLeaveViewport = () => {
            triggerCameraViolation(
                'Suspicious gaze deviation detected.',
                'Candidate eyes shifted away from the exam screen boundary.'
            );
        };

        document.addEventListener('mouseleave', handleMouseLeaveViewport);
        return () => {
            document.removeEventListener('mouseleave', handleMouseLeaveViewport);
        };
    }, [exam, triggerCameraViolation]);

    // Camera coverage / black lens anti-cheat sampling loop
    useEffect(() => {
        if (!isCameraActive || !canvasRef.current || !videoRef.current) return;

        const checkLensOcclusion = () => {
            if (!videoRef.current || !canvasRef.current) return;

            try {
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = 10;
                tempCanvas.height = 10;
                const tempCtx = tempCanvas.getContext('2d');
                if (!tempCtx) return;

                // Draw frame to calculate average brightness
                tempCtx.drawImage(videoRef.current, 0, 0, 10, 10);
                const data = tempCtx.getImageData(0, 0, 10, 10).data;

                let sum = 0;
                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i];
                    const g = data[i+1];
                    const b = data[i+2];
                    sum += (0.2126 * r + 0.7152 * g + 0.0722 * b);
                }
                const brightness = sum / 100;

                // Value below 10 indicates obscured feed or black screenshot
                if (brightness < 10) {
                    triggerCameraViolation(
                        'Video feed obscured or webcam blocked.',
                        'Surveillance feed luminance level drops below minimum threshold (possible camera cover).'
                    );
                }
            } catch (e) {
                console.warn('Frame sampler skipped:', e);
            }
        };

        const interval = setInterval(checkLensOcclusion, 4000);
        return () => clearInterval(interval);
    }, [isCameraActive, triggerCameraViolation]);

    // A stable interval also saves during continuous typing.
    useEffect(() => {
        const interval = setInterval(() => {
            if (sessionId && answersRef.current.size > 0 && !submitBusy.current) {
                api('saveAnswers', { sessionId, answers: Array.from(answersRef.current.values()) }).catch(error => console.warn('Unable to save answers:', error));
            }
        }, 30000);
        return () => clearInterval(interval);
    }, [sessionId]);

    const handleAnswer = (answer: string | number) => {
        const q = questions[currentIndex];
        setAnswers(prev => new Map(prev).set(q.id, { questionId: q.id, answer, answeredAt: new Date() }));
    };

    const handleSubmit = async () => {
        if (submitBusy.current || !sessionId) return;
        submitBusy.current = true;
        setSubmitting(true);
        try {

            let endLocation = null;
            try {
                const coords = await getGeolocation();
                endLocation = {
                    latitude: coords.latitude,
                    longitude: coords.longitude,
                    accuracy: coords.accuracy,
                    timestamp: new Date()
                };
            } catch (geoErr) {
                console.warn('Could not capture location at submission:', geoErr);
            }

            await api('submitExam', { sessionId, answers: Array.from(answersRef.current.values()), endLocation });
            // Exit fullscreen
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => { });
            }
            navigate(`/exam/results/${sessionId}`);
        } catch (err) {
            console.error(err);
            setWarningMessage(err instanceof Error ? err.message : 'Submission failed. Your answers remain on this screen; please retry.');
            setShowWarning(true);
            submitBusy.current = false;
            setSubmitting(false);
        }
    };

    const formatTime = (s: number) => {
        const m = Math.floor(s / 60);
        return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    };

    const handleDismissWarning = () => {
        setShowWarning(false);
        // Re-enter fullscreen
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => { });
        }
    };

    if (loading) {
        return (
            <div className="page flex items-center justify-center" style={{ minHeight: '100vh' }}>
                <div className="spinner"></div>
            </div>
        );
    }

    if (!exam || !session || questions.length === 0) {
        return (
            <div className="page flex items-center justify-center" style={{ minHeight: '100vh' }}>
                <div className="card text-center" style={{ padding: 'var(--space-2xl)' }}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2" style={{ margin: '0 auto var(--space-lg)' }}>
                        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <h2>Exam Not Available</h2>
                    <p className="text-secondary">This exam session is invalid or has expired.</p>
                    <button className="btn btn-primary mt-lg" onClick={() => navigate('/')}>
                        Return to Home
                    </button>
                </div>
            </div>
        );
    }

    const currentQ = questions[currentIndex];
    const currentAnswer = answers.get(currentQ.id);

    return (
        <div style={{ minHeight: '100vh', background: 'var(--bg-dark)' }}>
            {/* Warning Modal */}
            {showWarning && (
                <div className="warning-overlay">
                    <div className="warning-content">
                        <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" style={{ marginBottom: 'var(--space-lg)' }}>
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                        <h2 className="warning-title">WARNING</h2>
                        <p className="warning-text">
                            {warningMessage}
                            <br />
                            {exam?.settings?.maxWarnings ? (
                                (exam.settings.maxWarnings - warningCount <= 1) ? (
                                    <strong>One more violation will terminate your exam and block your roll number.</strong>
                                ) : (
                                    <span>You have received {warningCount} of {exam.settings.maxWarnings} warning(s). {exam.settings.maxWarnings - warningCount} warning(s) remaining.</span>
                                )
                            ) : (
                                <strong>One more violation will terminate your exam and block your roll number.</strong>
                            )}
                        </p>
                        <button className="btn btn-lg" style={{ background: 'white', color: 'var(--error)' }} onClick={handleDismissWarning}>
                            I Understand - Continue Exam
                        </button>
                    </div>
                </div>
            )}

            <style>{`
                .exam-header {
                    position: sticky;
                    top: 0;
                    background: var(--bg-surface);
                    border-bottom: 1px solid var(--border-color);
                    padding: var(--space-md) var(--space-lg);
                    zIndex: 100;
                }
                .exam-layout-container {
                    display: grid;
                    grid-template-columns: 1fr 280px;
                    gap: var(--space-xl);
                }
                .exam-container-wrapper {
                    padding: var(--space-xl);
                    max-width: 1200px;
                    margin: 0 auto;
                }
                @media (max-width: 768px) {
                    .exam-header {
                        padding: var(--space-sm) var(--space-md) !important;
                    }
                    .exam-header h1 {
                        font-size: 1.1rem !important;
                    }
                    .exam-header p {
                        font-size: 0.75rem !important;
                    }
                    .exam-layout-container {
                        grid-template-columns: 1fr !important;
                        gap: var(--space-lg) !important;
                    }
                    .exam-container-wrapper {
                        padding: var(--space-md) !important;
                    }
                    .btn {
                        padding: var(--space-md) !important;
                        font-size: 0.9rem !important;
                    }
                }
            `}</style>

            {/* Header */}
            <header className="exam-header">
                <div className="flex justify-between items-center">
                    <div>
                        <h1 style={{ fontSize: '1.25rem', margin: 0 }}>{exam.examName}</h1>
                        <p className="text-muted" style={{ fontSize: '0.813rem', margin: 0 }}>{session.studentName} ({session.studentRollNo})</p>
                    </div>
                    <div className={`timer ${(timeLeft ?? 0) < 300 ? 'critical' : (timeLeft ?? 0) < 600 ? 'warning' : ''}`}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                        </svg>
                        <span>{formatTime(timeLeft ?? 0)}</span>
                    </div>
                </div>
            </header>

            <div className="exam-container-wrapper">
                <div className="exam-layout-container">
                    {/* Question Area */}
                    <div className="card">
                        <div className="flex justify-between items-center mb-lg">
                            <span className="badge badge-primary">Question {currentIndex + 1} of {questions.length}</span>
                            <span className="badge badge-info">{currentQ.points} point{currentQ.points > 1 ? 's' : ''}</span>
                        </div>

                        <h3 style={{ fontSize: '1.25rem', marginBottom: 'var(--space-xl)', lineHeight: 1.5 }}>{currentQ.text}</h3>

                        {currentQ.type === 'mcq' && (
                            <div className="flex flex-col gap-md">
                                {(shuffledOptionsMap.get(currentQ.id) || currentQ.options.map((opt, i) => ({ text: opt, originalIndex: i }))).map((opt) => {
                                    const isSelected = currentAnswer?.answer === opt.originalIndex;
                                    return (
                                        <label key={opt.originalIndex} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', padding: 'var(--space-md)', background: isSelected ? 'rgba(99, 102, 241, 0.2)' : 'var(--bg-input)', border: `1px solid ${isSelected ? 'var(--primary-500)' : 'var(--border-color)'}`, borderRadius: 'var(--radius-lg)', cursor: 'pointer', transition: 'all var(--transition-fast)' }}>
                                            <input type="radio" name="answer" checked={isSelected} onChange={() => handleAnswer(opt.originalIndex)} style={{ width: '18px', height: '18px' }} />
                                            <span>{opt.text}</span>
                                        </label>
                                    );
                                })}
                            </div>
                        )}

                        {currentQ.type === 'true_false' && (
                            <div className="flex gap-md">
                                {['true', 'false'].map(v => (
                                    <button key={v} className={`btn ${currentAnswer?.answer === v ? 'btn-primary' : 'btn-secondary'}`} style={{ flex: 1, padding: 'var(--space-lg)' }} onClick={() => handleAnswer(v)}>
                                        {v.charAt(0).toUpperCase() + v.slice(1)}
                                    </button>
                                ))}
                            </div>
                        )}

                        {currentQ.type === 'short_answer' && (
                            <textarea className="input" rows={4} placeholder="Type your answer..." value={currentAnswer?.answer as string || ''} onChange={(e) => handleAnswer(e.target.value)} />
                        )}

                        <div className="flex justify-between mt-xl">
                            <button className="btn btn-ghost" onClick={() => setCurrentIndex(i => Math.max(0, i - 1))} disabled={currentIndex === 0}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="15 18 9 12 15 6" />
                                </svg>
                                Previous
                            </button>
                            {currentIndex < questions.length - 1 ? (
                                <button className="btn btn-primary" onClick={() => setCurrentIndex(i => i + 1)}>
                                    Next
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <polyline points="9 18 15 12 9 6" />
                                    </svg>
                                </button>
                            ) : (
                                <button className="btn btn-success" onClick={handleSubmit} disabled={submitting}>
                                    {submitting ? <span className="spinner spinner-sm"></span> : (
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <polyline points="20 6 9 17 4 12" />
                                        </svg>
                                    )}
                                    Submit Exam
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Sidebar */}
                    <div>
                        <div className="card mb-lg">
                            <h4 style={{ marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                                    <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                                </svg>
                                Question Navigator
                            </h4>
                            <div className="question-nav">
                                {questions.map((q, i) => (
                                    <button key={q.id} className={`question-nav-btn ${i === currentIndex ? 'current' : ''} ${answers.has(q.id) ? 'answered' : ''}`} onClick={() => setCurrentIndex(i)}>{i + 1}</button>
                                ))}
                            </div>
                            <div className="flex gap-md mt-lg" style={{ fontSize: '0.75rem' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)' }}></span>
                                    Answered: {answers.size}
                                </span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--text-muted)' }}></span>
                                    Remaining: {questions.length - answers.size}
                                </span>
                            </div>
                        </div>
                        <button className="btn btn-success btn-lg" style={{ width: '100%' }} onClick={handleSubmit} disabled={submitting}>
                            {submitting ? <span className="spinner spinner-sm"></span> : (
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                            )}
                            Submit Exam
                        </button>
                    </div>
                </div>
            </div>

            {showCamera && (
                <div style={{
                    position: 'fixed',
                    bottom: '24px',
                    right: '24px',
                    width: '180px',
                    height: '135px',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
                    border: '2px solid var(--primary-500)',
                    zIndex: 9999,
                    background: '#000'
                }}>
                    <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            transform: 'scaleX(-1)'
                        }}
                    />
                    <canvas
                        ref={canvasRef}
                        width={180}
                        height={135}
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                            pointerEvents: 'none'
                        }}
                    />
                    <div style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        backgroundColor: 'rgba(0, 0, 0, 0.6)',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '9px',
                        color: '#fff',
                        fontFamily: 'monospace'
                    }}>
                        <span style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            backgroundColor: '#ef4444',
                            display: 'inline-block'
                        }}></span>
                        REC
                    </div>
                </div>
            )}

            {isMobilePaused && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(15, 23, 42, 0.96)',
                    backdropFilter: 'blur(16px)',
                    zIndex: 100000,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    textAlign: 'center',
                    fontFamily: 'var(--font-sans)',
                    padding: '24px'
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
                    <div style={{ position: 'relative', marginBottom: '24px' }}>
                        <div style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            width: '120px',
                            height: '120px',
                            borderRadius: '50%',
                            border: '3px dashed #ef4444',
                            animation: 'spin 12s linear infinite'
                        }}></div>
                        <div style={{ fontSize: '5rem', animation: 'pulse 1.5s infinite' }}>📱</div>
                    </div>
                    <h1 style={{ color: '#ef4444', fontSize: '2.25rem', fontWeight: 800, margin: '0 0 12px 0', letterSpacing: '0.5px' }}>EXAM PAUSED</h1>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '24px' }}>{isHeartbeatPaused ? 'Mobile Monitoring Connection Lost' : 'Mobile Security Lock Disconnected'}</h2>
                    <p style={{ maxWidth: '480px', fontSize: '0.95rem', color: '#94a3b8', lineHeight: '1.6', marginBottom: '24px' }}>
                        {isHeartbeatPaused 
                            ? 'Your exam session is locked because the internet connection from your mobile device was lost or the lock app became inactive.' 
                            : 'Your exam session is locked because you switched apps, minimized the browser, or unlocked the screen on your mobile device.'}
                        <br /><br />
                        To resume taking the exam, open the mobile locking screen on your phone, verify your internet is active, and press <strong style={{ color: '#ef4444' }}>"RE-ENGAGE LOCK"</strong>.
                        <div style={{
                            marginTop: '20px',
                            background: 'rgba(255, 255, 255, 0.03)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            padding: '12px 18px',
                            borderRadius: '8px',
                            textAlign: 'center'
                        }}>
                            <span style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
                                📱 Scan or navigate to this link on your phone to reconnect:
                            </span>
                            <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: '#818cf8', fontWeight: 600, wordBreak: 'break-all' }}>
                                {getMobileLockUrl()}&code={session?.mobileLockCode || ''}
                            </span>
                        </div>
                    </p>

                    {reengageTimeLeft !== null && (
                        <div style={{
                            fontSize: '1.5rem',
                            fontWeight: 800,
                            color: '#ef4444',
                            marginBottom: '24px',
                            animation: 'pulse 1.2s infinite',
                            letterSpacing: '0.5px'
                        }}>
                            ⏳ TERMINATION IN: {reengageTimeLeft} SECONDS
                        </div>
                    )}

                    <div style={{ 
                        background: 'rgba(239, 68, 68, 0.1)', 
                        border: '1px solid rgba(239, 68, 68, 0.2)', 
                        borderRadius: '8px', 
                        padding: '12px 24px', 
                        fontSize: '0.85rem', 
                        color: '#fca5a5',
                        fontFamily: 'monospace'
                    }}>
                        STATUS: Awaiting Phone Lock Re-Engagement...
                    </div>
                </div>
            )}
        </div>
    );
}
