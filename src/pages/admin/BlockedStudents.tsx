import { useState, useEffect } from 'react';
import { getDocs, updateDoc, query, where } from 'firebase/firestore';
import { collection, doc } from '../../services/tenant';
import { db } from '../../services/firebase';
import { BlockedStudent, Exam } from '../../types';

export default function BlockedStudents() {
    const [blocked, setBlocked] = useState<BlockedStudent[]>([]);
    const [exams, setExams] = useState<Map<string, Exam>>(new Map());
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [blockedSnap, examsSnap] = await Promise.all([
                    getDocs(query(collection(db, 'blocked_students'), where('isUnblocked', '==', false))),
                    getDocs(collection(db, 'exams'))
                ]);

                setBlocked(blockedSnap.docs.map(d => ({ ...d.data(), id: d.id } as unknown as BlockedStudent)));
                const examsMap = new Map<string, Exam>();
                examsSnap.docs.forEach(d => examsMap.set(d.id, { id: d.id, ...d.data() } as Exam));
                setExams(examsMap);
            } catch (err) {
                console.error('Error:', err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    const handleUnblock = async (studentId: string) => {
        try {
            await updateDoc(doc(db, 'blocked_students', studentId), {
                isUnblocked: true,
                unblockedAt: new Date(),
                unblockedBy: 'admin'
            });
            setBlocked(prev => prev.filter(s => s.rollNo + '_' + s.examId !== studentId));
        } catch (err) {
            console.error('Error unblocking:', err);
        }
    };

    if (loading) return <div className="flex items-center justify-center" style={{ minHeight: '50vh' }}><div className="spinner"></div></div>;

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">Blocked Students</h1>
                <p className="page-subtitle">Manage students blocked due to cheating violations</p>
            </div>

            <div className="stat-card mb-xl" style={{ maxWidth: '300px' }}>
                <div className="stat-icon error">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                    </svg>
                </div>
                <div className="stat-content">
                    <div className="stat-value">{blocked.length}</div>
                    <div className="stat-label">Currently Blocked</div>
                </div>
            </div>

            {blocked.length > 0 ? (
                <div className="card">
                    <div className="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Roll Number</th>
                                    <th>Exam</th>
                                    <th>Reason</th>
                                    <th>Blocked At</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {blocked.map((student) => (
                                    <tr key={student.rollNo + '_' + student.examId}>
                                        <td style={{ fontWeight: 500 }}>{student.rollNo}</td>
                                        <td>{exams.get(student.examId)?.examName || student.examId}</td>
                                        <td>{student.reason}</td>
                                        <td style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                                            {student.blockedAt instanceof Date
                                                ? student.blockedAt.toLocaleString()
                                                : (student.blockedAt as any)?.toDate?.()?.toLocaleString() || 'N/A'}
                                        </td>
                                        <td>
                                            <button
                                                className="btn btn-success btn-sm"
                                                onClick={() => handleUnblock(student.rollNo + '_' + student.examId)}
                                            >
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <polyline points="20 6 9 17 4 12" />
                                                </svg>
                                                Unblock
                                            </button>
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
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="1.5" style={{ marginBottom: 'var(--space-lg)' }}>
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                            <polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                        <p className="empty-state-title">No blocked students</p>
                        <p className="empty-state-text">All students are allowed to take exams</p>
                    </div>
                </div>
            )}
        </div>
    );
}
