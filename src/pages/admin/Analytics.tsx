import { getSessionDocs } from '../../services/staffData';
import { useState, useEffect, useMemo } from 'react';
import { getDocs } from 'firebase/firestore';
import { collection } from '../../services/tenant';
import { db } from '../../services/firebase';
import { ExamSession, Exam } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { formatDeviceName } from '../../utils/deviceUtils';

export default function Analytics() {
    const { adminData } = useAuth();
    
    // Core Data State
    const [exams, setExams] = useState<Exam[]>([]);
    const [sessions, setSessions] = useState<ExamSession[]>([]);
    const [loading, setLoading] = useState(true);
    
    // UI Navigation State
    const [selectedExam, setSelectedExam] = useState<string>('all');
    const [activeTab, setActiveTab] = useState<'overview' | 'students' | 'questions' | 'matrix'>('overview');
    
    // Student Table Filter/Sort/Pagination State
    const [searchRoll, setSearchRoll] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [scoreFilter, setScoreFilter] = useState('all');
    const [sortField, setSortField] = useState<'roll' | 'name' | 'score' | 'warnings' | 'tabSwitches' | 'date'>('date');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    
    // Interactive Detail State
    const [selectedSession, setSelectedSession] = useState<ExamSession | null>(null);
    const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);

    // Reset pagination when filter/search changes
    useEffect(() => {
        setCurrentPage(1);
    }, [searchRoll, statusFilter, scoreFilter, selectedExam]);

    // Force tab validation on exam switch
    useEffect(() => {
        if (selectedExam === 'all' && activeTab === 'questions') {
            setActiveTab('overview');
        } else if (selectedExam !== 'all' && activeTab === 'matrix') {
            setActiveTab('overview');
        }
    }, [selectedExam, activeTab]);

    // Fetch initial data
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
                console.error('Error fetching analytics data:', err);
            } finally {
                setLoading(false);
            }
        };
        
        if (adminData) {
            fetchData();
        }
    }, [adminData]);

    // Scoped list of sessions based on exam dropdown
    const filteredSessions = useMemo(() => {
        return selectedExam === 'all' 
            ? sessions 
            : sessions.filter(s => s.examId === selectedExam);
    }, [sessions, selectedExam]);

    // Format Date utility
    const formatDate = (date: any) => {
        if (!date) return 'N/A';
        const d = date instanceof Date ? date : new Date(date);
        return d.toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    };

    // Calculate time spent duration string
    const formatTimeSpent = (session: ExamSession) => {
        if (!session.startTime) return 'N/A';
        const start = new Date(session.startTime).getTime();
        const end = session.endTime ? new Date(session.endTime).getTime() : Date.now();
        const diffMs = end - start;
        if (diffMs < 0) return '0s';
        
        const diffMins = Math.floor(diffMs / 60000);
        const diffSecs = Math.floor((diffMs % 60000) / 1000);
        
        if (diffMins > 0) {
            return `${diffMins}m ${diffSecs}s`;
        }
        return `${diffSecs}s`;
    };

    // Compute percentage score for a single session
    const getSessionPercentage = (session: ExamSession, exam?: Exam) => {
        const targetExam = exam || exams.find(e => e.id === session.examId);
        if (!targetExam) return 0;
        
        const totalPoints = targetExam.questions?.reduce((sum, q) => sum + (q.points || 0), 0) || 0;
        if (totalPoints === 0) return 0;
        
        return Math.round(((session.score || 0) / totalPoints) * 100);
    };

    // Compute average score of a list of completed sessions
    const getAvgScorePercentage = (sessionsList: ExamSession[]) => {
        const completedList = sessionsList.filter(s => s.status === 'completed');
        if (completedList.length === 0) return 0;
        
        let totalPct = 0;
        completedList.forEach(s => {
            totalPct += getSessionPercentage(s);
        });
        
        return Math.round(totalPct / completedList.length);
    };

    // Key metrics calculations
    const stats = useMemo(() => {
        const total = filteredSessions.length;
        const completedList = filteredSessions.filter(s => s.status === 'completed');
        const completed = completedList.length;
        const terminated = filteredSessions.filter(s => s.status === 'terminated').length;
        const active = filteredSessions.filter(s => s.status === 'started').length;
        
        const avgScore = getAvgScorePercentage(filteredSessions);
        const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
        
        const warnings = filteredSessions.reduce((sum, s) => sum + (s.warningCount || 0), 0);
        const tabSwitches = filteredSessions.reduce((sum, s) => sum + (s.tabSwitchCount || 0), 0);
        
        const cleanAttempts = filteredSessions.filter(s => 
            (s.warningCount || 0) === 0 && 
            (s.tabSwitchCount || 0) === 0 && 
            s.status !== 'terminated'
        ).length;
        const integrityRate = total > 0 ? Math.round((cleanAttempts / total) * 100) : 100;

        return {
            total,
            completed,
            terminated,
            active,
            avgScore,
            completionRate,
            warnings,
            tabSwitches,
            integrityRate
        };
    }, [filteredSessions, exams]);

    // Score distribution bins
    const scoreBins = useMemo(() => {
        const bins = [
            { label: '90-100%', count: 0, color: 'var(--accent-emerald)' },
            { label: '80-89%', count: 0, color: 'var(--info)' },
            { label: '70-79%', count: 0, color: 'var(--primary-400)' },
            { label: '60-69%', count: 0, color: 'var(--accent-purple)' },
            { label: '50-59%', count: 0, color: 'var(--warning)' },
            { label: '<50%', count: 0, color: 'var(--error)' }
        ];

        const completedList = filteredSessions.filter(s => s.status === 'completed');
        completedList.forEach(s => {
            const pct = getSessionPercentage(s);
            if (pct >= 90) bins[0].count++;
            else if (pct >= 80) bins[1].count++;
            else if (pct >= 70) bins[2].count++;
            else if (pct >= 60) bins[3].count++;
            else if (pct >= 50) bins[4].count++;
            else bins[5].count++;
        });

        return bins;
    }, [filteredSessions, exams]);

    // Cheating occurrences breakdown
    const cheatingBreakdown = useMemo(() => {
        const counts: Record<string, { label: string; count: number; color: string }> = {
            tab_switch: { label: 'Tab Switches', count: 0, color: 'var(--warning)' },
            keyboard_shortcut: { label: 'Keyboard Shortcuts', count: 0, color: 'var(--accent-purple)' },
            devtools: { label: 'DevTools Opened', count: 0, color: 'var(--error)' },
            fullscreen_exit: { label: 'Fullscreen Exit', count: 0, color: 'var(--accent-cyan)' },
            copy_paste: { label: 'Copy / Paste', count: 0, color: 'var(--info)' },
            split_screen: { label: 'Split Screen Det.', count: 0, color: 'var(--accent-rose)' }
        };

        filteredSessions.forEach(s => {
            s.cheatingEvents?.forEach(e => {
                if (e.type && counts[e.type]) {
                    counts[e.type].count++;
                }
            });
        });

        return Object.values(counts).sort((a, b) => b.count - a.count);
    }, [filteredSessions]);

    const totalCheatingEventsCount = useMemo(() => {
        return cheatingBreakdown.reduce((sum, item) => sum + item.count, 0);
    }, [cheatingBreakdown]);

    // Question-by-Question performance analysis
    const questionStats = useMemo(() => {
        if (selectedExam === 'all') return [];

        const exam = exams.find(e => e.id === selectedExam);
        if (!exam || !exam.questions) return [];

        const examSessions = sessions.filter(s => s.examId === exam.id);
        const completedSessions = examSessions.filter(s => s.status === 'completed');

        return exam.questions.map((q, idx) => {
            const attempts = examSessions.length;
            const correctCount = completedSessions.filter(s => {
                const ans = s.answers?.find(a => a.questionId === q.id);
                return ans && ans.answer === q.correctAnswer;
            }).length;

            const successRate = completedSessions.length > 0
                ? Math.round((correctCount / completedSessions.length) * 100)
                : 0;

            return {
                id: q.id,
                index: idx + 1,
                text: q.text,
                type: q.type,
                options: q.options || [],
                correctAnswer: q.correctAnswer,
                points: q.points,
                attempts,
                correctCount,
                completedCount: completedSessions.length,
                successRate
            };
        });
    }, [selectedExam, exams, sessions]);

    // Identify hardest & easiest questions
    const { hardestQuestion, easiestQuestion } = useMemo(() => {
        if (questionStats.length === 0) return { hardestQuestion: null, easiestQuestion: null };
        const sorted = [...questionStats].sort((a, b) => a.successRate - b.successRate);
        return {
            hardestQuestion: sorted[0],
            easiestQuestion: sorted[sorted.length - 1]
        };
    }, [questionStats]);

    // Handle student roster processing (search, filter, sort)
    const processedSessions = useMemo(() => {
        let result = filteredSessions;

        // Roll or Name Search filter
        if (searchRoll) {
            const query = searchRoll.toLowerCase();
            result = result.filter(s => 
                s.studentRollNo.toLowerCase().includes(query) || 
                s.studentName.toLowerCase().includes(query)
            );
        }

        // Status filter
        if (statusFilter !== 'all') {
            result = result.filter(s => s.status === statusFilter);
        }

        // Score tier filter
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

        // Sorting configuration
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
                case 'warnings':
                    valA = a.warningCount || 0;
                    valB = b.warningCount || 0;
                    break;
                case 'tabSwitches':
                    valA = a.tabSwitchCount || 0;
                    valB = b.tabSwitchCount || 0;
                    break;
                case 'date':
                default:
                    valA = a.startTime ? new Date(a.startTime).getTime() : 0;
                    valB = b.startTime ? new Date(b.startTime).getTime() : 0;
                    break;
            }

            if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        return result;
    }, [filteredSessions, searchRoll, statusFilter, scoreFilter, sortField, sortDirection, exams]);

    // Paginate sorted sessions
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

    // CSV Roster Export
    const exportToCSV = () => {
        const headers = [
            'Roll Number',
            'Student Name',
            'Email',
            'Phone',
            'Exam ID',
            'Status',
            'Score Obtained',
            'Total Points',
            'Percentage (%)',
            'Warnings',
            'Tab Switches',
            'Time Spent',
            'Start Time',
            'End Time'
        ];

        const rows = filteredSessions.map(s => {
            const exam = exams.find(e => e.id === s.examId);
            const totalPoints = exam?.questions?.reduce((sum, q) => sum + (q.points || 0), 0) || 0;
            const pct = getSessionPercentage(s, exam);
            const startStr = s.startTime ? new Date(s.startTime).toLocaleString('en-IN') : 'N/A';
            const endStr = s.endTime ? new Date(s.endTime).toLocaleString('en-IN') : 'N/A';
            
            const rollEscaped = s.studentRollNo.replace(/"/g, '""');
            const nameEscaped = s.studentName.replace(/"/g, '""');
            const examIdEscaped = s.examId.replace(/"/g, '""');

            return [
                `"${rollEscaped}"`,
                `"${nameEscaped}"`,
                `"${s.studentEmail || ''}"`,
                `"${s.studentPhone || ''}"`,
                `"${examIdEscaped}"`,
                s.status,
                s.score || 0,
                totalPoints,
                pct,
                s.warningCount || 0,
                s.tabSwitchCount || 0,
                `"${formatTimeSpent(s)}"`,
                `"${startStr}"`,
                `"${endStr}"`
            ];
        });

        const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        
        const fileName = selectedExam === 'all' 
            ? 'all_exams_performance.csv' 
            : `${exams.find(e => e.id === selectedExam)?.examName || 'exam'}_performance.csv`;
            
        link.setAttribute('download', fileName);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center" style={{ minHeight: '50vh' }}>
                <div className="spinner"></div>
            </div>
        );
    }

    // Prepare active exam context for student session detailed modal
    const inspectedExam = selectedSession 
        ? exams.find(e => e.id === selectedSession.examId) 
        : null;

    // SVG Score distribution scaling
    const maxBinCount = Math.max(...scoreBins.map(b => b.count), 1);

    return (
        <div>
            {/* Custom Component Styles */}
            <style>{`
                .tabs-nav {
                    display: flex;
                    gap: var(--space-xs);
                    border-bottom: 1px solid var(--border-color);
                    margin-bottom: var(--space-xl);
                }
                .tab-btn {
                    padding: var(--space-sm) var(--space-lg);
                    background: transparent;
                    border: none;
                    color: var(--text-secondary);
                    font-weight: 500;
                    cursor: pointer;
                    position: relative;
                    transition: color var(--transition-fast);
                    outline: none;
                    font-size: 0.95rem;
                }
                .tab-btn:hover {
                    color: var(--text-primary);
                }
                .tab-btn.active {
                    color: var(--primary-400);
                    font-weight: 600;
                }
                .tab-btn.active::after {
                    content: '';
                    position: absolute;
                    bottom: -1px;
                    left: 0;
                    right: 0;
                    height: 2px;
                    background: var(--primary-500);
                    box-shadow: 0 0 10px var(--primary-500);
                }
                
                /* SVG Chart Tooltips and Styling */
                .chart-bar-rect {
                    transition: height 0.3s ease, y 0.3s ease, opacity var(--transition-fast);
                    cursor: pointer;
                }
                .chart-bar-rect:hover {
                    opacity: 1;
                    filter: brightness(1.15);
                }
                
                /* Side Drawer Modal */
                .modal-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.7);
                    backdrop-filter: blur(4px);
                    display: flex;
                    justify-content: flex-end;
                    z-index: 1000;
                    animation: fadeIn 0.2s ease-out;
                }
                .modal-drawer {
                    width: 100%;
                    max-width: 650px;
                    background: var(--bg-card);
                    border-left: 1px solid var(--border-color);
                    height: 100%;
                    display: flex;
                    flex-direction: column;
                    animation: slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
                    box-shadow: var(--shadow-xl);
                }
                .modal-header {
                    padding: var(--space-lg);
                    border-bottom: 1px solid var(--border-color);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    background: var(--bg-surface);
                }
                .modal-body {
                    padding: var(--space-lg);
                    overflow-y: auto;
                    flex: 1;
                }
                .modal-close-btn {
                    background: transparent;
                    border: none;
                    color: var(--text-secondary);
                    cursor: pointer;
                    padding: var(--space-xs);
                    border-radius: var(--radius-sm);
                    transition: background var(--transition-fast), color var(--transition-fast);
                }
                .modal-close-btn:hover {
                    background: rgba(255, 255, 255, 0.08);
                    color: var(--text-primary);
                }
                
                /* Detailed Cards in Modal Drawer */
                .question-detail-card {
                    background: var(--bg-surface);
                    border: 1px solid var(--border-color);
                    border-radius: var(--radius-md);
                    padding: var(--space-md);
                    margin-bottom: var(--space-md);
                    transition: border-color var(--transition-fast);
                }
                .question-detail-card.correct {
                    border-left: 4px solid var(--success);
                }
                .question-detail-card.incorrect {
                    border-left: 4px solid var(--error);
                }
                .question-detail-card.unanswered {
                    border-left: 4px solid var(--text-muted);
                }
                
                /* Warnings Timeline */
                .timeline {
                    border-left: 2px solid var(--border-color);
                    padding-left: var(--space-lg);
                    margin-left: var(--space-md);
                    margin-top: var(--space-md);
                    position: relative;
                }
                .timeline-item {
                    position: relative;
                    margin-bottom: var(--space-lg);
                }
                .timeline-dot {
                    position: absolute;
                    left: calc(-1 * var(--space-lg) - 7px);
                    top: 4px;
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    background: var(--border-color);
                    border: 2px solid var(--bg-card);
                }
                .timeline-dot.high {
                    background: var(--error);
                    box-shadow: var(--shadow-glow-error);
                }
                .timeline-dot.medium {
                    background: var(--warning);
                    box-shadow: 0 0 10px rgba(245, 158, 11, 0.3);
                }
                .timeline-dot.low {
                    background: var(--info);
                    box-shadow: 0 0 10px rgba(59, 130, 246, 0.3);
                }
                .timeline-time {
                    font-size: 0.75rem;
                    color: var(--text-muted);
                    margin-bottom: var(--space-xs);
                }
                .timeline-content {
                    background: var(--bg-surface);
                    padding: var(--space-sm) var(--space-md);
                    border-radius: var(--radius-md);
                    border: 1px solid var(--border-color);
                    font-size: 0.875rem;
                }
                
                /* Accordion Question List */
                .accordion-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: var(--space-md);
                    background: var(--bg-surface);
                    border: 1px solid var(--border-color);
                    border-radius: var(--radius-md);
                    cursor: pointer;
                    margin-bottom: var(--space-sm);
                    transition: border-color var(--transition-fast), background var(--transition-fast);
                }
                .accordion-header:hover {
                    border-color: var(--border-color-hover);
                    background: var(--bg-card-hover);
                }
                .accordion-content {
                    padding: var(--space-md);
                    background: rgba(13, 13, 22, 0.4);
                    border: 1px solid var(--border-color);
                    border-top: none;
                    border-bottom-left-radius: var(--radius-md);
                    border-bottom-right-radius: var(--radius-md);
                    margin-top: calc(-1 * var(--space-sm) - 1px);
                    margin-bottom: var(--space-md);
                }
                .sorting-header {
                    cursor: pointer;
                    user-select: none;
                }
                .sorting-header:hover {
                    color: var(--text-primary);
                }
                
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes slideIn {
                    from { transform: translateX(100%); }
                    to { transform: translateX(0); }
                }
            `}</style>

            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
                <div>
                    <h1 className="page-title">Analytics</h1>
                    <p className="page-subtitle">Exam performance insights</p>
                </div>
                
                {/* Global Controls */}
                <div className="flex gap-md" style={{ flexWrap: 'wrap' }}>
                    <div className="input-group" style={{ margin: 0, minWidth: '220px' }}>
                        <select className="input" value={selectedExam} onChange={(e) => setSelectedExam(e.target.value)}>
                            <option value="all">All Exams</option>
                            {exams.map(e => <option key={e.id} value={e.id}>{e.examName}</option>)}
                        </select>
                    </div>
                    <button className="btn btn-secondary" onClick={exportToCSV} disabled={filteredSessions.length === 0} style={{ display: 'inline-flex', gap: 'var(--space-xs)', alignItems: 'center' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        Export CSV
                    </button>
                </div>
            </div>

            {/* Navigation Tabs */}
            <div className="tabs-nav">
                <button className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
                    Overview
                </button>
                <button className={`tab-btn ${activeTab === 'students' ? 'active' : ''}`} onClick={() => setActiveTab('students')}>
                    Student Performance ({processedSessions.length})
                </button>
                {selectedExam !== 'all' && (
                    <button className={`tab-btn ${activeTab === 'questions' ? 'active' : ''}`} onClick={() => setActiveTab('questions')}>
                        Question Analysis
                    </button>
                )}
                {selectedExam === 'all' && (
                    <button className={`tab-btn ${activeTab === 'matrix' ? 'active' : ''}`} onClick={() => setActiveTab('matrix')}>
                        Exam Matrix
                    </button>
                )}
            </div>

            {/* TAB CONTENT: OVERVIEW */}
            {activeTab === 'overview' && (
                <div>
                    {/* Top Stats Cards */}
                    <div className="grid grid-4 mb-xl">
                        <div className="stat-card">
                            <div className="stat-icon primary">📊</div>
                            <div className="stat-content">
                                <div className="stat-value">{stats.total}</div>
                                <div className="stat-label">Total Attempts</div>
                            </div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-icon success">✅</div>
                            <div className="stat-content">
                                <div className="stat-value">{stats.completionRate}%</div>
                                <div className="stat-label">Completion Rate</div>
                            </div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-icon info">🎯</div>
                            <div className="stat-content">
                                <div className="stat-value">{stats.avgScore}%</div>
                                <div className="stat-label">Avg Score</div>
                            </div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-icon error" style={{ background: stats.integrityRate < 75 ? 'rgba(244, 63, 94, 0.2)' : 'rgba(16, 185, 129, 0.2)', color: stats.integrityRate < 75 ? 'var(--error)' : 'var(--success)' }}>
                                {stats.integrityRate >= 85 ? '🛡️' : '⚠️'}
                            </div>
                            <div className="stat-content">
                                <div className="stat-value" style={{ color: stats.integrityRate < 75 ? 'var(--error)' : 'var(--text-primary)' }}>{stats.integrityRate}%</div>
                                <div className="stat-label">Integrity Rate</div>
                            </div>
                        </div>
                    </div>

                    {/* Breakdown Graphs */}
                    <div className="grid grid-2 mb-xl">
                        {/* Score Distribution Chart */}
                        <div className="card">
                            <div className="card-header" style={{ marginBottom: 'var(--space-md)' }}>
                                <h3 className="card-title">📈 Score Distribution</h3>
                                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>Percentage brackets of completed attempts</p>
                            </div>
                            {stats.completed > 0 ? (
                                <div style={{ display: 'flex', justifyContent: 'center' }}>
                                    <svg viewBox="0 0 540 240" style={{ width: '100%', height: 'auto', background: 'transparent' }}>
                                        {/* Chart Grid Lines */}
                                        {[0, 0.25, 0.5, 0.75, 1].map((val, idx) => {
                                            const y = 190 - val * 150;
                                            const labelVal = Math.round(val * maxBinCount);
                                            return (
                                                <g key={idx}>
                                                    <line x1="45" y1={y} x2="515" y2={y} stroke="var(--border-color)" strokeWidth="1" strokeDasharray="4 4" />
                                                    <text x="35" y={y + 4} textAnchor="end" fill="var(--text-muted)" fontSize="10">{labelVal}</text>
                                                </g>
                                            );
                                        })}
                                        
                                        {/* Draw Bars */}
                                        {scoreBins.map((bin, idx) => {
                                            const width = 44;
                                            const spacing = 72;
                                            const x = 65 + idx * spacing;
                                            const height = (bin.count / maxBinCount) * 150;
                                            const y = 190 - height;
                                            
                                            return (
                                                <g key={idx}>
                                                    <rect 
                                                        x={x} 
                                                        y={y} 
                                                        width={width} 
                                                        height={height} 
                                                        rx="4" 
                                                        fill={bin.color} 
                                                        opacity="0.85" 
                                                        className="chart-bar-rect"
                                                    />
                                                    {/* Count above bar */}
                                                    {bin.count > 0 && (
                                                        <text x={x + width / 2} y={y - 8} textAnchor="middle" fill="var(--text-primary)" fontSize="11" fontWeight="600">
                                                            {bin.count}
                                                        </text>
                                                    )}
                                                    {/* Label below bar */}
                                                    <text x={x + width / 2} y="212" textAnchor="middle" fill="var(--text-secondary)" fontSize="10">
                                                        {bin.label}
                                                    </text>
                                                </g>
                                            );
                                        })}
                                        {/* Base Axis Line */}
                                        <line x1="45" y1="190" x2="515" y2="190" stroke="var(--border-color)" strokeWidth="1.5" />
                                    </svg>
                                </div>
                            ) : (
                                <div className="empty-state" style={{ minHeight: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <p>No completed submissions available to show score distribution</p>
                                </div>
                            )}
                        </div>

                        {/* Security Incident Breakdown */}
                        <div className="card">
                            <div className="card-header" style={{ marginBottom: 'var(--space-md)' }}>
                                <h3 className="card-title">🛡️ Security Violations Summary</h3>
                                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                                    Total flaggings: {totalCheatingEventsCount} across {stats.warnings} total warnings
                                </p>
                            </div>
                            
                            {totalCheatingEventsCount > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', justifyContent: 'center', minHeight: '180px' }}>
                                    {cheatingBreakdown.slice(0, 5).map((item, idx) => {
                                        const percentageShare = totalCheatingEventsCount > 0 
                                            ? Math.round((item.count / totalCheatingEventsCount) * 100) 
                                            : 0;
                                        
                                        if (item.count === 0) return null;

                                        return (
                                            <div key={idx}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: 'var(--space-xs)' }}>
                                                    <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{item.label}</span>
                                                    <span style={{ color: 'var(--text-secondary)' }}>
                                                        {item.count} alerts ({percentageShare}%)
                                                    </span>
                                                </div>
                                                <div style={{ width: '100%', height: '6px', background: 'var(--bg-dark)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
                                                    <div style={{ width: `${percentageShare}%`, height: '100%', background: item.color, borderRadius: 'var(--radius-full)' }} />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="empty-state" style={{ minHeight: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <p>🎉 Excellent! No security alerts or cheating violations recorded.</p>
                                </div>
                            )}
                        </div>
                    </div>
                    
                    {/* Exam Overview / Recent Stats */}
                    <div className="card">
                        <div className="card-header">
                            <h3 className="card-title">📋 {selectedExam === 'all' ? 'Exams Overview' : 'Exam Analytics Roster'}</h3>
                        </div>
                        {exams.length > 0 ? (
                            <div className="table-container">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Exam</th>
                                            <th>Attempts</th>
                                            <th>Completed</th>
                                            <th>Avg Score</th>
                                            <th>Warnings</th>
                                            <th>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {selectedExam === 'all' ? (
                                            exams.map(exam => {
                                                const examSessions = sessions.filter(x => x.examId === exam.id);
                                                const c = examSessions.filter(x => x.status === 'completed');
                                                const avg = getAvgScorePercentage(examSessions);
                                                const totalWarns = examSessions.reduce((s, x) => s + (x.warningCount || 0), 0);
                                                
                                                return (
                                                    <tr key={exam.id}>
                                                        <td>
                                                            <div style={{ fontWeight: 600 }}>{exam.examName}</div>
                                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ID: {exam.id}</div>
                                                        </td>
                                                        <td>{examSessions.length}</td>
                                                        <td>{c.length}</td>
                                                        <td>
                                                            <span className={`badge ${avg >= 75 ? 'badge-success' : avg >= 40 ? 'badge-warning' : 'badge-error'}`}>
                                                                {avg}%
                                                            </span>
                                                        </td>
                                                        <td style={{ color: totalWarns > 10 ? 'var(--error)' : totalWarns > 0 ? 'var(--warning)' : 'var(--success)' }}>
                                                            {totalWarns}
                                                        </td>
                                                        <td>
                                                            <span className={`badge ${
                                                                exam.status === 'active' ? 'badge-success' : 
                                                                exam.status === 'completed' ? 'badge-info' : 
                                                                exam.status === 'draft' ? 'badge-secondary' : 'badge-error'
                                                            }`}>
                                                                {exam.status.toUpperCase()}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        ) : (
                                            (() => {
                                                const exam = exams.find(e => e.id === selectedExam);
                                                if (!exam) return null;
                                                const examSessions = sessions.filter(x => x.examId === exam.id);
                                                const c = examSessions.filter(x => x.status === 'completed');
                                                const avg = getAvgScorePercentage(examSessions);
                                                const totalWarns = examSessions.reduce((s, x) => s + (x.warningCount || 0), 0);

                                                return (
                                                    <tr key={exam.id}>
                                                        <td>
                                                            <div style={{ fontWeight: 600 }}>{exam.examName}</div>
                                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ID: {exam.id}</div>
                                                        </td>
                                                        <td>{examSessions.length}</td>
                                                        <td>{c.length}</td>
                                                        <td>
                                                            <span className={`badge ${avg >= 75 ? 'badge-success' : avg >= 40 ? 'badge-warning' : 'badge-error'}`}>
                                                                {avg}%
                                                            </span>
                                                        </td>
                                                        <td style={{ color: totalWarns > 10 ? 'var(--error)' : totalWarns > 0 ? 'var(--warning)' : 'var(--success)' }}>
                                                            {totalWarns}
                                                        </td>
                                                        <td>
                                                            <span className={`badge ${
                                                                exam.status === 'active' ? 'badge-success' : 
                                                                exam.status === 'completed' ? 'badge-info' : 
                                                                exam.status === 'draft' ? 'badge-secondary' : 'badge-error'
                                                            }`}>
                                                                {exam.status.toUpperCase()}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })()
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
                                <p>No exams found</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* TAB CONTENT: STUDENT PERFORMANCE / ATTEMPTS */}
            {activeTab === 'students' && (
                <div className="card">
                    {/* Filters Toolbar */}
                    <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap', marginBottom: 'var(--space-lg)', paddingBottom: 'var(--space-md)', borderBottom: '1px solid var(--border-color)' }}>
                        {/* Search */}
                        <div className="input-group" style={{ margin: 0, flex: 1, minWidth: '200px' }}>
                            <input 
                                type="text" 
                                className="input" 
                                placeholder="Search by Roll No or Student Name..." 
                                value={searchRoll} 
                                onChange={(e) => setSearchRoll(e.target.value)} 
                            />
                        </div>
                        {/* Filter Status */}
                        <div className="input-group" style={{ margin: 0, minWidth: '150px' }}>
                            <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                                <option value="all">All Statuses</option>
                                <option value="completed">Completed</option>
                                <option value="started">In Progress</option>
                                <option value="terminated">Terminated</option>
                            </select>
                        </div>
                        {/* Filter Score bracket */}
                        <div className="input-group" style={{ margin: 0, minWidth: '150px' }}>
                            <select className="input" value={scoreFilter} onChange={(e) => setScoreFilter(e.target.value)}>
                                <option value="all">All Grades</option>
                                <option value="excellent">Excellent (≥90%)</option>
                                <option value="good">Good (≥60%)</option>
                                <option value="pass">Pass (≥40%)</option>
                                <option value="fail">Fail (&lt;40%)</option>
                            </select>
                        </div>
                    </div>

                    {/* Attempts Table */}
                    {paginatedSessions.length > 0 ? (
                        <div>
                            <div className="table-container">
                                <table>
                                    <thead>
                                        <tr>
                                            <th className="sorting-header" onClick={() => handleSort('roll')}>
                                                Roll Number {sortField === 'roll' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                                            </th>
                                            <th className="sorting-header" onClick={() => handleSort('name')}>
                                                Name {sortField === 'name' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                                            </th>
                                            <th className="sorting-header" onClick={() => handleSort('score')}>
                                                Score % {sortField === 'score' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                                            </th>
                                            <th>Status</th>
                                            <th className="sorting-header" onClick={() => handleSort('warnings')}>
                                                Warnings {sortField === 'warnings' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                                            </th>
                                            <th className="sorting-header" onClick={() => handleSort('tabSwitches')}>
                                                Tab Switches {sortField === 'tabSwitches' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                                            </th>
                                            <th>Time Spent</th>
                                            <th className="sorting-header" onClick={() => handleSort('date')}>
                                                Start Time {sortField === 'date' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                                            </th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {paginatedSessions.map(session => {
                                            const exam = exams.find(e => e.id === session.examId);
                                            const scorePercentage = getSessionPercentage(session, exam);
                                            const totalPoints = exam?.questions?.reduce((sum, q) => sum + (q.points || 0), 0) || 0;

                                            return (
                                                <tr key={session.id}>
                                                    <td style={{ fontWeight: 600, color: 'var(--primary-300)' }}>{session.studentRollNo}</td>
                                                    <td>
                                                        <div>{session.studentName}</div>
                                                        {selectedExam === 'all' && (
                                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                                Exam: {exam?.examName || 'Unknown'}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td>
                                                        {session.status === 'completed' ? (
                                                            <div>
                                                                <span className={`badge ${
                                                                    scorePercentage >= 75 ? 'badge-success' : 
                                                                    scorePercentage >= 40 ? 'badge-warning' : 'badge-error'
                                                                }`}>
                                                                    {scorePercentage}%
                                                                </span>
                                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'var(--space-xs)' }}>
                                                                    ({session.score || 0}/{totalPoints})
                                                                </span>
                                                            </div>
                                                        ) : (
                                                            <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>—</span>
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
                                                    <td style={{ color: (session.warningCount || 0) > 0 ? 'var(--error)' : 'var(--text-secondary)' }}>
                                                        {session.warningCount || 0}
                                                    </td>
                                                    <td style={{ color: (session.tabSwitchCount || 0) > 0 ? 'var(--warning)' : 'var(--text-secondary)' }}>
                                                        {session.tabSwitchCount || 0}
                                                    </td>
                                                    <td>{formatTimeSpent(session)}</td>
                                                    <td style={{ fontSize: '0.85rem' }}>{formatDate(session.startTime)}</td>
                                                    <td>
                                                        <button 
                                                            className="btn btn-secondary" 
                                                            style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }} 
                                                            onClick={() => setSelectedSession(session)}
                                                        >
                                                            View Details
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            
                            {/* Pagination Controls */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-lg)', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
                                <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                                    Showing {Math.min(processedSessions.length, (currentPage - 1) * pageSize + 1)} - {Math.min(processedSessions.length, currentPage * pageSize)} of {processedSessions.length} attempts
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
                            <p>No student attempts match the search or filter criteria.</p>
                        </div>
                    )}
                </div>
            )}

            {/* TAB CONTENT: QUESTION ANALYSIS (Exam specific) */}
            {activeTab === 'questions' && selectedExam !== 'all' && (
                <div>
                    {/* Highlight Info Cards */}
                    <div className="grid grid-2 mb-xl">
                        {hardestQuestion && (
                            <div className="stat-card" style={{ borderLeft: '4px solid var(--error)' }}>
                                <div className="stat-icon error">🔥</div>
                                <div className="stat-content" style={{ width: '100%' }}>
                                    <div className="stat-value" style={{ color: 'var(--error)' }}>{hardestQuestion.successRate}%</div>
                                    <div className="stat-label">Hardest Question (Q{hardestQuestion.index})</div>
                                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 'var(--space-xs) 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '340px' }}>
                                        "{hardestQuestion.text}"
                                    </p>
                                </div>
                            </div>
                        )}
                        {easiestQuestion && (
                            <div className="stat-card" style={{ borderLeft: '4px solid var(--accent-emerald)' }}>
                                <div className="stat-icon success">🌟</div>
                                <div className="stat-content" style={{ width: '100%' }}>
                                    <div className="stat-value" style={{ color: 'var(--success)' }}>{easiestQuestion.successRate}%</div>
                                    <div className="stat-label">Easiest Question (Q{easiestQuestion.index})</div>
                                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 'var(--space-xs) 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '340px' }}>
                                        "{easiestQuestion.text}"
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Question Accordion List */}
                    <div className="card">
                        <div className="card-header" style={{ marginBottom: 'var(--space-md)' }}>
                            <h3 className="card-title">📚 Question Performance Directory</h3>
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                                Breakdown based on {stats.completed} completed student submissions. Click a question card to toggle choices.
                            </p>
                        </div>
                        
                        {questionStats.length > 0 ? (
                            <div>
                                {questionStats.map((q) => {
                                    const isExpanded = expandedQuestionId === q.id;
                                    const successColor = q.successRate >= 75 
                                        ? 'var(--success)' 
                                        : q.successRate >= 40 ? 'var(--warning)' : 'var(--error)';

                                    return (
                                        <div key={q.id}>
                                            <div 
                                                className="accordion-header" 
                                                style={{ borderLeft: `4px solid ${successColor}` }}
                                                onClick={() => setExpandedQuestionId(isExpanded ? null : q.id)}
                                            >
                                                <div style={{ flex: 1, paddingRight: 'var(--space-md)' }}>
                                                    <span style={{ fontWeight: 600, color: 'var(--primary-300)', marginRight: 'var(--space-sm)' }}>
                                                        Q{q.index}.
                                                    </span>
                                                    <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                                                        {q.text}
                                                    </span>
                                                </div>
                                                <div className="flex gap-md" style={{ alignItems: 'center' }}>
                                                    <span className="badge" style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-secondary)' }}>
                                                        {q.points} pts
                                                    </span>
                                                    <span className="badge" style={{ background: `rgba(from ${successColor} r g b / 0.15)`, color: successColor, fontWeight: 600 }}>
                                                        {q.successRate}% Success
                                                    </span>
                                                    <span style={{ color: 'var(--text-muted)', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform var(--transition-fast)' }}>
                                                        ▶
                                                    </span>
                                                </div>
                                            </div>
                                            
                                            {isExpanded && (
                                                <div className="accordion-content">
                                                    {/* Success Rate Stats */}
                                                    <div className="grid grid-3 mb-md" style={{ background: 'var(--bg-surface)', padding: 'var(--space-sm)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                                                        <div className="text-center">
                                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Success Rate</div>
                                                            <div style={{ fontWeight: 600, color: successColor }}>{q.successRate}%</div>
                                                        </div>
                                                        <div className="text-center">
                                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Correct Attempts</div>
                                                            <div style={{ fontWeight: 600 }}>{q.correctCount} / {q.completedCount}</div>
                                                        </div>
                                                        <div className="text-center">
                                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Question Type</div>
                                                            <div style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.8rem' }}>{q.type.replace('_', ' ')}</div>
                                                        </div>
                                                    </div>

                                                    {/* Options */}
                                                    {q.options && q.options.length > 0 ? (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
                                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Choices:</div>
                                                            {q.options.map((opt, oIdx) => {
                                                                const isCorrect = q.correctAnswer === oIdx || q.correctAnswer === String(oIdx) || q.correctAnswer === opt;
                                                                return (
                                                                    <div 
                                                                        key={oIdx} 
                                                                        style={{ 
                                                                            padding: 'var(--space-sm)', 
                                                                            borderRadius: 'var(--radius-sm)', 
                                                                            background: isCorrect ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                                                                            border: `1px solid ${isCorrect ? 'rgba(16, 185, 129, 0.3)' : 'var(--border-color)'}`,
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            fontSize: '0.875rem'
                                                                        }}
                                                                    >
                                                                        <span style={{ 
                                                                            width: '20px', 
                                                                            height: '20px', 
                                                                            borderRadius: '50%', 
                                                                            background: isCorrect ? 'var(--success)' : 'var(--bg-dark)', 
                                                                            color: isCorrect ? 'var(--text-inverse)' : 'var(--text-muted)',
                                                                            display: 'inline-flex',
                                                                            alignItems: 'center',
                                                                            justifyContent: 'center',
                                                                            marginRight: 'var(--space-sm)',
                                                                            fontSize: '0.75rem',
                                                                            fontWeight: 600
                                                                        }}>
                                                                            {String.fromCharCode(65 + oIdx)}
                                                                        </span>
                                                                        <span style={{ color: isCorrect ? 'var(--success)' : 'var(--text-primary)', fontWeight: isCorrect ? 600 : 400 }}>{opt}</span>
                                                                        {isCorrect && <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600 }}>CORRECT OPTION</span>}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    ) : (
                                                        <div>
                                                            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Correct Answer:</span>
                                                            <div style={{ 
                                                                padding: 'var(--space-sm)', 
                                                                borderRadius: 'var(--radius-sm)', 
                                                                background: 'rgba(16, 185, 129, 0.08)',
                                                                border: '1px solid rgba(16, 185, 129, 0.3)',
                                                                marginTop: '4px',
                                                                fontWeight: 600,
                                                                color: 'var(--success)',
                                                                fontSize: '0.875rem'
                                                            }}>
                                                                {q.correctAnswer}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
                                <p>No questions found in this exam</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* TAB CONTENT: EXAM COMPARATIVE MATRIX */}
            {activeTab === 'matrix' && selectedExam === 'all' && (
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">🛡️ Exam Comparative Matrix</h3>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                            Side-by-side performance, compliance, and integrity metrics for all active exams.
                        </p>
                    </div>
                    {exams.length > 0 ? (
                        <div className="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Exam Roster</th>
                                        <th>Total Attempts</th>
                                        <th>Completed</th>
                                        <th>Avg Score</th>
                                        <th>Warnings Logged</th>
                                        <th>Terminations</th>
                                        <th>Integrity Rating</th>
                                        <th>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {exams.map(exam => {
                                        const examSessions = sessions.filter(x => x.examId === exam.id);
                                        const comp = examSessions.filter(x => x.status === 'completed').length;
                                        const term = examSessions.filter(x => x.status === 'terminated').length;
                                        const avgScore = getAvgScorePercentage(examSessions);
                                        const totalWarns = examSessions.reduce((s, x) => s + (x.warningCount || 0), 0);
                                        
                                        // Calculate compliance percentage
                                        const cleanCount = examSessions.filter(s => 
                                            (s.warningCount || 0) === 0 && 
                                            (s.tabSwitchCount || 0) === 0 && 
                                            s.status !== 'terminated'
                                        ).length;
                                        const integrityPct = examSessions.length > 0 
                                            ? Math.round((cleanCount / examSessions.length) * 100) 
                                            : 100;

                                        return (
                                            <tr key={exam.id}>
                                                <td style={{ fontWeight: 600 }}>{exam.examName}</td>
                                                <td>{examSessions.length}</td>
                                                <td>{comp}</td>
                                                <td>
                                                    <span className={`badge ${avgScore >= 75 ? 'badge-success' : avgScore >= 40 ? 'badge-warning' : 'badge-error'}`}>
                                                        {avgScore}%
                                                    </span>
                                                </td>
                                                <td style={{ color: totalWarns > 0 ? 'var(--error)' : 'var(--text-secondary)' }}>{totalWarns}</td>
                                                <td style={{ color: term > 0 ? 'var(--error)' : 'var(--text-secondary)' }}>{term}</td>
                                                <td>
                                                    <div className="flex gap-xs" style={{ alignItems: 'center' }}>
                                                        <span style={{ fontWeight: 600, color: integrityPct >= 80 ? 'var(--success)' : integrityPct >= 50 ? 'var(--warning)' : 'var(--error)' }}>
                                                            {integrityPct}%
                                                        </span>
                                                        <div style={{ width: '60px', height: '5px', background: 'var(--bg-dark)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
                                                            <div style={{ width: `${integrityPct}%`, height: '100%', background: integrityPct >= 80 ? 'var(--success)' : integrityPct >= 50 ? 'var(--warning)' : 'var(--error)', borderRadius: 'var(--radius-full)' }} />
                                                        </div>
                                                    </div>
                                                </td>
                                                <td>
                                                    <button 
                                                        className="btn btn-secondary" 
                                                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }} 
                                                        onClick={() => { setSelectedExam(exam.id); setActiveTab('overview'); }}
                                                    >
                                                        Analyze
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
                            <p>No exams available to compare.</p>
                        </div>
                    )}
                </div>
            )}

            {/* DETAILED STUDENT ATTEMPT MODAL (SLIDE-IN DRAWER) */}
            {selectedSession && (
                <div className="modal-overlay" onClick={() => setSelectedSession(null)}>
                    <div className="modal-drawer" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <h3 style={{ fontSize: '1.25rem', marginBottom: '2px' }}>Student Attempt Record</h3>
                                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                                    Roll No: <span style={{ color: 'var(--primary-300)', fontWeight: 600 }}>{selectedSession.studentRollNo}</span>
                                </p>
                            </div>
                            <button className="modal-close-btn" onClick={() => setSelectedSession(null)}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>
                        
                        <div className="modal-body">
                            {/* Profile Info Summary Card */}
                            <div className="card mb-lg" style={{ background: 'var(--bg-surface)' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)', fontSize: '0.875rem' }}>
                                    <div>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', display: 'block' }}>STUDENT NAME</span>
                                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{selectedSession.studentName}</span>
                                    </div>
                                    <div>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', display: 'block' }}>SESSION STATUS</span>
                                        <span className={`badge ${
                                            selectedSession.status === 'completed' ? 'badge-success' : 
                                            selectedSession.status === 'started' ? 'badge-warning' : 'badge-error'
                                        }`} style={{ display: 'inline-block', marginTop: '2px' }}>
                                            {selectedSession.status.toUpperCase()}
                                        </span>
                                    </div>
                                    <div>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', display: 'block' }}>SCORE PERCENTAGE</span>
                                        <span style={{ fontWeight: 600 }}>
                                            {selectedSession.status === 'completed' 
                                                ? `${getSessionPercentage(selectedSession, inspectedExam || undefined)}%` 
                                                : '—'}
                                        </span>
                                    </div>
                                    <div>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', display: 'block' }}>TIME SPENT</span>
                                        <span style={{ fontWeight: 600 }}>{formatTimeSpent(selectedSession)}</span>
                                    </div>
                                    <div>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', display: 'block' }}>EMAIL</span>
                                        <span>{selectedSession.studentEmail || 'N/A'}</span>
                                    </div>
                                    <div>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', display: 'block' }}>PHONE</span>
                                        <span>{selectedSession.studentPhone || 'N/A'}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Device & Location details */}
                            <div className="card mb-lg" style={{ background: 'var(--bg-surface)' }}>
                                <h4 style={{ fontSize: '0.95rem', marginBottom: 'var(--space-md)', borderBottom: '1px solid var(--border-color)', paddingBottom: 'var(--space-xs)' }}>
                                    💻 Device & Connection Details
                                </h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)', fontSize: '0.85rem' }}>
                                    <div>
                                        <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>DEVICE</span>
                                        <span>{selectedSession.deviceInfo ? formatDeviceName(selectedSession.deviceInfo) : 'N/A'}</span>
                                    </div>
                                    <div>
                                        <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>IP ADDRESS</span>
                                        <span>{selectedSession.ipAddress || 'Unknown'}</span>
                                    </div>
                                    <div>
                                        <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>SCREEN SIZE</span>
                                        <span>
                                            {selectedSession.deviceInfo?.screenWidth && selectedSession.deviceInfo?.screenHeight 
                                                ? `${selectedSession.deviceInfo.screenWidth} × ${selectedSession.deviceInfo.screenHeight}` 
                                                : 'N/A'}
                                        </span>
                                    </div>
                                    <div>
                                        <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.75rem' }}>GEOLOCATION</span>
                                        {selectedSession.startLocation ? (
                                            <a 
                                                href={`https://google.com/maps?q=${selectedSession.startLocation.latitude},${selectedSession.startLocation.longitude}`}
                                                target="_blank" 
                                                rel="noreferrer"
                                                style={{ color: 'var(--accent-cyan)', textDecoration: 'underline' }}
                                            >
                                                View on Google Maps &rarr;
                                            </a>
                                        ) : 'Not recorded'}
                                    </div>
                                </div>
                            </div>

                            {/* Answer response logger */}
                            <div className="mb-lg">
                                <h4 style={{ fontSize: '0.95rem', marginBottom: 'var(--space-md)' }}>
                                    📝 Submission Response Sheet
                                </h4>
                                
                                {inspectedExam && inspectedExam.questions && inspectedExam.questions.length > 0 ? (
                                    inspectedExam.questions.map((q, idx) => {
                                        const givenAns = selectedSession.answers?.find(a => a.questionId === q.id);
                                        const isAnswered = !!givenAns;
                                        
                                        const isCorrect = isAnswered && (
                                            givenAns.answer === q.correctAnswer ||
                                            String(givenAns.answer) === String(q.correctAnswer) ||
                                            (q.options && q.options[Number(givenAns.answer)] === q.correctAnswer)
                                        );

                                        let statusClass = 'unanswered';
                                        if (isAnswered) {
                                            statusClass = isCorrect ? 'correct' : 'incorrect';
                                        }

                                        return (
                                            <div key={q.id} className={`question-detail-card ${statusClass}`}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 'var(--space-xs)' }}>
                                                    <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Question {idx + 1}</span>
                                                    <span style={{ 
                                                        fontWeight: 600, 
                                                        color: isCorrect ? 'var(--success)' : isAnswered ? 'var(--error)' : 'var(--text-muted)' 
                                                    }}>
                                                        {isCorrect ? `+${q.points} Points` : isAnswered ? '0 Points' : 'Unanswered'}
                                                    </span>
                                                </div>
                                                
                                                <p style={{ color: 'var(--text-primary)', fontSize: '0.9rem', marginBottom: 'var(--space-sm)', fontWeight: 500 }}>
                                                    {q.text}
                                                </p>
                                                
                                                <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap', fontSize: '0.8rem' }}>
                                                    <div style={{ flex: 1, minWidth: '180px' }}>
                                                        <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>STUDENT RESPONSE</span>
                                                        <span style={{ 
                                                            color: isCorrect ? 'var(--success)' : isAnswered ? 'var(--error)' : 'var(--text-muted)', 
                                                            fontWeight: 600 
                                                        }}>
                                                            {isAnswered ? String(givenAns.answer) : 'No attempt'}
                                                        </span>
                                                    </div>
                                                    <div style={{ flex: 1, minWidth: '180px' }}>
                                                        <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>CORRECT ANSWER</span>
                                                        <span style={{ color: 'var(--success)', fontWeight: 600 }}>{String(q.correctAnswer)}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div className="empty-state" style={{ padding: 'var(--space-md)' }}>
                                        <p>Questions data unavailable for this exam session.</p>
                                    </div>
                                )}
                            </div>

                            {/* Integrity timeline log */}
                            <div>
                                <h4 style={{ fontSize: '0.95rem', marginBottom: 'var(--space-sm)' }}>
                                    ⚠️ Compliance & Security Timeline
                                </h4>
                                
                                {selectedSession.cheatingEvents && selectedSession.cheatingEvents.length > 0 ? (
                                    <div className="timeline">
                                        {selectedSession.cheatingEvents.map((evt, idx) => {
                                            const timeRel = evt.timestamp 
                                                ? formatDate(evt.timestamp)
                                                : 'N/A';
                                            return (
                                                <div key={idx} className="timeline-item">
                                                    <div className={`timeline-dot ${evt.severity || 'low'}`} />
                                                    <div className="timeline-time">{timeRel}</div>
                                                    <div className="timeline-content">
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                                                            <span style={{ fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-primary)', fontSize: '0.75rem' }}>
                                                                {evt.type?.replace('_', ' ') || 'Security Warning'}
                                                            </span>
                                                            <span className={`badge badge-${
                                                                evt.severity === 'high' ? 'error' : 
                                                                evt.severity === 'medium' ? 'warning' : 'info'
                                                            }`} style={{ fontSize: '0.65rem', padding: '1px 4px' }}>
                                                                {evt.severity?.toUpperCase() || 'LOW'}
                                                            </span>
                                                        </div>
                                                        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                                                            {evt.details || 'Warning triggered by anomaly detection.'}
                                                        </p>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div style={{ padding: 'var(--space-md)', textAlign: 'center', background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.15)', borderRadius: 'var(--radius-md)' }}>
                                        <p style={{ margin: 0, color: 'var(--success)', fontSize: '0.875rem' }}>
                                            🛡️ Student maintained complete exam focus. No anomalies detected.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
