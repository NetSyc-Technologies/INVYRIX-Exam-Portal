import { useState, useEffect } from 'react';
import { onSnapshot, updateDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { collection, doc } from '../../services/tenant';
import { db } from '../../services/firebase';
import { ExamSession, Exam } from '../../types';
import { formatDeviceName } from '../../utils/deviceUtils';

export default function LiveMonitor() {
    const [sessions, setSessions] = useState<ExamSession[]>([]);
    const [exams, setExams] = useState<Map<string, Exam>>(new Map());
    const [filter, setFilter] = useState<'all' | 'active' | 'terminated'>('all');
    const [loading, setLoading] = useState(true);
    const [selectedSession, setSelectedSession] = useState<ExamSession | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<ExamSession | null>(null);

    const handleDeleteSession = async () => {
        if (!deleteConfirm) return;

        try {
            await deleteDoc(doc(db, 'exam_sessions', deleteConfirm.id!));
            // Remove from blocked students if exists
            try {
                await deleteDoc(doc(db, 'blocked_students', `${deleteConfirm.studentRollNo}_${deleteConfirm.examId}`));
            } catch (err) { }

            setDeleteConfirm(null);
        } catch (err) {
            console.error('Error deleting session:', err);
            alert('Failed to delete exam session. Please try again.');
        }
    };

    useEffect(() => {
        // Fetch exams for reference
        const fetchExams = async () => {
            const examsSnapshot = await getDocs(collection(db, 'exams'));
            const examsMap = new Map<string, Exam>();
            examsSnapshot.docs.forEach(doc => {
                examsMap.set(doc.id, { id: doc.id, ...doc.data() } as Exam);
            });
            setExams(examsMap);
        };
        fetchExams();

        // Real-time listener for sessions
        const unsubscribe = onSnapshot(
            collection(db, 'exam_sessions'),
            (snapshot) => {
                const sessionsData = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data(),
                    startTime: doc.data().startTime?.toDate?.() || new Date(),
                    endTime: doc.data().endTime?.toDate?.()
                })) as ExamSession[];

                setSessions(sessionsData.sort((a, b) => b.startTime.getTime() - a.startTime.getTime()));
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, []);

    const handleTerminate = async (session: ExamSession) => {
        try {
            // Update session status
            await updateDoc(doc(db, 'exam_sessions', session.id), {
                status: 'terminated',
                endTime: new Date(),
                terminationReason: 'Manually terminated by staff'
            });

            // The server trigger records the block for every termination source.
        } catch (error) {
            console.error('Error terminating session:', error);
        }
    };

    const getSessionDuration = (session: ExamSession) => {
        const end = session.endTime || new Date();
        const diff = Math.floor((end.getTime() - session.startTime.getTime()) / 60000);
        return `${diff} min`;
    };

    const filteredSessions = sessions.filter(s => {
        if (filter === 'active') return s.status === 'started';
        if (filter === 'terminated') return s.status === 'terminated';
        return true;
    });

    if (loading) {
        return (
            <div className="flex items-center justify-center" style={{ minHeight: '50vh' }}>
                <div className="spinner"></div>
            </div>
        );
    }

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">Live Monitor</h1>
                <p className="page-subtitle">Real-time exam session monitoring and cheating alerts</p>
            </div>

            {/* Stats */}
            <div className="grid grid-4 mb-xl">
                <div className="stat-card">
                    <div className="stat-icon success">👁️</div>
                    <div className="stat-content">
                        <div className="stat-value">{sessions.filter(s => s.status === 'started').length}</div>
                        <div className="stat-label">Active Sessions</div>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon info">✅</div>
                    <div className="stat-content">
                        <div className="stat-value">{sessions.filter(s => s.status === 'completed').length}</div>
                        <div className="stat-label">Completed</div>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon error">🚫</div>
                    <div className="stat-content">
                        <div className="stat-value">{sessions.filter(s => s.status === 'terminated').length}</div>
                        <div className="stat-label">Terminated</div>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon warning">⚠️</div>
                    <div className="stat-content">
                        <div className="stat-value">
                            {sessions.reduce((acc, s) => acc + (s.cheatingEvents?.length || 0), 0)}
                        </div>
                        <div className="stat-label">Total Alerts</div>
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className="card mb-lg">
                <div className="flex gap-sm">
                    {(['all', 'active', 'terminated'] as const).map((status) => (
                        <button
                            key={status}
                            className={`btn ${filter === status ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => setFilter(status)}
                        >
                            {status.charAt(0).toUpperCase() + status.slice(1)}
                        </button>
                    ))}
                </div>
            </div>

            {/* Sessions Table */}
            {filteredSessions.length > 0 ? (
                <div className="card">
                    <div className="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Student</th>
                                    <th>Roll No</th>
                                    <th>Exam</th>
                                    <th>Device</th>
                                    <th>Started</th>
                                    <th>Duration</th>
                                    <th>Tab Switches</th>
                                    <th>Warnings</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredSessions.map((session) => (
                                    <tr key={session.id}>
                                        <td style={{ fontWeight: 500 }}>{session.studentName}</td>
                                        <td>{session.studentRollNo}</td>
                                        <td>{exams.get(session.examId)?.examName || session.examId}</td>
                                        <td style={{ fontSize: '0.813rem', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={session.deviceInfo?.userAgent}>
                                            {session.deviceInfo?.deviceName || 'Unknown Device'}
                                        </td>
                                        <td style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                                            {session.startTime.toLocaleTimeString()}
                                        </td>
                                        <td>{getSessionDuration(session)}</td>
                                        <td>
                                            <span className={`badge ${session.tabSwitchCount > 0 ? 'badge-warning' : 'badge-success'}`}>
                                                {session.tabSwitchCount || 0}
                                            </span>
                                        </td>
                                        <td>
                                            <span className={`badge ${(session.warningCount || 0) > 0 ? 'badge-error' : 'badge-success'}`}>
                                                {session.warningCount || 0}
                                            </span>
                                        </td>
                                        <td>
                                            <span className={`badge badge-${session.status === 'started' ? 'success' :
                                                session.status === 'completed' ? 'info' :
                                                    session.status === 'terminated' ? 'error' : 'warning'
                                                }`}>
                                                {session.status}
                                            </span>
                                        </td>
                                        <td>
                                            <div className="flex gap-sm">
                                                <button
                                                    className="btn btn-ghost btn-sm"
                                                    onClick={() => setSelectedSession(session)}
                                                    title="View Details"
                                                >
                                                    👁️
                                                </button>
                                                {session.status === 'started' && (
                                                    <button
                                                        className="btn btn-danger btn-sm"
                                                        onClick={() => handleTerminate(session)}
                                                        title="Terminate Session"
                                                    >
                                                        ⛔
                                                    </button>
                                                )}
                                                <button
                                                    className="btn btn-danger btn-sm"
                                                    onClick={() => setDeleteConfirm(session)}
                                                    title="Delete Session"
                                                    style={{ padding: '4px 8px', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                                                >
                                                    🗑️
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="card">
                    <div className="empty-state">
                        <div className="empty-state-icon">👁️</div>
                        <p className="empty-state-title">No sessions found</p>
                        <p className="empty-state-text">
                            {filter === 'active' ? 'No active sessions at the moment' : 'Sessions will appear here when students start exams'}
                        </p>
                    </div>
                </div>
            )}

            {/* Session Details Modal */}
            {selectedSession && (
                <div className="modal-overlay" onClick={() => setSelectedSession(null)}>
                    <div className="modal" style={{ maxWidth: '600px' }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Session Details</h3>
                            <button className="modal-close" onClick={() => setSelectedSession(null)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div className="grid grid-2 gap-md mb-lg">
                                <div>
                                    <p className="text-muted" style={{ fontSize: '0.813rem' }}>Student Name</p>
                                    <p style={{ fontWeight: 500 }}>{selectedSession.studentName}</p>
                                </div>
                                <div>
                                    <p className="text-muted" style={{ fontSize: '0.813rem' }}>Roll Number</p>
                                    <p style={{ fontWeight: 500 }}>{selectedSession.studentRollNo}</p>
                                </div>
                                <div>
                                    <p className="text-muted" style={{ fontSize: '0.813rem' }}>Exam</p>
                                    <p>{exams.get(selectedSession.examId)?.examName || selectedSession.examId}</p>
                                </div>
                                <div>
                                    <p className="text-muted" style={{ fontSize: '0.813rem' }}>Status</p>
                                    <span className={`badge badge-${selectedSession.status === 'started' ? 'success' :
                                        selectedSession.status === 'completed' ? 'info' : 'error'
                                        }`}>
                                        {selectedSession.status}
                                    </span>
                                </div>
                            </div>

                            <h4 style={{ marginBottom: 'var(--space-sm)' }}>Device & Geolocation Metrics</h4>
                            <div className="card mb-lg" style={{ background: 'var(--bg-surface)', padding: 'var(--space-md)', fontSize: '0.85rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
                                <div className="mb-sm">
                                    <strong>Device:</strong> {formatDeviceName(selectedSession.deviceInfo)}
                                </div>
                                <div className="mb-sm">
                                    <strong>Platform & Screen:</strong> {selectedSession.deviceInfo?.platform || 'Unknown'} ({selectedSession.deviceInfo?.screenWidth}x{selectedSession.deviceInfo?.screenHeight})
                                </div>
                                <div className="grid grid-2 gap-md mt-md pt-sm" style={{ borderTop: '1px solid var(--border-color)' }}>
                                    <div>
                                        <div className="text-muted" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Start Location</div>
                                        {selectedSession.startLocation ? (
                                            <div>
                                                <span style={{ fontSize: '0.78rem', display: 'block', margin: '4px 0' }}>
                                                    Lat: {selectedSession.startLocation.latitude.toFixed(6)}<br />
                                                    Lng: {selectedSession.startLocation.longitude.toFixed(6)}
                                                </span>
                                                <a 
                                                    href={`https://www.google.com/maps?q=${selectedSession.startLocation.latitude},${selectedSession.startLocation.longitude}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="btn btn-secondary btn-sm"
                                                    style={{ display: 'inline-flex', padding: '4px 8px', fontSize: '0.72rem', gap: '4px', textDecoration: 'none', marginTop: '4px' }}
                                                >
                                                    📍 See Location
                                                </a>
                                            </div>
                                        ) : (
                                            <span className="text-muted italic" style={{ fontSize: '0.78rem' }}>Not captured</span>
                                        )}
                                    </div>
                                    <div>
                                        <div className="text-muted" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Submission Location</div>
                                        {selectedSession.endLocation ? (
                                            <div>
                                                <span style={{ fontSize: '0.78rem', display: 'block', margin: '4px 0' }}>
                                                    Lat: {selectedSession.endLocation.latitude.toFixed(6)}<br />
                                                    Lng: {selectedSession.endLocation.longitude.toFixed(6)}
                                                </span>
                                                <a 
                                                    href={`https://www.google.com/maps?q=${selectedSession.endLocation.latitude},${selectedSession.endLocation.longitude}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="btn btn-secondary btn-sm"
                                                    style={{ display: 'inline-flex', padding: '4px 8px', fontSize: '0.72rem', gap: '4px', textDecoration: 'none', marginTop: '4px' }}
                                                >
                                                    📍 See Location
                                                </a>
                                            </div>
                                        ) : (
                                            <span className="text-muted italic" style={{ fontSize: '0.78rem' }}>Not captured</span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <h4 style={{ marginBottom: 'var(--space-md)' }}>Cheating Events ({selectedSession.cheatingEvents?.length || 0})</h4>
                            {selectedSession.cheatingEvents && selectedSession.cheatingEvents.length > 0 ? (
                                <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                                    {selectedSession.cheatingEvents.map((event, index) => (
                                        <div key={index} className="alert alert-warning mb-sm">
                                            <span>{event.type === 'tab_switch' ? '🔄' : event.type === 'keyboard_shortcut' ? '⌨️' : '⚠️'}</span>
                                            <div>
                                                <p style={{ fontWeight: 500, margin: 0 }}>{event.type.replace(/_/g, ' ').toUpperCase()}</p>
                                                <p className="text-muted" style={{ fontSize: '0.813rem', margin: 0 }}>
                                                    {new Date(event.timestamp).toLocaleString()} - {event.details}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-muted">No cheating events recorded</p>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-ghost" onClick={() => setSelectedSession(null)}>Close</button>
                            {selectedSession.status === 'started' && (
                                <button
                                    className="btn btn-danger"
                                    onClick={() => {
                                        handleTerminate(selectedSession);
                                        setSelectedSession(null);
                                    }}
                                >
                                    Terminate Session
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
            {/* Delete Session Confirmation Modal */}
            {deleteConfirm && (
                <div className="modal-overlay">
                    <div className="modal" style={{ maxWidth: '440px' }}>
                        <div className="modal-header">
                            <h3 className="modal-title">Delete Session</h3>
                            <button className="modal-close" onClick={() => setDeleteConfirm(null)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div className="alert alert-warning mb-lg">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px' }}>
                                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                                </svg>
                                <span>Deleting this session is permanent. The student will be allowed to re-register and re-take the exam.</span>
                            </div>
                            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', fontSize: '0.9rem' }}>
                                <strong>Student Name:</strong> {deleteConfirm.studentName}<br />
                                <strong>Roll Number:</strong> {deleteConfirm.studentRollNo}<br />
                                <strong>Exam:</strong> {exams.get(deleteConfirm.examId)?.examName || deleteConfirm.examId}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                            <button className="btn btn-danger" onClick={handleDeleteSession}>Delete Session</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
