import { api } from '../../services/platform';
import { getSessionDoc } from '../../services/staffData';
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getDoc } from 'firebase/firestore';
import { doc } from '../../services/tenant';
import { db } from '../../services/firebase';
import { ExamSession, Exam, Answer } from '../../types';
import { formatDeviceName } from '../../utils/deviceUtils';

import { useAuth } from '../../context/AuthContext';

export default function SessionDetails() {
    const { adminData } = useAuth();
    const { sessionId } = useParams<{ sessionId: string }>();
    const navigate = useNavigate();

    const [session, setSession] = useState<ExamSession | null>(null);
    const [exam, setExam] = useState<Exam | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [scores, setScores] = useState<{ [questionId: string]: number }>({});

    useEffect(() => {
        const fetchData = async () => {
            if (!sessionId) return;

            try {
                const sessionDoc = await getSessionDoc(sessionId);
                if (sessionDoc.exists()) {
                    const sessionData = { id: sessionDoc.id, ...sessionDoc.data() } as ExamSession;
                    setSession(sessionData);

                    // Initialize scores from existing answers
                    const initialScores: { [key: string]: number } = {};
                    sessionData.answers?.forEach(ans => {
                        if (ans.score !== undefined) {
                            initialScores[ans.questionId] = ans.score;
                        }
                    });
                    setScores(initialScores);

                    const examDoc = await getDoc(doc(db, 'exams', sessionData.examId));
                    if (examDoc.exists()) {
                        const examData = { id: examDoc.id, ...examDoc.data() } as Exam;

                        // Check access for faculty
                        if (adminData?.role === 'faculty' && !examData.assignedFaculty?.includes(adminData.id)) {
                            alert('You do not have permission to view this session.');
                            navigate('/admin/dashboard');
                            return;
                        }

                        setExam(examData);
                    }
                }
            } catch (err) {
                console.error('Error fetching session details:', err);
            } finally {
                setLoading(false);
            }
        };

        if (adminData) {
            fetchData();
        }
    }, [sessionId, adminData]);

    const handleScoreChange = (questionId: string, score: number) => {
        setScores(prev => ({ ...prev, [questionId]: score }));
    };

    const calculateTotalScore = () => {
        if (!exam) return 0;
        return exam.questions.reduce((total, q) => {
            // Use manual score if available
            if (scores[q.id] !== undefined) {
                return total + scores[q.id];
            }
            // Fallback to auto-grading logic (optional, but good for consistency)
            const answer = session?.answers.find(a => a.questionId === q.id);
            if (answer && answer.answer === q.correctAnswer) {
                return total + q.points;
            }
            return total;
        }, 0);
    };

    const handleSave = async () => {
        if (!session || !exam) return;
        setSaving(true);

        try {
            // Recalculate total score by iterating over all questions

            // Recalculate total score
            // Note: We need to decide if we strictly use the 'scores' state or mix with auto-grading.
            // For manual grading page, let's assume we save what's in 'scores' or default to 0/points if strictly auto-graded?
            // Actually, best to iterate over questions to ensure we catch everything.

            const finalAnswers: Answer[] = [];
            let totalScore = 0;

            console.log('Scores state:', scores);

            exam.questions.forEach(q => {
                const existingAnswer = session.answers.find(a => a.questionId === q.id);
                const manualScore = scores[q.id];

                let finalScore = 0;
                if (manualScore !== undefined) {
                    finalScore = manualScore;
                } else if (existingAnswer && existingAnswer.answer === q.correctAnswer) {
                    // If no manual score set yet, preserve auto score logic?
                    // Or should we populate initialScores with ALL auto-scores?
                    // Let's rely on what we initialized.
                    // But wait, initialScores only had `ans.score` if it existed.
                    // If it was undefined, it means it wasn't manually graded or persistenly scored yet (ExamInterface only saves total score, not per-answer score).
                    // So we should calculate it now.
                    finalScore = q.points;
                }

                // If the user didn't answer, existingAnswer is undefined.

                totalScore += finalScore;

                if (existingAnswer) {
                    finalAnswers.push({
                        ...existingAnswer,
                        score: finalScore
                    });
                }
            });

            await api('saveGrades', { sessionId: session.id, scores: Object.fromEntries(finalAnswers.map(answer => [answer.questionId, answer.score])) });

            // Update local state
            setSession(prev => prev ? { ...prev, answers: finalAnswers, score: totalScore } : null);
            alert('Scores updated successfully');

        } catch (err) {
            console.error('Error saving scores:', err);
            alert('Failed to save scores');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="spinner"></div>
            </div>
        );
    }

    if (!session || !exam) {
        return <div className="p-xl text-center">Session not found</div>;
    }

    return (
        <div>
            <div className="page-header flex justify-between items-center">
                <div>
                    <h1 className="page-title">Session Details</h1>
                    <p className="page-subtitle">
                        {session.studentName} ({session.studentRollNo}) - {exam.examName}
                    </p>
                </div>
                <div className="flex gap-md items-center">
                    <div className="text-right">
                        <div className="text-sm text-secondary">Total Score</div>
                        <div className="text-xl font-bold text-primary">
                            {calculateTotalScore()} / {exam.questions.reduce((a, b) => a + b.points, 0)}
                        </div>
                    </div>
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                        {saving ? <span className="spinner spinner-sm"></span> : '💾'}
                        <span>Save Grading</span>
                    </button>
                    <button className="btn btn-ghost" onClick={() => navigate('/admin/dashboard/sessions')}>
                        Back
                    </button>
                </div>
            </div>

            <div className="card mb-lg">
                <h3 style={{ fontSize: '1.05rem', marginBottom: 'var(--space-md)' }}>Device & Geolocation Metrics</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--space-md)' }}>
                    <div style={{ fontSize: '0.875rem' }}>
                        <div style={{ marginBottom: '4px' }}><strong>Device:</strong> {formatDeviceName(session.deviceInfo)}</div>
                        <div><strong>Platform & Resolution:</strong> {session.deviceInfo?.platform || 'Unknown'} ({session.deviceInfo?.screenWidth}x{session.deviceInfo?.screenHeight})</div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-md)', paddingTop: 'var(--space-sm)', borderTop: '1px solid var(--border-color)' }}>
                        <div>
                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Start Location</span>
                            {session.startLocation ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                                    <span style={{ fontSize: '0.85rem' }}>
                                        Lat: {session.startLocation.latitude.toFixed(6)}, Lng: {session.startLocation.longitude.toFixed(6)}
                                    </span>
                                    <a 
                                        href={`https://www.google.com/maps?q=${session.startLocation.latitude},${session.startLocation.longitude}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="btn btn-secondary btn-sm"
                                        style={{ textDecoration: 'none' }}
                                    >
                                        📍 See Location
                                    </a>
                                </div>
                            ) : (
                                <span className="text-muted italic" style={{ fontSize: '0.85rem' }}>Not captured</span>
                            )}
                        </div>
                        <div>
                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Submission Location</span>
                            {session.endLocation ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                                    <span style={{ fontSize: '0.85rem' }}>
                                        Lat: {session.endLocation.latitude.toFixed(6)}, Lng: {session.endLocation.longitude.toFixed(6)}
                                    </span>
                                    <a 
                                        href={`https://www.google.com/maps?q=${session.endLocation.latitude},${session.endLocation.longitude}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="btn btn-secondary btn-sm"
                                        style={{ textDecoration: 'none' }}
                                    >
                                        📍 See Location
                                    </a>
                                </div>
                            ) : (
                                <span className="text-muted italic" style={{ fontSize: '0.85rem' }}>Not captured</span>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className="card">
                {exam.questions.map((q, index) => {
                    const answer = session.answers.find(a => a.questionId === q.id);
                    const isCorrect = answer?.answer === q.correctAnswer;
                    const manualScore = scores[q.id];
                    // If manual score is undefined, show auto score (if correct) or 0
                    const currentScore = manualScore !== undefined ? manualScore : (isCorrect ? q.points : 0);

                    return (
                        <div key={q.id} className="mb-xl pb-lg border-b border-gray-element last:border-0 last:mb-0 last:pb-0">
                            <div className="flex justify-between items-start mb-md">
                                <div className="flex gap-md">
                                    <span className="badge badge-secondary">Q{index + 1}</span>
                                    <span className="badge badge-info">{q.type}</span>
                                    <span className="badge badge-warning">{q.points} pts</span>
                                </div>
                                <div className="flex items-center gap-sm">
                                    <label className="text-sm font-medium">Score:</label>
                                    <input
                                        type="number"
                                        className="input"
                                        style={{ width: '80px', padding: '4px 8px' }}
                                        value={currentScore}
                                        onChange={(e) => handleScoreChange(q.id, Number(e.target.value))}
                                        min={0}
                                        max={q.points}
                                    />
                                </div>
                            </div>

                            <p className="text-lg mb-md font-medium">{q.text}</p>

                            <div className="grid grid-2 gap-lg">
                                <div className={`p-md rounded border ${isCorrect ? 'border-success bg-success-light' : 'border-error bg-error-light'}`} style={{ background: isCorrect ? 'rgba(var(--success-rgb), 0.1)' : 'rgba(var(--error-rgb), 0.1)' }}>
                                    <div className="text-xs text-uppercase tracking-wider opacity-70 mb-xs">Student Answer</div>
                                    <div className="font-medium">
                                        {answer ? String(answer.answer) : <span className="text-muted italic">Not Answered</span>}
                                    </div>
                                    {q.type === 'mcq' && answer && (
                                        <div className="text-sm mt-xs text-secondary">
                                            ({q.options[Number(answer.answer)]})
                                        </div>
                                    )}
                                </div>

                                <div className="p-md rounded border border-info bg-info-light" style={{ background: 'rgba(var(--info-rgb), 0.1)' }}>
                                    <div className="text-xs text-uppercase tracking-wider opacity-70 mb-xs">Correct Answer</div>
                                    <div className="font-medium">
                                        {String(q.correctAnswer)}
                                    </div>
                                    {q.type === 'mcq' && (
                                        <div className="text-sm mt-xs text-secondary">
                                            ({q.options[Number(q.correctAnswer)]})
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
