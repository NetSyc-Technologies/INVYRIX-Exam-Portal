import { useEffect, useRef, useCallback } from 'react';
import { updateDoc, arrayUnion, increment } from 'firebase/firestore';
import { doc } from '../services/tenant';
import { db } from '../services/firebase';
import { CheatingEvent } from '../types';

interface UseAntiCheatProps {
    sessionId: string;
    maxWarnings?: number;
    initialWarningCount?: number;
    onWarning: (message?: string) => void;
    onTerminate: (reason: string) => void;
    getSyncNow?: () => number;
}

export function useAntiCheat({ sessionId, maxWarnings = 2, initialWarningCount = 0, onWarning, onTerminate, getSyncNow }: UseAntiCheatProps) {
    const warningCount = useRef(0);
    const isTerminated = useRef(false);

    // Sync initialWarningCount once when it becomes available
    const initialized = useRef(false);
    useEffect(() => {
        if (initialWarningCount > 0 && !initialized.current) {
            warningCount.current = initialWarningCount;
            initialized.current = true;
        }
    }, [initialWarningCount]);

    const recordEvent = useCallback(async (type: CheatingEvent['type'], details: string, severity: CheatingEvent['severity']) => {
        if (isTerminated.current || !sessionId) return;

        try {
            const event: CheatingEvent = { type, timestamp: getSyncNow ? new Date(getSyncNow()) : new Date(), details, severity };
            await updateDoc(doc(db, 'exam_sessions', sessionId), {
                cheatingEvents: arrayUnion(event),
                tabSwitchCount: type === 'tab_switch' ? increment(1) : increment(0),
                warningCount: increment(1)
            });
        } catch (err) {
            console.error('Error recording event:', err);
        }
    }, [sessionId]);

    const handleViolation = useCallback(async (type: CheatingEvent['type'], details: string, displayMessage: string) => {
        if (isTerminated.current || !sessionId) return;

        warningCount.current += 1;
        
        const severity: CheatingEvent['severity'] = warningCount.current >= maxWarnings
            ? 'high'
            : warningCount.current >= maxWarnings / 2
                ? 'medium'
                : 'low';
        
        await recordEvent(type, details, severity);

        if (warningCount.current >= maxWarnings) {
            isTerminated.current = true;
            try {
                await updateDoc(doc(db, 'exam_sessions', sessionId), {
                    status: 'terminated',
                    endTime: new Date(),
                    terminationReason: type.replace(/_/g, ' ')
                });
            } catch (err) {
                console.error('Error updating session:', err);
            }
            onTerminate(type.replace(/_/g, ' '));
        } else {
            onWarning(displayMessage);
        }
    }, [sessionId, recordEvent, onWarning, onTerminate, maxWarnings]);

    useEffect(() => {
        if (!sessionId) return;

        // Tab visibility
        const handleVisibility = () => {
            if (document.hidden) {
                handleViolation('tab_switch', 'Tab switched or window minimized', 'Tab switching or window minimization detected');
            }
        };

        // Window blur (when switching to another window)
        const handleBlur = () => {
            handleViolation('tab_switch', 'Window focus lost', 'You switched away from the exam window');
        };

        // Context menu (right-click)
        const handleContextMenu = (e: MouseEvent) => {
            e.preventDefault();
            handleViolation('context_menu', 'Right-click attempted', 'Right-click is not allowed during the exam');
        };

        // Keyboard shortcuts
        const handleKeyDown = (e: KeyboardEvent) => {
            // Block Ctrl/Cmd + C, V, X, U, S, P, A
            if ((e.ctrlKey || e.metaKey) && ['c', 'v', 'x', 'u', 's', 'p', 'a'].includes(e.key.toLowerCase())) {
                e.preventDefault();
                handleViolation('keyboard_shortcut', `Ctrl+${e.key.toUpperCase()} pressed`, `Keyboard shortcut Ctrl+${e.key.toUpperCase()} is not allowed`);
            }
            // Block F1-F12
            if (e.key.match(/^F([1-9]|1[0-2])$/)) {
                e.preventDefault();
                handleViolation('keyboard_shortcut', `${e.key} pressed`, `Function key ${e.key} is not allowed`);
            }
            // Block Ctrl+Shift+I/J/C (DevTools)
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j', 'c'].includes(e.key.toLowerCase())) {
                e.preventDefault();
                handleViolation('devtools', 'DevTools shortcut pressed', 'Opening developer tools is not allowed');
            }
            // Block Alt+Tab simulation (Alt key)
            if (e.altKey && e.key === 'Tab') {
                e.preventDefault();
                handleViolation('tab_switch', 'Alt+Tab pressed', 'Switching windows is not allowed');
            }
            // Block Escape in fullscreen (let browser handle, but warn)
            if (e.key === 'Escape' && document.fullscreenElement) {
                e.preventDefault();
                handleViolation('fullscreen_exit', 'Escape key pressed', 'You cannot exit fullscreen during the exam');
            }
            // Block Print Screen
            if (e.key === 'PrintScreen') {
                e.preventDefault();
                handleViolation('keyboard_shortcut', 'PrintScreen pressed', 'Screen capture is not allowed');
            }
        };

        // Copy/Paste/Cut
        const handleCopy = (e: ClipboardEvent) => {
            e.preventDefault();
            handleViolation('copy_paste', 'Copy attempted', 'Copying content is not allowed');
        };
        const handlePaste = (e: ClipboardEvent) => {
            e.preventDefault();
            handleViolation('copy_paste', 'Paste attempted', 'Pasting content is not allowed');
        };
        const handleCut = (e: ClipboardEvent) => {
            e.preventDefault();
            handleViolation('copy_paste', 'Cut attempted', 'Cutting content is not allowed');
        };

        // Fullscreen exit
        const handleFullscreen = () => {
            if (!document.fullscreenElement && !isTerminated.current) {
                handleViolation('fullscreen_exit', 'Exited fullscreen mode', 'Exiting fullscreen mode is not allowed');
            }
        };

        // Selection (prevent text selection)
        const handleSelect = (e: Event) => {
            e.preventDefault();
        };

        // Disable drag
        const handleDrag = (e: DragEvent) => {
            e.preventDefault();
        };

        // Prevent tab/browser closing or reloading
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = 'Are you sure you want to exit the exam? Your attempt will be terminated and flagged.';
            return e.returnValue;
        };

        document.addEventListener('visibilitychange', handleVisibility);
        window.addEventListener('blur', handleBlur);
        document.addEventListener('contextmenu', handleContextMenu);
        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('copy', handleCopy);
        document.addEventListener('paste', handlePaste);
        document.addEventListener('cut', handleCut);
        document.addEventListener('fullscreenchange', handleFullscreen);
        document.addEventListener('selectstart', handleSelect);
        document.addEventListener('dragstart', handleDrag);
        window.addEventListener('beforeunload', handleBeforeUnload);

        // Disable text selection via CSS
        document.body.style.userSelect = 'none';
        document.body.style.webkitUserSelect = 'none';

        return () => {
            document.removeEventListener('visibilitychange', handleVisibility);
            window.removeEventListener('blur', handleBlur);
            document.removeEventListener('contextmenu', handleContextMenu);
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('copy', handleCopy);
            document.removeEventListener('paste', handlePaste);
            document.removeEventListener('cut', handleCut);
            document.removeEventListener('fullscreenchange', handleFullscreen);
            document.removeEventListener('selectstart', handleSelect);
            document.removeEventListener('dragstart', handleDrag);
            window.removeEventListener('beforeunload', handleBeforeUnload);

            // Restore text selection
            document.body.style.userSelect = '';
            document.body.style.webkitUserSelect = '';
        };
    }, [sessionId, handleViolation]);

    // Split-screen / Resize / Polling Detection
    useEffect(() => {
        if (!sessionId) return;

        let resizeTimeout: NodeJS.Timeout;

        const checkSplitScreen = () => {
            if (isTerminated.current) return;

            const isMobile = window.matchMedia("(pointer:coarse)").matches ||
                /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

            if (isMobile) {
                const screenWidth = window.screen.width;
                const screenHeight = window.screen.height;
                const windowWidth = window.innerWidth;
                const windowHeight = window.innerHeight;

                // Check for vertical split (width reduced)
                if (windowWidth < screenWidth * 0.85) {
                    handleViolation('split_screen', `Vertical split screen detected (Window: ${windowWidth}px, Screen: ${screenWidth}px)`, 'Split screen is not allowed. Please use full screen.');
                    return;
                }

                // Check for horizontal split (height reduced)
                const activeTag = document.activeElement?.tagName.toLowerCase();
                if (activeTag !== 'input' && activeTag !== 'textarea') {
                    if (windowHeight < screenHeight * 0.75) {
                        handleViolation('split_screen', `Horizontal split screen detected (Window: ${windowHeight}px, Screen: ${screenHeight}px)`, 'Split screen is not allowed. Please use full screen.');
                    }
                }
            }
        };

        const handleResize = () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                checkSplitScreen();
            }, 200);
        };

        const handlePiP = () => {
            handleViolation('split_screen', 'Picture-in-Picture mode activated', 'Picture-in-picture mode is not allowed during the exam');
        };

        // Run initial check on mount
        checkSplitScreen();

        // Run regular polling every 2 seconds
        const interval = setInterval(checkSplitScreen, 2000);

        window.addEventListener('resize', handleResize);
        window.addEventListener('orientationchange', handleResize);
        document.addEventListener('enterpictureinpicture', handlePiP, true);

        return () => {
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('orientationchange', handleResize);
            document.removeEventListener('enterpictureinpicture', handlePiP, true);
            clearTimeout(resizeTimeout);
            clearInterval(interval);
        };
    }, [sessionId, handleViolation]);

    return { warningCount: warningCount.current };
}
