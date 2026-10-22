import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { query, where, getDocs } from 'firebase/firestore';
import { collection } from '../../services/tenant';
import { db } from '../../services/firebase';
import { useAuth } from '../../context/AuthContext';
import { Exam, ExamSession } from '../../types';

export default function FacultyDashboard() {
    const { adminData } = useAuth();
    const [assignedExams, setAssignedExams] = useState<Exam[]>([]);
    const [activeSessions, setActiveSessions] = useState<ExamSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);

    useEffect(() => {
        const fetchFacultyData = async () => {
            if (!adminData?.id) return;

            try {
                setLoading(true);
                setError('');
                // 1. Fetch all exams where faculty is assigned
                // Note: Firestore array-contains-any or client-side filtering might be needed depending on index
                // Since exams collection might be small, client-side filtering is safer without custom index
                const examsSnapshot = await getDocs(collection(db, 'exams'));
                const allExams = examsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Exam[];

                const myExams = allExams.filter(exam =>
                    exam.assignedFaculty?.includes(adminData.id)
                );
                setAssignedExams(myExams);

                // 2. Fetch active sessions for these exams
                if (myExams.length > 0) {
                    const myExamIds = myExams.map(e => e.id);
                    const sessionsSnapshot = await getDocs(
                        query(collection(db, 'exam_sessions'), where('status', '==', 'started'))
                    );

                    const sessions = sessionsSnapshot.docs
                        .map(doc => ({ id: doc.id, ...doc.data() })) as ExamSession[];

                    const mySessions = sessions.filter(session =>
                        myExamIds.includes(session.examId)
                    );
                    setActiveSessions(mySessions);
                } else {
                    setActiveSessions([]);
                }

            } catch (error) {
                console.error("Error fetching faculty data:", error);
                setError('Unable to load your assigned exams. Please try again.');
            } finally {
                setLoading(false);
            }
        };

        fetchFacultyData();
    }, [adminData, retry]);

    if (loading) {
        return (
            <div className="flex justify-center items-center h-64">
                <div className="spinner"></div>
            </div>
        );
    }

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1 className="page-title">Faculty Dashboard</h1>
                    <p className="page-subtitle">Welcome back, {adminData?.name}</p>
                </div>
            </div>

            {error && <div className="alert alert-error mb-lg" role="alert">{error}<button className="btn btn-secondary btn-sm" onClick={() => setRetry(value => value + 1)}>Try again</button></div>}

            {/* Quick Stats */}
            <div className="grid grid-3 mb-xl faculty-metrics">
                <div className="stat-card">
                    <div className="stat-value">{assignedExams.length}</div>
                    <div className="stat-label">Assigned Exams</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value">{activeSessions.length}</div>
                    <div className="stat-label">Active Sessions Now</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value">{assignedExams.filter(e => e.status === 'active').length}</div>
                    <div className="stat-label">Active Exams</div>
                </div>
            </div>

            {/* Assigned Exams List */}
            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">📚 My Assigned Exams</h3>
                </div>
                {assignedExams.length > 0 ? (
                    <div className="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Exam Name</th>
                                    <th>Duration</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {assignedExams.map(exam => (
                                    <tr key={exam.id}>
                                        <td>
                                            <div style={{ fontWeight: 500 }}>{exam.examName}</div>
                                            <div className="text-muted text-sm">{exam.questions?.length || 0} Questions</div>
                                        </td>
                                        <td>{exam.duration} mins</td>
                                        <td>
                                            <span className={`badge badge-${exam.status === 'active' ? 'success' : 'secondary'}`}>
                                                {exam.status.toUpperCase()}
                                            </span>
                                        </td>
                                        <td>
                                            <div className="flex gap-sm">
                                                <Link to={`/admin/dashboard/exams/edit/${exam.id}`} className="btn btn-sm btn-secondary">
                                                    View Details
                                                </Link>
                                                <Link to="/admin/dashboard/monitor" className="btn btn-sm btn-primary">
                                                    Monitor
                                                </Link>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="p-xl text-center text-muted">
                        <p>No exams have been assigned to you yet.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
