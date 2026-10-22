import { getSessionDocs } from '../../services/staffData';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getDocs, deleteDoc } from 'firebase/firestore';
import { api } from '../../services/platform';
import { collection, doc } from '../../services/tenant';
import { db } from '../../services/firebase';
import { ExamSession, Exam } from '../../types';
import { useAuth } from '../../context/AuthContext';

interface SessionWithExam {
    session: ExamSession;
    exam: Exam;
}

export default function SessionManager() {
    const { adminData } = useAuth();
    const [sessions, setSessions] = useState<SessionWithExam[]>([]);
    const [exams, setExams] = useState<Exam[]>([]);
    const [selectedExam, setSelectedExam] = useState('');
    const [searchRoll, setSearchRoll] = useState('');
    const [loading, setLoading] = useState(true);
    const [editingSession, setEditingSession] = useState<SessionWithExam | null>(null);
    const [newScore, setNewScore] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState<SessionWithExam | null>(null);

    const fetchSessions = useCallback(async () => {
        setLoading(true);
        try {
            // Fetch exams and sessions in parallel
            const [examsSnapshot, sessionsSnapshot] = await Promise.all([
                getDocs(collection(db, 'exams')),
                getSessionDocs()
            ]);

            let rawExams = examsSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as Exam));
            const rawSessions = sessionsSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as ExamSession));

            // Apply role-based filtering for faculty accounts
            if (adminData?.role === 'faculty') {
                rawExams = rawExams.filter(exam => exam.assignedFaculty?.includes(adminData.id));
            }

            setExams(rawExams);

            const examsMap = new Map(rawExams.map(e => [e.id, e]));
            const sessionsData: SessionWithExam[] = [];

            for (const session of rawSessions) {
                const exam = examsMap.get(session.examId);
                if (exam) {
                    sessionsData.push({
                        session,
                        exam
                    });
                }
            }

            // Sort by date
            sessionsData.sort((a, b) => {
                const dateA = (a.session.startTime as any)?.toDate?.()?.getTime() || 0;
                const dateB = (b.session.startTime as any)?.toDate?.()?.getTime() || 0;
                return dateB - dateA;
            });

            setSessions(sessionsData);
        } catch (err) {
            console.error('Error fetching sessions:', err);
        } finally {
            setLoading(false);
        }
    }, [adminData]);

    useEffect(() => {
        if (adminData) {
            fetchSessions();
        }
    }, [fetchSessions, adminData]);

    // Client-side filtering
    const filteredSessions = useMemo(() => {
        return sessions.filter(({ session }) => {
            // Filter by exam selection
            if (selectedExam && session.examId !== selectedExam) {
                return false;
            }

            // Filter by roll number or student name (trimmed, case-insensitive substring search)
            if (searchRoll) {
                const search = searchRoll.trim().toUpperCase();
                const roll = (session.studentRollNo || '').toUpperCase();
                const name = (session.studentName || '').toUpperCase();
                if (!roll.includes(search) && !name.includes(search)) {
                    return false;
                }
            }

            return true;
        });
    }, [sessions, selectedExam, searchRoll]);

    const handleUpdateScore = async () => {
        if (!editingSession || newScore === '') return;

        const parsedScore = parseInt(newScore);
        const maxScore = editingSession.exam.questions?.reduce((a, q) => a + q.points, 0) || 100;

        if (isNaN(parsedScore) || parsedScore < 0 || parsedScore > maxScore) {
            alert(`Please enter a valid score between 0 and ${maxScore}.`);
            return;
        }

        try {
            await api('saveGrades', { sessionId: editingSession.session.id!, totalScore: parsedScore });

            setEditingSession(null);
            setNewScore('');
            fetchSessions();
        } catch (err) {
            console.error('Error updating score:', err);
            alert('Failed to update score. Please try again.');
        }
    };

    const handleDeleteSession = async () => {
        if (!deleteConfirm) return;

        try {
            await deleteDoc(doc(db, 'exam_sessions', deleteConfirm.session.id!));
            // Also remove from blocked students if exists
            try {
                await deleteDoc(doc(db, 'blocked_students', `${deleteConfirm.session.studentRollNo}_${deleteConfirm.session.examId}`));
            } catch { }

            setDeleteConfirm(null);
            fetchSessions();
        } catch (err) {
            console.error('Error deleting session:', err);
            alert('Failed to delete session. Please try again.');
        }
    };

    const formatDate = (date: any) => {
        if (!date) return 'N/A';
        const d = date.toDate ? date.toDate() : new Date(date);
        return d.toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'completed': return 'badge-success';
            case 'started': return 'badge-warning';
            case 'terminated': return 'badge-error';
            default: return 'badge-secondary';
        }
    };

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">Session Management</h1>
                <p className="page-subtitle">View, edit scores, and manage exam sessions</p>
            </div>

            {/* Filters */}
            <div className="card mb-xl">
                <div className="grid grid-3 gap-md">
                    <div className="input-group">
                        <label className="input-label">Filter by Exam</label>
                        <select className="input" value={selectedExam} onChange={(e) => setSelectedExam(e.target.value)}>
                            <option value="">All Exams</option>
                            {exams.map(exam => (
                                <option key={exam.id} value={exam.id}>{exam.examName}</option>
                            ))}
                        </select>
                    </div>
                    <div className="input-group">
                        <label className="input-label">Search Roll Number / Name</label>
                        <input
                            type="text"
                            className="input"
                            placeholder="Enter roll number or name..."
                            value={searchRoll}
                            onChange={(e) => setSearchRoll(e.target.value)}
                        />
                    </div>
                    <div className="input-group" style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'flex-end', gap: 'var(--space-sm)' }}>
                        <button
                            className="btn btn-secondary"
                            onClick={() => { setSelectedExam(''); setSearchRoll(''); }}
                            disabled={!selectedExam && !searchRoll}
                            style={{ minHeight: '42px', display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                            Clear Filters
                        </button>
                        <button
                            className="btn btn-primary"
                            onClick={fetchSessions}
                            style={{ minHeight: '42px', display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px' }}>
                                <path d="M23 4v6h-6" />
                                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                            </svg>
                            Refresh
                        </button>
                    </div>
                </div>
            </div>

            {/* Filter Count Badges */}
            {!loading && sessions.length > 0 && (
                <div style={{ marginBottom: 'var(--space-md)', fontSize: '0.875rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        Showing <strong>{filteredSessions.length}</strong> of <strong>{sessions.length}</strong> exam sessions
                    </div>
                    {(selectedExam || searchRoll) && (
                        <span className="badge badge-info" style={{ textTransform: 'uppercase', fontSize: '0.7rem' }}>Filters Active</span>
                    )}
                </div>
            )}

            {/* Sessions Table */}
            {loading ? (
                <div className="flex items-center justify-center" style={{ minHeight: '300px' }}>
                    <div className="spinner"></div>
                </div>
            ) : sessions.length > 0 ? (
                filteredSessions.length > 0 ? (
                    <div className="card">
                        <div className="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Roll No.</th>
                                        <th>Student Name</th>
                                        <th>Exam</th>
                                        <th>Status</th>
                                        <th>Score</th>
                                        <th>Date</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredSessions.map(({ session, exam }) => {
                                        const totalPoints = exam.questions?.reduce((a, q) => a + q.points, 0) || 0;
                                        return (
                                            <tr key={session.id}>
                                                <td style={{ fontWeight: 600 }}>{session.studentRollNo}</td>
                                                <td>{session.studentName}</td>
                                                <td>{exam.examName}</td>
                                                <td>
                                                    <span className={`badge ${getStatusBadge(session.status)}`}>
                                                        {session.status.toUpperCase()}
                                                    </span>
                                                </td>
                                                <td>
                                                    {session.status === 'completed' ? (
                                                        <span style={{ fontWeight: 500 }}>{session.score || 0}/{totalPoints}</span>
                                                    ) : (
                                                        <span className="text-muted">N/A</span>
                                                    )}
                                                </td>
                                                <td className="text-muted" style={{ fontSize: '0.875rem' }}>
                                                    {formatDate(session.startTime)}
                                                </td>
                                                <td>
                                                    <div className="flex gap-sm">
                                                        {session.status === 'completed' && (
                                                            <button
                                                                className="btn btn-sm btn-secondary"
                                                                onClick={() => {
                                                                    setEditingSession({ session, exam });
                                                                    setNewScore(String(session.score || 0));
                                                                }}
                                                            >
                                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                                                </svg>
                                                                Edit Score
                                                            </button>
                                                        )}
                                                        <button
                                                            className="btn btn-sm btn-danger"
                                                            onClick={() => setDeleteConfirm({ session, exam })}
                                                        >
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                                            </svg>
                                                            Delete
                                                        </button>
                                                        <Link
                                                            to={`/admin/dashboard/sessions/${session.id}`}
                                                            className="btn btn-sm btn-info"
                                                        >
                                                            Details
                                                        </Link>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : (
                    <div className="card">
                        <div className="empty-state">
                            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" style={{ marginBottom: 'var(--space-lg)' }}>
                                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                            </svg>
                            <p className="empty-state-title">No Matching Results</p>
                            <p className="empty-state-text">No sessions match your active filters. Try clearing your filters or refreshing.</p>
                            <button
                                className="btn btn-secondary mt-md"
                                onClick={() => { setSelectedExam(''); setSearchRoll(''); }}
                                style={{ marginTop: 'var(--space-md)' }}
                            >
                                Clear All Filters
                            </button>
                        </div>
                    </div>
                )
            ) : (
                <div className="card">
                    <div className="empty-state">
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" style={{ marginBottom: 'var(--space-lg)' }}>
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                        </svg>
                        <p className="empty-state-title">No Sessions Found</p>
                        <p className="empty-state-text">There are no exam sessions recorded in the database yet.</p>
                    </div>
                </div>
            )}

            {/* Edit Score Modal */}
            {editingSession && (
                <div className="modal-overlay">
                    <div className="modal">
                        <div className="modal-header">
                            <h3 className="modal-title">Edit Score</h3>
                            <button className="modal-close" onClick={() => setEditingSession(null)}>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="mb-lg">
                                <p className="text-secondary" style={{ marginBottom: 'var(--space-sm)' }}>
                                    <strong>Student:</strong> {editingSession.session.studentName} ({editingSession.session.studentRollNo})
                                </p>
                                <p className="text-secondary" style={{ marginBottom: 0 }}>
                                    <strong>Exam:</strong> {editingSession.exam.examName}
                                </p>
                            </div>
                            <div className="input-group">
                                <label className="input-label">New Score</label>
                                <input
                                    type="number"
                                    className="input"
                                    value={newScore}
                                    onChange={(e) => setNewScore(e.target.value)}
                                    min="0"
                                    max={editingSession.exam.questions?.reduce((a, q) => a + q.points, 0) || 100}
                                />
                                <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: 'var(--space-xs)' }}>
                                    Maximum: {editingSession.exam.questions?.reduce((a, q) => a + q.points, 0) || 0} points
                                </p>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setEditingSession(null)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleUpdateScore}>Update Score</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteConfirm && (
                <div className="modal-overlay">
                    <div className="modal">
                        <div className="modal-header">
                            <h3 className="modal-title">Delete Session</h3>
                            <button className="modal-close" onClick={() => setDeleteConfirm(null)}>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="alert alert-warning mb-lg">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                                </svg>
                                <span>This will permanently delete the session and allow the student to re-take the exam.</span>
                            </div>
                            <p className="text-secondary">
                                <strong>Student:</strong> {deleteConfirm.session.studentName} ({deleteConfirm.session.studentRollNo})<br />
                                <strong>Exam:</strong> {deleteConfirm.exam.examName}
                            </p>
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
