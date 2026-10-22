import { api, studentExam } from '../../services/platform';
import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getDoc } from 'firebase/firestore';
import { doc } from '../../services/tenant';
import { db } from '../../services/firebase';
import { ExamSession, Exam } from '../../types';
import Footer from '../../components/Footer';

export default function ExamResults() {
    const { sessionId } = useParams<{ sessionId: string }>();
    const [session, setSession] = useState<ExamSession | null>(null);
    const [exam, setExam] = useState<Exam | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            if (!sessionId) return;
            try {
                const sessionDoc = await getDoc(doc(db, 'exam_sessions', sessionId));
                if (sessionDoc.exists()) {
                    const sessionData = { id: sessionDoc.id, ...sessionDoc.data() } as ExamSession;
                    setSession({ ...sessionData, ...await api('getStudentResult', { sessionId }) });
                    const examDoc = await studentExam(sessionId!);
                    if (examDoc.exists()) setExam({ ...examDoc.data(), id: examDoc.id } as Exam);
                }
            } catch (err) {
                console.error('Error:', err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [sessionId]);

    if (loading) return <div className="page flex items-center justify-center" style={{ minHeight: '100vh' }}><div className="spinner"></div></div>;

    if (!session || !exam) return (
        <div className="page flex items-center justify-center" style={{ minHeight: '100vh' }}>
            <div className="card text-center" style={{ padding: 'var(--space-2xl)' }}>
                <p>Results not found</p>
                <Link to="/" className="btn btn-primary mt-lg">Go Home</Link>
            </div>
        </div>
    );

    if (!exam.settings?.showResults) return <div className="platform-gate"><h1>Exam submitted</h1><p>Your answers have been recorded. Your institute will share results when they are available.</p><Link to="/" className="btn btn-primary">Back to institute</Link></div>;
    const totalPoints = exam.questions?.reduce((a, q) => a + q.points, 0) || 0;
    const percentage = totalPoints > 0 ? Math.round((session.score || 0) / totalPoints * 100) : 0;
    const isPassed = percentage >= 40;

    return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
            <div className="page flex items-center justify-center" style={{ flex: 1 }}>
                <div className="container" style={{ maxWidth: '500px' }}>
                    <div className="card text-center" style={{ padding: 'var(--space-2xl)' }}>
                        <div style={{
                            width: 80, height: 80, margin: '0 auto var(--space-lg)',
                            background: isPassed ? 'rgba(34, 197, 94, 0.2)' : 'rgba(234, 179, 8, 0.2)',
                            borderRadius: 'var(--radius-full)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                            {isPassed ? (
                                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
                                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                                    <polyline points="22 4 12 14.01 9 11.01" />
                                </svg>
                            ) : (
                                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2">
                                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                                </svg>
                            )}
                        </div>
                        <h1 style={{ fontSize: '1.5rem', marginBottom: 'var(--space-xs)' }}>Exam Completed</h1>
                        <p className="text-secondary" style={{ marginBottom: 'var(--space-xl)' }}>{exam.examName}</p>

                        <div className="stat-card mb-xl" style={{ justifyContent: 'center' }}>
                            <div className="stat-content text-center">
                                <div className="stat-value" style={{
                                    fontSize: '3rem',
                                    color: isPassed ? 'var(--success)' : percentage >= 30 ? 'var(--warning)' : 'var(--error)'
                                }}>
                                    {percentage}%
                                </div>
                                <div className="stat-label">Your Score: {session.score || 0}/{totalPoints}</div>
                            </div>
                        </div>

                        <div className="grid grid-2 gap-md mb-xl">
                            <div className="card" style={{ background: 'var(--bg-surface)', padding: 'var(--space-md)' }}>
                                <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-xs)' }}>Questions</p>
                                <p style={{ fontWeight: 600, margin: 0 }}>{exam.questions?.length || 0}</p>
                            </div>
                            <div className="card" style={{ background: 'var(--bg-surface)', padding: 'var(--space-md)' }}>
                                <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-xs)' }}>Answered</p>
                                <p style={{ fontWeight: 600, margin: 0 }}>{session.answers?.length || 0}</p>
                            </div>
                        </div>

                        <Link to="/" className="btn btn-primary btn-lg" style={{ width: '100%' }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                                <polyline points="9 22 9 12 15 12 15 22" />
                            </svg>
                            <span>Return to Home</span>
                        </Link>
                    </div>
                </div>
            </div>
            <Footer />
        </div>
    );
}
