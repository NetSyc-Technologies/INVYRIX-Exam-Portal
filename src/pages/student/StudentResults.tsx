import { useInstitute } from '../../context/InstituteContext';
import { api, studentExam } from '../../services/platform';
import { useState, FormEvent } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getDocs, query, where } from 'firebase/firestore';
import { collection } from '../../services/tenant';
import QRCode from 'qrcode';
import { auth, db } from '../../services/firebase';
import { ExamSession, Exam } from '../../types';
import Footer from '../../components/Footer';
import Logo from '../../components/Logo';

interface ResultItem {
    session: ExamSession;
    exam: Exam;
}

export default function StudentResults() {
    const { institute } = useInstitute();
    const [rollNo, setRollNo] = useState('');
    const [results, setResults] = useState<ResultItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [searched, setSearched] = useState(false);
    const [error, setError] = useState('');

    const handleSearch = async (e: FormEvent) => {
        e.preventDefault();
        if (!rollNo.trim()) return;

        setLoading(true);
        setError('');
        setResults([]);
        setSearched(true);

        try {
            // Get all sessions for this roll number
            const sessionsSnap = await getDocs(query(
                collection(db, 'exam_sessions'),
                where('ownerUid', '==', auth.currentUser?.uid || ''),
                where('studentRollNo', '==', rollNo.trim().toUpperCase()),
                where('status', 'in', ['completed', 'terminated'])
            ));

            if (sessionsSnap.empty) {
                setLoading(false);
                return;
            }

            const resultItems: ResultItem[] = [];

            for (const sessionDoc of sessionsSnap.docs) {
                const session = { id: sessionDoc.id, ...sessionDoc.data() } as ExamSession;
                const examDoc = await studentExam(session.id);

                if (examDoc.exists()) {
                    const exam = { ...examDoc.data(), id: examDoc.id } as Exam;
                    if (exam.settings?.showResults) resultItems.push({ session: { ...session, ...await api('getStudentResult', { sessionId: session.id }) }, exam });
                }
            }

            // Sort by date (most recent first)
            resultItems.sort((a, b) => {
                const dateA = a.session.endTime?.getTime?.() ||
                    (a.session.endTime as any)?.toDate?.()?.getTime() || 0;
                const dateB = b.session.endTime?.getTime?.() ||
                    (b.session.endTime as any)?.toDate?.()?.getTime() || 0;
                return dateB - dateA;
            });

            setResults(resultItems);
        } catch (err) {
            console.error('Error searching results:', err);
            setError('Failed to fetch results. Please try again.');
        } finally {
            setLoading(false);
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

    const calculatePercentage = (score: number, totalPoints: number) => {
        if (totalPoints === 0) return 0;
        return Math.round((score / totalPoints) * 100);
    };

    const downloadPDF = async (session: ExamSession, exam: Exam) => {
        const doc = new jsPDF({
            encryption: {
                userPassword: '',
                ownerPassword: 'INVYRIX-NetSyc',
                userPermissions: ['print', 'copy']
            }
        } as any);

        const qrScore = session.score || 0;
        const qrTotal = exam.questions?.reduce((a, q) => a + q.points, 0) || 0;
        const qrPercent = calculatePercentage(qrScore, qrTotal);
        const qrStatus = session.status === 'terminated' ? 'TERMINATED' : qrPercent >= 40 ? 'PASSED' : 'FAILED';
        const qrText = `INVYRIX Exam Verification — ${institute?.name || "Institute"}\nRoll No: ${session.studentRollNo}\nName: ${session.studentName || 'N/A'}\nExam: ${exam.examName}\nScore: ${qrScore} / ${qrTotal} (${qrPercent}%)\nStatus: ${qrStatus}\nVerification ID: ${session.id}`;

        let qrCodeDataUrl = '';
        try {
            qrCodeDataUrl = await QRCode.toDataURL(qrText, {
                margin: 1,
                width: 100,
                errorCorrectionLevel: 'M'
            });
        } catch (err) {
            console.error('Error generating QR code:', err);
        }

        // Color Palette
        const colors = {
            navy: [15, 23, 42],      // Slate 900
            blue: [29, 78, 216],     // Blue 700
            lightBlue: [239, 246, 255], // Blue 50
            border: [226, 232, 240], // Slate 200
            textPrimary: [30, 41, 59], // Slate 800
            textMuted: [100, 116, 139], // Slate 500
            success: [22, 163, 74],   // Green 600
            successBg: [240, 253, 244],
            error: [220, 38, 38],    // Red 600
            errorBg: [254, 242, 242],
            warning: [217, 119, 6],   // Orange 600
            warningBg: [255, 247, 237]
        };

        // Header Banner
        doc.setFillColor(colors.navy[0], colors.navy[1], colors.navy[2]);
        doc.rect(15, 15, 180, 26, 'F');

        // Header Text
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.text('INVYRIX by NetSyc Technologies', 105, 22, { align: 'center' });
        
        doc.setFontSize(11.5);
        while (doc.getTextWidth(institute?.name || 'INVYRIX') > 170 && doc.getFontSize() > 6) doc.setFontSize(doc.getFontSize() - 0.5);
        doc.text(institute?.name || 'INVYRIX', 105, 29, { align: 'center' });
        
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(190, 200, 215);
        doc.text('OFFICIAL ACADEMIC EVALUATION REPORT - EXAM PORTAL', 105, 35, { align: 'center' });

        // Information Cards Layout
        const cardY = 48;
        const cardH = 38;
        const cardW = 87;

        // Student Info Card (Left)
        doc.setFillColor(250, 250, 250);
        doc.setDrawColor(colors.border[0], colors.border[1], colors.border[2]);
        doc.roundedRect(15, cardY, cardW, cardH, 3, 3, 'FD');
        
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(colors.blue[0], colors.blue[1], colors.blue[2]);
        doc.text('CANDIDATE INFORMATION', 20, cardY + 6);
        
        doc.setFontSize(9.5);
        doc.setTextColor(colors.textPrimary[0], colors.textPrimary[1], colors.textPrimary[2]);
        doc.text(`Roll Number:  ${session.studentRollNo}`, 20, cardY + 15);
        doc.text(`Name:          ${session.studentName || 'N/A'}`, 20, cardY + 22);
        
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(colors.textMuted[0], colors.textMuted[1], colors.textMuted[2]);
        doc.text(`Email: ${session.studentEmail || 'N/A'}`, 20, cardY + 29);
        doc.text(`Phone: ${session.studentPhone || 'N/A'}`, 20, cardY + 34);

        // Exam Info Card (Right)
        doc.setFillColor(250, 250, 250);
        doc.roundedRect(108, cardY, cardW, cardH, 3, 3, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(colors.blue[0], colors.blue[1], colors.blue[2]);
        doc.text('EXAMINATION OVERVIEW', 113, cardY + 6);

        doc.setFontSize(9.5);
        doc.setTextColor(colors.textPrimary[0], colors.textPrimary[1], colors.textPrimary[2]);
        
        let displayName = exam.examName || 'N/A';
        if (displayName.length > 28) displayName = displayName.substring(0, 26) + '...';
        doc.text(`Exam Name:   ${displayName}`, 113, cardY + 15);
        doc.text(`Date:             ${formatDate(session.endTime)}`, 113, cardY + 22);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(colors.textMuted[0], colors.textMuted[1], colors.textMuted[2]);
        doc.text(`Duration: ${exam.duration} Minutes`, 113, cardY + 29);
        doc.text(`Session ID: ${session.id}`, 113, cardY + 34);

        // Score & Status Block
        const totalPoints = exam.questions?.reduce((a, q) => a + q.points, 0) || 0;
        const score = session.score || 0;
        const percentage = calculatePercentage(score, totalPoints);
        
        const isTerminated = session.status === 'terminated';
        const isPassed = percentage >= 40 && !isTerminated;
        
        let statusText = 'FAILED';
        let statusColors = colors.error;
        let statusBg = colors.errorBg;
        
        if (isTerminated) {
            statusText = 'TERMINATED';
            statusColors = colors.error;
            statusBg = colors.errorBg;
        } else if (isPassed) {
            statusText = 'PASSED';
            statusColors = colors.success;
            statusBg = colors.successBg;
        }

        const scoreY = 92;
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(15, scoreY, 180, 28, 3, 3, 'F');
        doc.rect(15, scoreY, 180, 28, 'S');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(colors.textPrimary[0], colors.textPrimary[1], colors.textPrimary[2]);
        doc.text('EVALUATION SCORE:', 22, scoreY + 9);
        
        doc.setFontSize(16);
        doc.setTextColor(colors.blue[0], colors.blue[1], colors.blue[2]);
        doc.text(`${score} / ${totalPoints}`, 22, scoreY + 19);
        
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(colors.textMuted[0], colors.textMuted[1], colors.textMuted[2]);
        doc.text(`Percentage: ${percentage}%`, 70, scoreY + 17);

        const barWidth = 70;
        doc.setFillColor(226, 232, 240);
        doc.roundedRect(70, scoreY + 21, barWidth, 3, 1.5, 1.5, 'F');
        
        if (percentage > 0) {
            doc.setFillColor(statusColors[0], statusColors[1], statusColors[2]);
            doc.roundedRect(70, scoreY + 21, (percentage / 100) * barWidth, 3, 1.5, 1.5, 'F');
        }

        doc.setFillColor(statusBg[0], statusBg[1], statusBg[2]);
        doc.setDrawColor(statusColors[0], statusColors[1], statusColors[2]);
        doc.roundedRect(148, scoreY + 6, 40, 16, 2, 2, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(statusColors[0], statusColors[1], statusColors[2]);
        doc.text(statusText, 168, scoreY + 16.5, { align: 'center' });

        const tableBody = [
            ['Total Points / Marks Available', `${totalPoints} Points`],
            ['Marks Obtained by Student', `${score} Points`],
            ['Evaluated Percentage', `${percentage}%`],
            ['Total Questions in Exam', `${exam.questions?.length || 0}`],
            ['Questions Attempted', `${session.answers?.length || 0}`],
            ['Questions Unattempted', `${(exam.questions?.length || 0) - (session.answers?.length || 0)}`],
            ['Browser / Client OS', `${session.deviceInfo?.deviceName || 'Web Client'} (${session.deviceInfo?.os || 'Unknown OS'})`]
        ];

        autoTable(doc, {
            startY: 126,
            head: [['Evaluation Metric', 'Details / Values']],
            body: tableBody,
            theme: 'striped',
            headStyles: { 
                fillColor: [30, 41, 59], 
                textColor: 255, 
                fontSize: 10, 
                fontStyle: 'bold',
                halign: 'left'
            },
            styles: { 
                fontSize: 9.5, 
                cellPadding: 5.5, 
                textColor: [51, 65, 85]
            },
            columnStyles: {
                0: { fontStyle: 'bold', cellWidth: 95 },
                1: { cellWidth: 'auto' }
            },
            margin: { left: 15, right: 15 }
        });

        const tableFinalY = (doc as any).lastAutoTable.finalY || 205;
        const verifyY = Math.max(222, tableFinalY + 10);
        doc.setFillColor(252, 252, 252);
        doc.setDrawColor(colors.border[0], colors.border[1], colors.border[2]);
        doc.roundedRect(15, verifyY, 180, 24, 3, 3, 'FD');

        doc.setDrawColor(148, 163, 184);
        doc.setFillColor(241, 245, 249);
        doc.roundedRect(20, verifyY + 4, 10, 16, 2, 2, 'FD');
        
        // Draw custom vector security ribbon seal
        doc.setDrawColor(30, 41, 59); // Navy color for ribbons
        doc.setFillColor(30, 41, 59);
        
        // Left Ribbon Tail
        doc.triangle(21.5, verifyY + 20, 23.5, verifyY + 17.5, 24.5, verifyY + 17.5, 'FD');
        doc.triangle(21.5, verifyY + 20, 24, verifyY + 19, 24.5, verifyY + 17.5, 'FD');
        
        // Right Ribbon Tail
        doc.triangle(28.5, verifyY + 20, 26.5, verifyY + 17.5, 25.5, verifyY + 17.5, 'FD');
        doc.triangle(28.5, verifyY + 20, 26, verifyY + 19, 25.5, verifyY + 17.5, 'FD');

        // Outer Seal Circle (filled white to cover ribbon connections)
        doc.setDrawColor(30, 41, 59);
        doc.setFillColor(255, 255, 255);
        doc.setLineWidth(0.85);
        doc.circle(25, verifyY + 12, 6.5, 'FD');
        
        // Inner Seal Circle
        doc.setLineWidth(0.4);
        doc.circle(25, verifyY + 12, 5.5, 'D');

        // Draw custom green checkmark inside seal
        doc.setLineWidth(0.95);
        doc.setDrawColor(22, 163, 74); // Green 600
        doc.line(23.2, verifyY + 12, 24.5, verifyY + 13.5);
        doc.line(24.5, verifyY + 13.5, 26.8, verifyY + 10.2);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(colors.navy[0], colors.navy[1], colors.navy[2]);
        doc.text('EXAM INTEGRITY & ANTI-CHEAT SECURED', 34, verifyY + 8);
        
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(colors.textMuted[0], colors.textMuted[1], colors.textMuted[2]);
        doc.text('This certificate is digitally signed and logged. Geolocation coordinates, split-screen diagnostics,', 34, verifyY + 13.5);
        doc.text(`and client hardware parameters were recorded. Verification Hash: ${session.id}`, 34, verifyY + 18.5);

        // Draw dynamic QR code on the right side of the verification box
        if (qrCodeDataUrl) {
            doc.addImage(qrCodeDataUrl, 'PNG', 165, verifyY + 2, 20, 20);
        }

        const pageCount = doc.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8.5);
            doc.setTextColor(160, 174, 192);
            doc.text('Generated by INVYRIX | NetSyc Technologies', 105, 284, { align: 'center' });
            doc.text(`Page ${i} of ${pageCount}`, 195, 284, { align: 'right' });
        }

        doc.save(`Result_${session.studentRollNo}_${exam.examName.replace(/\s+/g, '_')}.pdf`);
    };

    return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
            <div className="page" style={{ flex: 1 }}>
                <div className="container" style={{ maxWidth: '900px' }}>
                    {/* Header */}
                    <div className="text-center mb-2xl">
                        <Logo size={64} style={{ margin: '0 auto var(--space-lg)', display: 'block' }} />
                        <h1 style={{ fontSize: '1.75rem', marginBottom: 'var(--space-sm)' }}>Examination Results</h1>
                        <p className="text-secondary">Enter your roll number to view results from exams taken in this browser. For older results or a different device, contact your institute.</p>
                    </div>

                    {/* Search Form */}
                    <div className="card mb-xl" style={{ maxWidth: '500px', margin: '0 auto var(--space-xl)' }}>
                        <form onSubmit={handleSearch}>
                            <div className="input-group mb-lg">
                                <label className="input-label required">Roll Number</label>
                                <input
                                    type="text"
                                    className="input"
                                    placeholder="Enter your roll number"
                                    value={rollNo}
                                    onChange={(e) => setRollNo(e.target.value.toUpperCase())}
                                    required
                                    style={{ textTransform: 'uppercase' }}
                                />
                            </div>
                            <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={loading}>
                                {loading ? (
                                    <>
                                        <span className="spinner spinner-sm"></span>
                                        <span>Searching...</span>
                                    </>
                                ) : (
                                    <>
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                                        </svg>
                                        <span>Search Results</span>
                                    </>
                                )}
                            </button>
                        </form>
                    </div>

                    {error && (
                        <div className="alert alert-error mb-xl">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                            </svg>
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Results */}
                    {searched && !loading && (
                        <div>
                            {results.length > 0 ? (
                                <>
                                    <h2 style={{ fontSize: '1.25rem', marginBottom: 'var(--space-lg)', display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                                            <polyline points="22 4 12 14.01 9 11.01" />
                                        </svg>
                                        Results for {rollNo}
                                    </h2>

                                    <div className="flex flex-col gap-lg">
                                        {results.map(({ session, exam }) => {
                                            const totalPoints = exam.questions?.reduce((a, q) => a + q.points, 0) || 0;
                                            const percentage = calculatePercentage(session.score || 0, totalPoints);
                                            const isPassed = percentage >= 40;
                                            const isTerminated = session.status === 'terminated';

                                            return (
                                                <div key={session.id} className="card" style={{
                                                    borderLeft: `4px solid ${isTerminated ? 'var(--error)' : isPassed ? 'var(--success)' : 'var(--warning)'}`
                                                }}>
                                                    <div className="flex justify-between items-start mb-lg">
                                                        <div>
                                                            <h3 style={{ marginBottom: 'var(--space-xs)' }}>{exam.examName}</h3>
                                                            <p className="text-muted" style={{ fontSize: '0.813rem', margin: 0 }}>
                                                                {formatDate(session.endTime)}
                                                            </p>
                                                        </div>
                                                        <div className="flex flex-col items-end gap-sm">
                                                            <span className={`badge ${isTerminated ? 'badge-error' : isPassed ? 'badge-success' : 'badge-warning'}`}>
                                                                {isTerminated ? 'TERMINATED' : isPassed ? 'PASSED' : 'FAILED'}
                                                            </span>
                                                            <button
                                                                onClick={() => downloadPDF(session, exam)}
                                                                className="btn btn-secondary btn-sm"
                                                                style={{ padding: '4px 10px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                                                            >
                                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                                    <polyline points="7 10 12 15 17 10" />
                                                                    <line x1="12" y1="15" x2="12" y2="3" />
                                                                </svg>
                                                                Download Result
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className="grid grid-3 gap-md">
                                                        <div style={{ padding: 'var(--space-md)', background: 'var(--bg-surface)', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                                                            <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-xs)' }}>Score</p>
                                                            <p style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0, color: isTerminated ? 'var(--error)' : 'var(--text-primary)' }}>
                                                                {isTerminated ? 'N/A' : `${session.score || 0}/${totalPoints}`}
                                                            </p>
                                                        </div>
                                                        <div style={{ padding: 'var(--space-md)', background: 'var(--bg-surface)', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                                                            <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-xs)' }}>Percentage</p>
                                                            <p style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0, color: isTerminated ? 'var(--error)' : isPassed ? 'var(--success)' : 'var(--warning)' }}>
                                                                {isTerminated ? 'N/A' : `${percentage}%`}
                                                            </p>
                                                        </div>
                                                        <div style={{ padding: 'var(--space-md)', background: 'var(--bg-surface)', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                                                            <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 'var(--space-xs)' }}>Questions</p>
                                                            <p style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
                                                                {session.answers?.length || 0}/{exam.questions?.length || 0}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    {isTerminated && (
                                                        <div className="alert alert-error mt-lg" style={{ marginBottom: 0 }}>
                                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                                                            </svg>
                                                            <span>This exam was terminated due to rule violation.</span>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </>
                            ) : (
                                <div className="card text-center" style={{ padding: 'var(--space-3xl)' }}>
                                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" style={{ margin: '0 auto var(--space-lg)' }}>
                                        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                                    </svg>
                                    <h3 style={{ marginBottom: 'var(--space-sm)' }}>No Results Found</h3>
                                    <p className="text-secondary" style={{ marginBottom: 0 }}>
                                        No completed examinations found for roll number: <strong>{rollNo}</strong>
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Navigation */}
                    <div className="text-center mt-xl">
                        <a href="/" className="btn btn-secondary">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="15 18 9 12 15 6" />
                            </svg>
                            Back to Exam Portal
                        </a>
                    </div>
                </div>
            </div>
            <Footer />
        </div>
    );
}
