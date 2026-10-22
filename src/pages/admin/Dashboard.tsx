import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { onSnapshot, deleteDoc } from 'firebase/firestore';
import { collection, doc } from '../../services/tenant';
import { db } from '../../services/firebase';
import { ExamSession, Exam } from '../../types';
import FacultyDashboard from './FacultyDashboard';
import { useAuth } from '../../context/AuthContext';
import PortalIcon from '../../components/PortalIcon';
import { summarizeDashboard, timestampMillis } from '../../utils/dashboard';

// SVG Icons
const ExamIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
    </svg>
);

const CheckIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="20 6 9 17 4 12" />
    </svg>
);

const UsersIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
);

const AlertIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
);

const PlusIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
);

const EyeIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);

const ChartIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
);

const BlockIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
);

export default function Dashboard() {
    const { adminData } = useAuth();
    return adminData?.role === 'faculty' ? <FacultyDashboard /> : <AdminOverview />;
}

function AdminOverview() {
    const { adminData } = useAuth();
    const [sessions, setSessions] = useState<ExamSession[]>([]);
    const [exams, setExams] = useState<Exam[]>([]);
    const [loadErrors, setLoadErrors] = useState({ exams: '', sessions: '' });
    const [retry, setRetry] = useState(0);
    const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
    const stats = useMemo(() => summarizeDashboard(exams, sessions), [exams, sessions]);
    const recentSessions = useMemo(() => [...sessions].sort((a, b) => timestampMillis(b.startTime) - timestampMillis(a.startTime)).slice(0, 5), [sessions]);
    const recentExams = useMemo(() => [...exams].sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt)).slice(0, 5), [exams]);
    const [loading, setLoading] = useState(true);
    const [deleteConfirm, setDeleteConfirm] = useState<ExamSession | null>(null);

    useEffect(() => {
        let examsReady = false;
        let sessionsReady = false;
        setLoading(true);
        setLoadErrors({ exams: '', sessions: '' });
        const ready = () => setLoading(!(examsReady && sessionsReady));
        const unsubscribeExams = onSnapshot(collection(db, 'exams'), snapshot => {
            setExams(snapshot.docs.map(item => ({ ...item.data(), id: item.id } as Exam)));
            setLoadErrors(previous => ({ ...previous, exams: '' }));
            setUpdatedAt(new Date());
            examsReady = true;
            ready();
        }, () => {
            setLoadErrors(previous => ({ ...previous, exams: 'Exam data could not be updated.' }));
            examsReady = true;
            ready();
        });
        const unsubscribeSessions = onSnapshot(collection(db, 'exam_sessions'), snapshot => {
            setSessions(snapshot.docs.map(item => ({ ...item.data(), id: item.id } as ExamSession)));
            setLoadErrors(previous => ({ ...previous, sessions: '' }));
            setUpdatedAt(new Date());
            sessionsReady = true;
            ready();
        }, () => {
            setLoadErrors(previous => ({ ...previous, sessions: 'Session data could not be updated.' }));
            sessionsReady = true;
            ready();
        });
        return () => { unsubscribeExams(); unsubscribeSessions(); };
    }, [retry]);

    const handleDeleteSession = async () => {
        if (!deleteConfirm) return;

        try {
            await deleteDoc(doc(db, 'exam_sessions', deleteConfirm.id!));
            // Remove from blocked students list if present
            try {
                await deleteDoc(doc(db, 'blocked_students', `${deleteConfirm.studentRollNo}_${deleteConfirm.examId}`));
            } catch (err) {
                // Ignore if student wasn't blocked
            }

            setDeleteConfirm(null);
        } catch (err) {
            console.error('Error deleting session:', err);
            alert('Failed to delete exam session. Please try again.');
        }
    };

    if (loading) {
        return (
            <div className="dashboard-skeleton" role="status" aria-label="Loading dashboard"><div /><div /><div /><div /><p>Loading your workspace…</p></div>
        );
    }

    return (
        <div className="dashboard-overview">
            <div className="page-header dashboard-heading">
                <div><p className="dashboard-eyebrow">EXAM OPERATIONS</p><h1 className="page-title">Your workspace, at a glance.</h1>
                <p className="page-subtitle">Welcome back{adminData?.name ? `, ${adminData.name.split(' ')[0]}` : ''}. Here’s what’s happening across your exams.</p></div>
                <Link to="/admin/dashboard/exams/create" className="btn btn-primary"><PlusIcon /> Create exam</Link>
            </div>
            <div className="dashboard-status"><span><span className="status-dot" /> {loadErrors.exams || loadErrors.sessions ? 'Updates interrupted' : 'Automatic updates'}{updatedAt && ` · Last received ${updatedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`}</span><button className="btn btn-ghost btn-sm" onClick={() => setRetry(value => value + 1)}><PortalIcon name="refresh" size={15} /> Refresh</button></div>
            {(loadErrors.exams || loadErrors.sessions) && <div className="alert alert-error mb-lg" role="alert">{loadErrors.exams} {loadErrors.sessions} Displayed totals may be incomplete or out of date. Use Refresh to retry.</div>}

            {/* Stats Grid */}
            <div className="grid grid-4 mb-xl dashboard-metrics">
                <Link to="/admin/dashboard/exams" className="stat-card">
                    <div className="stat-icon primary"><ExamIcon /></div>
                    <div className="stat-content">
                        <div className="stat-value">{stats.totalExams}</div>
                        <div className="stat-label">Total Exams</div>
                        <div className="metric-caption">Your assessment library <span>↗</span></div>
                    </div>
                </Link>

                <Link to="/admin/dashboard/exams?status=active" className="stat-card">
                    <div className="stat-icon success"><CheckIcon /></div>
                    <div className="stat-content">
                        <div className="stat-value">{stats.activeExams}</div>
                        <div className="stat-label">Active Exams</div>
                        <div className="metric-caption">Currently open for entry <span>↗</span></div>
                    </div>
                </Link>

                <Link to="/admin/dashboard/monitor" className="stat-card">
                    <div className="stat-icon info"><UsersIcon /></div>
                    <div className="stat-content">
                        <div className="stat-value">{stats.activeSessions}</div>
                        <div className="stat-label">Live Sessions</div>
                        <div className="metric-caption">Students taking an exam <span>↗</span></div>
                    </div>
                </Link>

                <Link to="/admin/dashboard/analytics" className="stat-card">
                    <div className="stat-icon error"><AlertIcon /></div>
                    <div className="stat-content">
                        <div className="stat-value">{stats.cheatingAlerts}</div>
                        <div className="stat-label">Recorded Alerts</div>
                        <div className="metric-caption">Across all exam sessions <span>↗</span></div>
                    </div>
                </Link>
            </div>

            <div className="dashboard-insights mb-xl">
                <section className="card activity-card" aria-labelledby="activity-title">
                    <div className="card-header"><div><h2 id="activity-title" className="card-title">Exam activity</h2><p className="panel-description">Sessions started in the last 7 days</p></div><span className="period-pill">Last 7 days</span></div>
                    <div className="activity-total">{stats.days.reduce((total, day) => total + day.count, 0)} <span>sessions this week</span></div>
                    <div className="activity-chart" role="img" aria-label={stats.days.map(day => `${day.date}: ${day.count} sessions`).join('; ')}>
                        {stats.days.map((day, index) => <div className="activity-column" key={day.date}><span className="activity-count">{day.count}</span><div className="activity-bar-track"><div className={`activity-bar ${index === 6 ? 'today' : ''}`} style={{ height: `${day.count / Math.max(1, ...stats.days.map(item => item.count)) * 100}%` }} /></div><span>{day.label}</span></div>)}
                    </div>
                </section>
                <section className="card" aria-labelledby="outcomes-title">
                    <div className="card-header"><div><h2 id="outcomes-title" className="card-title">Session overview</h2><p className="panel-description">All-time participation</p></div><PortalIcon name="chart" /></div>
                    <div className="completion-summary"><div className="completion-ring" style={{ background: `conic-gradient(#6edbb9 ${stats.completionRate}%, #253444 0)` }} role="img" aria-label={`${stats.completionRate}% of sessions completed`}><div><strong>{stats.completionRate}%</strong><span>completed</span></div></div><div><strong className="session-total">{stats.totalSessions}</strong><p className="panel-description">total sessions</p><Link to="/admin/dashboard/results" className="summary-link">Explore results <PortalIcon name="arrow" size={15} /></Link></div></div>
                    <div className="outcome-legend">{[{ label: 'Completed', count: stats.completedSessions, color: '#6edbb9' }, { label: 'In progress', count: stats.activeSessions, color: '#80b7f7' }, { label: 'Terminated', count: stats.terminatedSessions, color: '#f38f9c' }, { label: 'Cancelled', count: stats.cancelledSessions, color: '#c2a8eb' }].map(item => <div key={item.label}><span><i style={{ background: item.color }} />{item.label}</span><strong>{item.count}</strong></div>)}</div>
                </section>
            </div>

            {/* Quick Actions */}
            <div className="card mb-xl dashboard-shortcuts">
                <div className="card-header">
                    <h3 className="card-title">Quick Actions</h3>
                </div>
                <div className="flex gap-md" style={{ flexWrap: 'wrap' }}>
                    <Link to="/admin/dashboard/exams/create" className="btn btn-primary">
                        <PlusIcon />
                        <span>Create New Exam</span>
                    </Link>
                    <Link to="/admin/dashboard/monitor" className="btn btn-secondary">
                        <EyeIcon />
                        <span>Live Monitoring</span>
                    </Link>
                    <Link to="/admin/dashboard/sessions" className="btn btn-secondary">
                        <UsersIcon />
                        <span>Sessions Manager</span>
                    </Link>
                    <Link to="/admin/dashboard/analytics" className="btn btn-secondary">
                        <ChartIcon />
                        <span>View Analytics</span>
                    </Link>
                    <Link to="/admin/dashboard/blocked" className="btn btn-secondary">
                        <BlockIcon />
                        <span>Blocked Students</span>
                    </Link>
                </div>
            </div>

            {/* Recent Activity */}
            <div className="grid grid-2 dashboard-recent">
                {/* Recent Exams */}
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">Recent Exams</h3>
                        <Link to="/admin/dashboard/exams" className="btn btn-ghost btn-sm">
                            View All
                        </Link>
                    </div>
                    {recentExams.length > 0 ? (
                        <div className="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Exam Name</th>
                                        <th>Status</th>
                                        <th>Duration</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {recentExams.map((exam) => (
                                        <tr key={exam.id}>
                                            <td><Link className="table-primary-link" to={`/admin/dashboard/exams/edit/${exam.id}`}>{exam.examName}</Link><small className="table-detail">{exam.questions?.length || 0} questions</small></td>
                                            <td>
                                                <span className={`badge badge-${exam.status === 'active' ? 'success' :
                                                    exam.status === 'draft' ? 'warning' :
                                                        exam.status === 'completed' ? 'info' : 'error'
                                                    }`}>
                                                    {exam.status}
                                                </span>
                                            </td>
                                            <td>{exam.duration} min</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="empty-state">
                            <ExamIcon />
                            <p className="empty-state-title">No exams yet</p>
                            <p className="empty-state-text">Create your first exam to get started</p>
                            <Link to="/admin/dashboard/exams/create" className="btn btn-primary">
                                Create Exam
                            </Link>
                        </div>
                    )}
                </div>

                {/* Recent Sessions */}
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">Recent Sessions</h3>
                        <Link to="/admin/dashboard/sessions" className="btn btn-ghost btn-sm">
                            View All
                        </Link>
                    </div>
                    {recentSessions.length > 0 ? (
                        <div className="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Student</th>
                                        <th>Roll No</th>
                                        <th>Status</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {recentSessions.map((session) => (
                                        <tr key={session.id}>
                                            <td>{session.studentName}</td>
                                            <td>{session.studentRollNo}</td>
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
                                                    <Link to={`/admin/dashboard/sessions/${session.id}`} className="btn btn-ghost btn-sm">View</Link>
                                                    <button
                                                        className="btn btn-sm btn-danger"
                                                        onClick={() => setDeleteConfirm(session)}
                                                        style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="empty-state">
                            <UsersIcon />
                            <p className="empty-state-title">No sessions yet</p>
                            <p className="empty-state-text">Sessions will appear here when students start exams</p>
                        </div>
                    )}
                </div>
            </div>

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
                                <span>Deleting this session is permanent. The candidate will be permitted to re-register and re-take this examination.</span>
                            </div>
                            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', fontSize: '0.9rem' }}>
                                <strong>Student Name:</strong> {deleteConfirm.studentName}<br />
                                <strong>Roll Number:</strong> {deleteConfirm.studentRollNo}
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

