import { getSessionDocs } from '../../services/staffData';
import { useInstitute } from '../../context/InstituteContext';
import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getDocs } from 'firebase/firestore';
import { collection } from '../../services/tenant';
import { db } from '../../services/firebase';
import { ExamSession, Exam } from '../../types';
import { useAuth } from '../../context/AuthContext';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';

export default function AdminResult() {
    const { institute } = useInstitute();
    const { adminData } = useAuth();
    
    // Core Data State
    const [exams, setExams] = useState<Exam[]>([]);
    const [sessions, setSessions] = useState<ExamSession[]>([]);
    const [loading, setLoading] = useState(true);
    
    // Filters & Search State
    const [selectedExam, setSelectedExam] = useState<string>('all');
    const [searchRoll, setSearchRoll] = useState('');
    const [statusFilter, setStatusFilter] = useState('completed'); // Default to completed since results are typically completed sessions
    const [scoreFilter, setScoreFilter] = useState('all');
    
    // Table Sorting & Pagination State
    const [sortField, setSortField] = useState<'roll' | 'name' | 'score' | 'date'>('date');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    
    // PDF Export Progress State
    const [exportProgress, setExportProgress] = useState<{ current: number; total: number; loading: boolean }>({
        current: 0,
        total: 0,
        loading: false
    });

    // Reset page index on filter change
    useEffect(() => {
        setCurrentPage(1);
    }, [selectedExam, searchRoll, statusFilter, scoreFilter]);

    // Fetch Exams and Sessions
    useEffect(() => {
        const fetchData = async () => {
            try {
                const [examsSnap, sessionsSnap] = await Promise.all([
                    getDocs(collection(db, 'exams')),
                    getSessionDocs()
                ]);

                let rawExams = examsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Exam));
                let rawSessions = sessionsSnap.docs.map(d => {
                    const data = d.data();
                    return {
                        id: d.id,
                        ...data,
                        startTime: data.startTime?.toDate?.() || (data.startTime ? new Date(data.startTime) : new Date()),
                        endTime: data.endTime?.toDate?.() || (data.endTime ? new Date(data.endTime) : undefined)
                    } as ExamSession;
                });

                // Apply role-based filtering for faculty accounts
                if (adminData?.role === 'faculty') {
                    rawExams = rawExams.filter(exam => exam.assignedFaculty?.includes(adminData.id));
                    const assignedExamIds = rawExams.map(e => e.id);
                    rawSessions = rawSessions.filter(s => assignedExamIds.includes(s.examId));
                }

                setExams(rawExams);
                setSessions(rawSessions);
            } catch (err) {
                console.error('Error fetching admin results:', err);
            } finally {
                setLoading(false);
            }
        };

        if (adminData) {
            fetchData();
        }
    }, [adminData]);

    // Date formatting helper
    const formatDate = (date: any) => {
        if (!date) return 'N/A';
        const d = date instanceof Date ? date : new Date(date);
        return d.toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    };

    // Calculate percentage score
    const getSessionPercentage = (session: ExamSession, exam?: Exam) => {
        const targetExam = exam || exams.find(e => e.id === session.examId);
        if (!targetExam) return 0;
        
        const totalPoints = targetExam.questions?.reduce((sum, q) => sum + (q.points || 0), 0) || 0;
        if (totalPoints === 0) return 0;
        
        return Math.round(((session.score || 0) / totalPoints) * 100);
    };

    // Scoped list of sessions based on main exam selector dropdown
    const filteredSessions = useMemo(() => {
        return selectedExam === 'all' 
            ? sessions 
            : sessions.filter(s => s.examId === selectedExam);
    }, [sessions, selectedExam]);

    // Apply search, filters, sorting
    const processedSessions = useMemo(() => {
        let result = filteredSessions;

        // Search Roll / Name
        if (searchRoll) {
            const query = searchRoll.toLowerCase();
            result = result.filter(s => 
                s.studentRollNo.toLowerCase().includes(query) || 
                s.studentName.toLowerCase().includes(query)
            );
        }

        // Status Filter
        if (statusFilter !== 'all') {
            result = result.filter(s => s.status === statusFilter);
        }

        // Score Tier Filter
        if (scoreFilter !== 'all') {
            result = result.filter(s => {
                if (s.status !== 'completed') return false;
                const pct = getSessionPercentage(s);
                if (scoreFilter === 'excellent') return pct >= 90;
                if (scoreFilter === 'good') return pct >= 60;
                if (scoreFilter === 'pass') return pct >= 40;
                if (scoreFilter === 'fail') return pct < 40;
                return true;
            });
        }

        // Sorting
        result = [...result].sort((a, b) => {
            let valA: any = '';
            let valB: any = '';

            switch (sortField) {
                case 'roll':
                    valA = a.studentRollNo;
                    valB = b.studentRollNo;
                    break;
                case 'name':
                    valA = a.studentName;
                    valB = b.studentName;
                    break;
                case 'score':
                    valA = getSessionPercentage(a);
                    valB = getSessionPercentage(b);
                    break;
                case 'date':
                default:
                    valA = a.endTime ? new Date(a.endTime).getTime() : 0;
                    valB = b.endTime ? new Date(b.endTime).getTime() : 0;
                    break;
            }

            if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        return result;
    }, [filteredSessions, searchRoll, statusFilter, scoreFilter, sortField, sortDirection, exams]);

    // Paginate matching entries
    const paginatedSessions = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return processedSessions.slice(start, start + pageSize);
    }, [processedSessions, currentPage, pageSize]);

    const totalPages = Math.ceil(processedSessions.length / pageSize) || 1;

    const handleSort = (field: typeof sortField) => {
        if (sortField === field) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('desc');
        }
    };

    // Shared PDF drawing logic for matching StudentResults.tsx styling
    const drawReportOnPDFPage = async (doc: jsPDF, session: ExamSession, exam: Exam) => {
        // QR Code generation
        const score = session.score || 0;
        const totalPoints = exam.questions?.reduce((sum, q) => sum + (q.points || 0), 0) || 0;
        const percentage = totalPoints > 0 ? Math.round((score / totalPoints) * 100) : 0;
        const isTerminated = session.status === 'terminated';
        const isPassed = percentage >= 40 && !isTerminated;
        const statusText = isTerminated ? 'TERMINATED' : isPassed ? 'PASSED' : 'FAILED';
        
        const qrText = `INVYRIX Exam Verification — ${institute?.name || "Institute"}\nRoll No: ${session.studentRollNo}\nName: ${session.studentName || 'N/A'}\nExam: ${exam.examName}\nScore: ${score} / ${totalPoints} (${percentage}%)\nStatus: ${statusText}\nVerification ID: ${session.id}`;

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
        let statusColors = colors.error;
        let statusBg = colors.errorBg;
        
        if (isTerminated) {
            statusColors = colors.error;
            statusBg = colors.errorBg;
        } else if (isPassed) {
            statusColors = colors.success;
            statusBg = colors.successBg;
        }

        const scoreY = 92;
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(15, scoreY, 180, 28, 3, 3, 'F');
        doc.setDrawColor(colors.border[0], colors.border[1], colors.border[2]);
        doc.roundedRect(15, scoreY, 180, 28, 3, 3, 'S');

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
        
        doc.setDrawColor(30, 41, 59);
        doc.setFillColor(30, 41, 59);
        
        // ribbon drawings
        doc.triangle(21.5, verifyY + 20, 23.5, verifyY + 17.5, 24.5, verifyY + 17.5, 'FD');
        doc.triangle(21.5, verifyY + 20, 24, verifyY + 19, 24.5, verifyY + 17.5, 'FD');
        doc.triangle(28.5, verifyY + 20, 26.5, verifyY + 17.5, 25.5, verifyY + 17.5, 'FD');
        doc.triangle(28.5, verifyY + 20, 26, verifyY + 19, 25.5, verifyY + 17.5, 'FD');

        doc.setDrawColor(30, 41, 59);
        doc.setFillColor(255, 255, 255);
        doc.setLineWidth(0.85);
        doc.circle(25, verifyY + 12, 6.5, 'FD');
        
        doc.setLineWidth(0.4);
        doc.circle(25, verifyY + 12, 5.5, 'D');

        doc.setLineWidth(0.95);
        doc.setDrawColor(22, 163, 74);
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

        if (qrCodeDataUrl) {
            doc.addImage(qrCodeDataUrl, 'PNG', 165, verifyY + 2, 20, 20);
        }
    };

    // Shared page numbering loop
    const addPageNumbers = (doc: jsPDF) => {
        const pageCount = doc.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8.5);
            doc.setTextColor(160, 174, 192);
            doc.text('Generated by INVYRIX | NetSyc Technologies', 105, 284, { align: 'center' });
            doc.text(`Page ${i} of ${pageCount}`, 195, 284, { align: 'right' });
        }
    };

    // Single student PDF exporter
    const downloadSingleResult = async (session: ExamSession, exam: Exam) => {
        const doc = new jsPDF({
            encryption: {
                userPassword: '',
                ownerPassword: 'INVYRIX-NetSyc',
                userPermissions: ['print', 'copy']
            }
        } as any);
        await drawReportOnPDFPage(doc, session, exam);
        addPageNumbers(doc);
        doc.save(`Result_${session.studentRollNo}_${exam.examName.replace(/\s+/g, '_')}.pdf`);
    };

    // Combined multi-student PDF exporter
    const downloadCombinedResults = async () => {
        // Filter out only completed student results matching active criteria
        const targetSessions = processedSessions.filter(s => s.status === 'completed');
        if (targetSessions.length === 0) {
            alert('No completed results match the current filters to compile.');
            return;
        }

        setExportProgress({ current: 0, total: targetSessions.length, loading: true });
        
        // Wait slightly to render the overlay spinner
        await new Promise(resolve => setTimeout(resolve, 300));
        
        const doc = new jsPDF({
            encryption: {
                userPassword: '',
                ownerPassword: 'INVYRIX-NetSyc',
                userPermissions: ['print', 'copy']
            }
        } as any);
        
        try {
            for (let i = 0; i < targetSessions.length; i++) {
                const session = targetSessions[i];
                const exam = exams.find(e => e.id === session.examId);
                if (!exam) continue;

                if (i > 0) {
                    doc.addPage();
                }

                // Update progress hook
                setExportProgress(prev => ({ ...prev, current: i + 1 }));
                
                // Draw this page
                await drawReportOnPDFPage(doc, session, exam);
            }

            addPageNumbers(doc);
            
            const fileName = selectedExam === 'all' 
                ? 'combined_student_results.pdf' 
                : `${exams.find(e => e.id === selectedExam)?.examName.replace(/\s+/g, '_')}_combined_results.pdf`;
                
            doc.save(fileName);
        } catch (err) {
            console.error('Error compiling combined PDF:', err);
            alert('An error occurred during combined PDF generation.');
        } finally {
            setExportProgress({ current: 0, total: 0, loading: false });
        }
    };

    // CSV Results Exporter
    const downloadCSVResults = () => {
        const targetSessions = processedSessions;
        if (targetSessions.length === 0) {
            alert('No student results match the current filters to download.');
            return;
        }

        const headers = [
            'Roll Number',
            'Student Name',
            'Email',
            'Phone',
            'Exam Name',
            'Status',
            'Score Obtained',
            'Total Points',
            'Percentage (%)',
            'Grade Code',
            'Finished Date'
        ];

        const rows = targetSessions.map(s => {
            const exam = exams.find(e => e.id === s.examId);
            const totalPoints = exam?.questions?.reduce((sum, q) => sum + (q.points || 0), 0) || 0;
            const pct = getSessionPercentage(s, exam);
            const dateStr = s.endTime ? new Date(s.endTime).toLocaleString('en-IN') : 'N/A';
            
            const rollEscaped = s.studentRollNo.replace(/"/g, '""');
            const nameEscaped = s.studentName.replace(/"/g, '""');
            const examEscaped = (exam?.examName || 'Unknown').replace(/"/g, '""');
            
            let grade = 'F';
            if (s.status === 'completed') {
                if (pct >= 90) grade = 'O (Outstanding)';
                else if (pct >= 80) grade = 'A+ (Excellent)';
                else if (pct >= 70) grade = 'A (Very Good)';
                else if (pct >= 60) grade = 'B (Good)';
                else if (pct >= 50) grade = 'C (Pass)';
                else if (pct >= 40) grade = 'P (Marginal)';
                else grade = 'F (Fail)';
            }

            return [
                `"${rollEscaped}"`,
                `"${nameEscaped}"`,
                `"${s.studentEmail || ''}"`,
                `"${s.studentPhone || ''}"`,
                `"${examEscaped}"`,
                s.status,
                s.score || 0,
                totalPoints,
                pct,
                `"${grade}"`,
                `"${dateStr}"`
            ];
        });

        const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        
        const fileName = selectedExam === 'all' 
            ? 'all_results_roster.csv' 
            : `${exams.find(e => e.id === selectedExam)?.examName || 'exam'}_results_roster.csv`;
            
        link.setAttribute('download', fileName);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div>
            {/* Loading / Compiling Overlay Spinner */}
            {exportProgress.loading && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0, 0, 0, 0.85)',
                    backdropFilter: 'blur(6px)',
                    zIndex: 2000,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    <div className="spinner" style={{ width: '50px', height: '50px', marginBottom: 'var(--space-md)' }}></div>
                    <h3 style={{ fontSize: '1.25rem', marginBottom: 'var(--space-xs)' }}>Compiling Combined PDF</h3>
                    <p style={{ color: 'var(--text-secondary)' }}>
                        Processing student report {exportProgress.current} of {exportProgress.total}...
                    </p>
                    <div style={{ width: '220px', height: '6px', background: 'var(--bg-input)', borderRadius: 'var(--radius-full)', overflow: 'hidden', marginTop: 'var(--space-md)' }}>
                        <div style={{
                            width: `${(exportProgress.current / exportProgress.total) * 100}%`,
                            height: '100%',
                            background: 'var(--primary-500)',
                            borderRadius: 'var(--radius-full)',
                            transition: 'width 0.2s ease-out'
                        }} />
                    </div>
                </div>
            )}

            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
                <div>
                    <h1 className="page-title">Results Management</h1>
                    <p className="page-subtitle">Inspect student grades, export certificate PDFs, and download rosters</p>
                </div>
                
                {/* Global Controls & Downloads */}
                <div className="flex gap-md" style={{ flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary" onClick={downloadCSVResults} disabled={processedSessions.length === 0} style={{ display: 'inline-flex', gap: 'var(--space-xs)', alignItems: 'center' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        Download CSV
                    </button>
                    <button className="btn btn-primary" onClick={downloadCombinedResults} disabled={processedSessions.filter(s => s.status === 'completed').length === 0} style={{ display: 'inline-flex', gap: 'var(--space-xs)', alignItems: 'center' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="16" y1="13" x2="8" y2="13" />
                            <line x1="16" y1="17" x2="8" y2="17" />
                        </svg>
                        Download Combined PDF
                    </button>
                </div>
            </div>

            {/* Filter Toolbar */}
            <div className="card mb-xl">
                <div className="grid grid-4 gap-md">
                    {/* Exam Filter */}
                    <div className="input-group">
                        <label className="input-label">Filter by Exam</label>
                        <select className="input" value={selectedExam} onChange={(e) => setSelectedExam(e.target.value)}>
                            <option value="all">All Exams</option>
                            {exams.map(e => <option key={e.id} value={e.id}>{e.examName}</option>)}
                        </select>
                    </div>
                    {/* Search Roll / Name */}
                    <div className="input-group">
                        <label className="input-label">Search Candidate</label>
                        <input 
                            type="text" 
                            className="input" 
                            placeholder="Roll No or Student Name..." 
                            value={searchRoll} 
                            onChange={(e) => setSearchRoll(e.target.value)} 
                        />
                    </div>
                    {/* Filter Status */}
                    <div className="input-group">
                        <label className="input-label">Attempt Status</label>
                        <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                            <option value="all">All Statuses</option>
                            <option value="completed">Completed</option>
                            <option value="started">In Progress</option>
                            <option value="terminated">Terminated</option>
                        </select>
                    </div>
                    {/* Filter Grade */}
                    <div className="input-group">
                        <label className="input-label">Performance Bracket</label>
                        <select className="input" value={scoreFilter} onChange={(e) => setScoreFilter(e.target.value)}>
                            <option value="all">All Bracket Ranges</option>
                            <option value="excellent">Excellent (≥90%)</option>
                            <option value="good">Good (≥60%)</option>
                            <option value="pass">Pass (≥40%)</option>
                            <option value="fail">Fail (&lt;40%)</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Results Roster Card */}
            {loading ? (
                <div className="flex items-center justify-center" style={{ minHeight: '30vh' }}>
                    <div className="spinner"></div>
                </div>
            ) : (
                <div className="card">
                    {processedSessions.length > 0 ? (
                        <div>
                            <div className="table-container">
                                <table>
                                    <thead>
                                        <tr>
                                            <th className="sorting-header" onClick={() => handleSort('roll')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                                                Roll Number {sortField === 'roll' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                                            </th>
                                            <th className="sorting-header" onClick={() => handleSort('name')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                                                Student Name {sortField === 'name' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                                            </th>
                                            <th>Exam Name</th>
                                            <th className="sorting-header" onClick={() => handleSort('score')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                                                Score Obtained {sortField === 'score' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                                            </th>
                                            <th>Status</th>
                                            <th className="sorting-header" onClick={() => handleSort('date')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                                                Date Completed {sortField === 'date' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                                            </th>
                                            <th style={{ textAlign: 'center' }}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {paginatedSessions.map(session => {
                                            const exam = exams.find(e => e.id === session.examId);
                                            const pct = getSessionPercentage(session, exam);
                                            const total = exam?.questions?.reduce((sum, q) => sum + (q.points || 0), 0) || 0;

                                            return (
                                                <tr key={session.id}>
                                                    <td style={{ fontWeight: 600, color: 'var(--primary-300)' }}>{session.studentRollNo}</td>
                                                    <td>{session.studentName}</td>
                                                    <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {exam?.examName || 'Unknown Exam'}
                                                    </td>
                                                    <td>
                                                        {session.status === 'completed' ? (
                                                            <div className="flex gap-xs" style={{ alignItems: 'center' }}>
                                                                <span className={`badge ${pct >= 75 ? 'badge-success' : pct >= 40 ? 'badge-warning' : 'badge-error'}`}>
                                                                    {pct}%
                                                                </span>
                                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                                    ({session.score || 0}/{total} pts)
                                                                </span>
                                                            </div>
                                                        ) : (
                                                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                                                        )}
                                                    </td>
                                                    <td>
                                                        <span className={`badge ${
                                                            session.status === 'completed' ? 'badge-success' : 
                                                            session.status === 'started' ? 'badge-warning' : 
                                                            session.status === 'terminated' ? 'badge-error' : 'badge-secondary'
                                                        }`}>
                                                            {session.status === 'started' ? 'IN PROGRESS' : session.status.toUpperCase()}
                                                        </span>
                                                    </td>
                                                    <td style={{ fontSize: '0.85rem' }}>{formatDate(session.endTime || session.startTime)}</td>
                                                    <td style={{ textAlign: 'center' }}>
                                                        <div className="flex gap-sm" style={{ justifyContent: 'center' }}>
                                                            {/* Download Single result */}
                                                            <button 
                                                                className="btn btn-secondary btn-sm" 
                                                                style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem', display: 'inline-flex', gap: '4px', alignItems: 'center' }}
                                                                onClick={() => exam && downloadSingleResult(session, exam)}
                                                                disabled={session.status !== 'completed'}
                                                            >
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                                    <polyline points="7 10 12 15 17 10" />
                                                                    <line x1="12" y1="15" x2="12" y2="3" />
                                                                </svg>
                                                                PDF
                                                            </button>
                                                            {/* Link to SessionDetails */}
                                                            <Link 
                                                                to={`/admin/dashboard/sessions/${session.id}`}
                                                                className="btn btn-secondary btn-sm" 
                                                                style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}
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
                            
                            {/* Pagination Roster */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-lg)', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
                                <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                                    Showing {Math.min(processedSessions.length, (currentPage - 1) * pageSize + 1)} - {Math.min(processedSessions.length, currentPage * pageSize)} of {processedSessions.length} results
                                </div>
                                <div className="flex gap-md" style={{ alignItems: 'center' }}>
                                    {/* Page size toggle */}
                                    <div className="flex gap-xs" style={{ alignItems: 'center', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                                        <span>Show:</span>
                                        <select 
                                            value={pageSize} 
                                            onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }} 
                                            className="input" 
                                            style={{ padding: '0.25rem 0.5rem', width: '65px', fontSize: '0.875rem' }}
                                        >
                                            <option value={10}>10</option>
                                            <option value={25}>25</option>
                                            <option value={50}>50</option>
                                            <option value={100}>100</option>
                                        </select>
                                    </div>
                                    
                                    {/* Prev/Next buttons */}
                                    <div className="flex gap-xs">
                                        <button 
                                            className="btn btn-secondary" 
                                            style={{ padding: '0.35rem 0.75rem', fontSize: '0.875rem' }} 
                                            disabled={currentPage === 1} 
                                            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                        >
                                            &larr; Prev
                                        </button>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0 0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                                            Page {currentPage} of {totalPages}
                                        </span>
                                        <button 
                                            className="btn btn-secondary" 
                                            style={{ padding: '0.35rem 0.75rem', fontSize: '0.875rem' }} 
                                            disabled={currentPage === totalPages} 
                                            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                        >
                                            Next &rarr;
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="empty-state" style={{ padding: 'var(--space-2xl)' }}>
                            <p>No results found matching search and filters criteria.</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
