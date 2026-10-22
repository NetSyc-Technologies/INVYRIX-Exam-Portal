import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getDocs, deleteDoc, updateDoc } from 'firebase/firestore';
import { collection, doc } from '../../services/tenant';
import { db } from '../../services/firebase';
import { Exam } from '../../types';
import { exportExamResultsToCSV } from '../../utils/csvExport';

import { useAuth } from '../../context/AuthContext';
import PortalIcon from '../../components/PortalIcon';

export default function ExamManager() {
    const { adminData } = useAuth();
    const [exams, setExams] = useState<Exam[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchParams, setSearchParams] = useSearchParams();
    const statusParam = searchParams.get('status') || 'all';
    const filter = ['all', 'active', 'draft', 'completed', 'cancelled'].includes(statusParam) ? statusParam : 'all';
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState('newest');
    const [error, setError] = useState('');
    const [busyId, setBusyId] = useState<string | null>(null);
    const [deleteModal, setDeleteModal] = useState<{ show: boolean; examId: string; examName: string }>({
        show: false,
        examId: '',
        examName: ''
    });

    useEffect(() => {
        if (adminData) {
            fetchExams();
        }
    }, [adminData]);

    const fetchExams = async () => {
        setLoading(true);
        setError('');
        try {
            const snapshot = await getDocs(collection(db, 'exams'));
            let examData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate?.() || new Date(),
                startTime: doc.data().startTime?.toDate?.() || new Date(),
                endTime: doc.data().endTime?.toDate?.() || new Date()
            })) as Exam[];

            // Filter for faculty
            if (adminData?.role === 'faculty') {
                examData = examData.filter(exam => exam.assignedFaculty?.includes(adminData.id));
            }

            setExams(examData.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
        } catch (error) {
            console.error('Error fetching exams:', error);
            setError('Unable to load exams. Check your connection and try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleStatusChange = async (examId: string, newStatus: Exam['status']) => {
        setBusyId(examId);
        setError('');
        try {
            await updateDoc(doc(db, 'exams', examId), { status: newStatus });
            setExams(prev => prev.map(exam =>
                exam.id === examId ? { ...exam, status: newStatus } : exam
            ));
        } catch (error) {
            console.error('Error updating exam status:', error);
            setError('The exam status could not be saved. Please try again.');
        } finally {
            setBusyId(null);
        }
    };

    const handleDelete = async () => {
        setBusyId(deleteModal.examId);
        setError('');
        try {
            await deleteDoc(doc(db, 'exams', deleteModal.examId));
            setExams(prev => prev.filter(exam => exam.id !== deleteModal.examId));
            setDeleteModal({ show: false, examId: '', examName: '' });
        } catch (error) {
            console.error('Error deleting exam:', error);
            setError('The exam could not be deleted. Please try again.');
        } finally {
            setBusyId(null);
        }
    };

    const filteredExams = exams.filter(exam =>
        (filter === 'all' || exam.status === filter) && exam.examName.toLowerCase().includes(search.trim().toLowerCase())
    ).sort((a, b) => sort === 'name' ? a.examName.localeCompare(b.examName) : sort === 'duration' ? a.duration - b.duration : b.createdAt.getTime() - a.createdAt.getTime());

    if (loading) {
        return (
            <div className="flex items-center justify-center" style={{ minHeight: '50vh' }}>
                <div className="spinner"></div>
            </div>
        );
    }

    return (
        <div>
            <div className="page-header flex justify-between items-center">
                <div>
                    <h1 className="page-title">Exam Manager</h1>
                    <p className="page-subtitle">Create, manage, and monitor your exams</p>
                </div>
                {adminData?.role !== 'faculty' && (
                    <Link to="/admin/dashboard/exams/create" className="btn btn-primary">
                        <span>➕</span>
                        <span>Create New Exam</span>
                    </Link>
                )}
            </div>

            {/* Filters */}
            {error && <div role="alert" className="alert alert-error mb-lg">{error}<button type="button" className="btn btn-ghost btn-sm" onClick={fetchExams}>Reload exams</button></div>}
            <div className="card mb-lg">
                <div className="exam-search-toolbar"><div className="exam-search-field"><PortalIcon name="search" /><input className="input" type="search" aria-label="Search exams by name" placeholder="Search exams by name…" value={search} onChange={event => setSearch(event.target.value)} /></div><select className="input exam-sort" aria-label="Sort exams" value={sort} onChange={event => setSort(event.target.value)}><option value="newest">Newest first</option><option value="name">Name A–Z</option><option value="duration">Shortest duration</option></select></div>
                <div className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
                    {(['all', 'active', 'draft', 'completed', 'cancelled'] as const).map((status) => (
                        <button
                            key={status}
                            className={`btn ${filter === status ? 'btn-primary' : 'btn-ghost'}`}
                            aria-pressed={filter === status}
                            onClick={() => setSearchParams(previous => { const next = new URLSearchParams(previous); if (status === 'all') next.delete('status'); else next.set('status', status); return next; })}
                        >
                            {status.charAt(0).toUpperCase() + status.slice(1)}
                            {status !== 'all' && (
                                <span className="badge badge-primary" style={{ marginLeft: '0.5rem' }}>
                                    {exams.filter(e => e.status === status).length}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
                <p className="exam-result-count" role="status">Showing {filteredExams.length} of {exams.length} exams</p>
            </div>

            {/* Exams List */}
            {filteredExams.length > 0 ? (
                <div className="card">
                    <div className="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Exam Name</th>
                                    <th>Password</th>
                                    <th>Duration</th>
                                    <th>Questions</th>
                                    <th>Status</th>
                                    <th>Created</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredExams.map((exam) => (
                                    <tr key={exam.id}>
                                        <td>
                                            <div style={{ fontWeight: 500 }}>{exam.examName}</div>
                                        </td>
                                        <td>
                                            <code style={{
                                                background: 'var(--bg-surface)',
                                                padding: '2px 8px',
                                                borderRadius: 'var(--radius-sm)',
                                                fontSize: '0.813rem'
                                            }}>
                                                {exam.examPassword}
                                            </code>
                                        </td>
                                        <td>{exam.duration} min</td>
                                        <td>{exam.questions?.length || 0}</td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                                                <label className="switch" style={{ margin: 0, scale: '0.8' }} title={exam.status === 'active' ? "Disable Exam" : "Enable Exam"}>
                                                    <input
                                                        type="checkbox"
                                                        checked={exam.status === 'active'}
                                                        disabled={adminData?.role === 'faculty' || busyId === exam.id}
                                                        aria-label={`Activate ${exam.examName}`}
                                                        onChange={(e) => {
                                                            const newStatus = e.target.checked ? 'active' : 'draft';
                                                            handleStatusChange(exam.id, newStatus);
                                                        }}
                                                    />
                                                    <span className="slider"></span>
                                                </label>
                                                <span className={`badge badge-${
                                                    exam.status === 'active' ? 'success' :
                                                    exam.status === 'draft' ? 'warning' :
                                                    exam.status === 'completed' ? 'info' : 'error'
                                                }`} style={{ minWidth: '75px', textAlign: 'center' }}>
                                                    {exam.status === 'active' ? 'Live' : exam.status}
                                                </span>
                                            </div>
                                        </td>
                                        <td style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                                            {exam.createdAt.toLocaleDateString()}
                                        </td>
                                        <td>
                                            <div className="flex gap-sm">
                                                <Link
                                                    to={`/admin/dashboard/exams/edit/${exam.id}`}
                                                    className="btn btn-ghost btn-sm"
                                                    title={adminData?.role === 'faculty' ? "View Details" : "Edit Exam"}
                                                >
                                                    {adminData?.role === 'faculty' ? '👁️' : '✏️'}
                                                </Link>

                                                {/* Export CSV Button - Available to both Admin and Faculty */}
                                                <button
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => exportExamResultsToCSV(exam)}
                                                    title="Download Results CSV"
                                                >
                                                    📉
                                                </button>

                                                {adminData?.role !== 'faculty' && (
                                                    <>
                                                        {exam.status === 'draft' && (
                                                            <button
                                                                className="btn btn-success btn-sm"
                                                                onClick={() => handleStatusChange(exam.id, 'active')}
                                                                title="Activate Exam"
                                                            >
                                                                ▶️
                                                            </button>
                                                        )}
                                                        {exam.status === 'active' && (
                                                            <button
                                                                className="btn btn-warning btn-sm"
                                                                onClick={() => handleStatusChange(exam.id, 'completed')}
                                                                title="Complete Exam"
                                                            >
                                                                ⏹️
                                                            </button>
                                                        )}
                                                        {exam.status === 'completed' && (
                                                            <button
                                                                className="btn btn-info btn-sm"
                                                                onClick={() => handleStatusChange(exam.id, 'active')}
                                                                title="Reactivate Exam"
                                                            >
                                                                🔁
                                                            </button>
                                                        )}
                                                        <button
                                                            className="btn btn-danger btn-sm"
                                                            onClick={() => setDeleteModal({
                                                                show: true,
                                                                examId: exam.id,
                                                                examName: exam.examName
                                                            })}
                                                            title="Delete Exam"
                                                        >
                                                            🗑️
                                                        </button>
                                                    </>
                                                )}
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
                        <div className="empty-state-icon">📝</div>
                        <p className="empty-state-title">No exams found</p>
                        <p className="empty-state-text">
                            {search ? `No exams match “${search}”. Try another name or reset the filters.` : filter === 'all'
                                ? (adminData?.role === 'faculty' ? 'You have no assigned exams' : 'Create your first exam to get started')
                                : `No ${filter} exams found`}
                        </p>
                        {(search || filter !== 'all') && <button className="btn btn-secondary" onClick={() => { setSearch(''); setSearchParams({}); }}>Clear filters</button>}
                        {adminData?.role !== 'faculty' && (
                            <Link to="/admin/dashboard/exams/create" className="btn btn-primary">
                                Create Exam
                            </Link>
                        )}
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteModal.show && (
                <div className="modal-overlay" onClick={() => setDeleteModal({ show: false, examId: '', examName: '' })}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Delete Exam</h3>
                            <button
                                className="modal-close"
                                onClick={() => setDeleteModal({ show: false, examId: '', examName: '' })}
                            >
                                ✕
                            </button>
                        </div>
                        <div className="modal-body">
                            {error && <div className="alert alert-error mb-lg" role="alert">{error}</div>}
                            <p>Are you sure you want to delete <strong>"{deleteModal.examName}"</strong>?</p>
                            <p className="text-error" style={{ marginTop: 'var(--space-sm)' }}>
                                This action cannot be undone. All associated data will be permanently deleted.
                            </p>
                        </div>
                        <div className="modal-footer">
                            <button
                                className="btn btn-ghost"
                                onClick={() => setDeleteModal({ show: false, examId: '', examName: '' })}
                            >
                                Cancel
                            </button>
                            <button className="btn btn-danger" onClick={handleDelete} disabled={busyId === deleteModal.examId}>
                                {busyId === deleteModal.examId ? 'Deleting…' : 'Delete Exam'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
