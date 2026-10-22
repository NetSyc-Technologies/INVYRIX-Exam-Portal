import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getDoc, updateDoc, query, where, getDocs } from 'firebase/firestore';
import { doc, collection } from '../../services/tenant';
import { db } from '../../services/firebase';
import { Exam, Question, ExamSettings } from '../../types';
import GeofenceMap from '../../components/GeofenceMap';
import { hashAnswer, hashExamPassword } from '../../services/platform';

export default function ExamEdit() {
    const { examId } = useParams<{ examId: string }>();
    const navigate = useNavigate();

    const [exam, setExam] = useState<Exam | null>(null);
    const [examName, setExamName] = useState('');
    const [examPassword, setExamPassword] = useState('');
    const [existingPasswordHash, setExistingPasswordHash] = useState('');
    const [duration, setDuration] = useState(60);
    const [settings, setSettings] = useState<ExamSettings>({
        allowReview: true,
        showResults: true,
        maxAttempts: 1,
        shuffleQuestions: false,
        shuffleOptions: false,
        requireRollNo: true,
        requireName: true,
        requirePhone: false,
        requireEmail: false,
        maxWarnings: 2,
        deviceRestriction: 'both',
        lateEntryPolicy: 'allow',
        cameraAntiCheat: false,
        mobileLocking: false
    });
    const [questions, setQuestions] = useState<Question[]>([]);

    // Faculty assignment state
    const [facultyList, setFacultyList] = useState<{ id: string, name: string, email: string }[]>([]);
    const [assignedFaculty, setAssignedFaculty] = useState<string[]>([]);

    // Roll list state for allowed students
    const [allowedStudents, setAllowedStudents] = useState<{ rollNo: string; name: string }[]>([]);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [showQuestionModal, setShowQuestionModal] = useState(false);
    const [scheduledDate, setScheduledDate] = useState('');
    const [scheduledTime, setScheduledTime] = useState('');
    const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
    const [currentQuestion, setCurrentQuestion] = useState<Partial<Question>>({
        type: 'mcq',
        options: ['', '', '', ''],
        points: 1
    });

    useEffect(() => {
        const fetchExamAndFaculty = async () => {
            if (!examId) return;

            try {
                setLoading(true);
                // Fetch Exam
                const examDoc = await getDoc(doc(db, 'exams', examId));
                if (examDoc.exists()) {
                    const examData = { id: examDoc.id, ...examDoc.data() } as Exam;
                    setExam(examData);
                    setExamName(examData.examName);
                    setExamPassword(examData.examPassword || '');
                    setExistingPasswordHash(examData.examPasswordHash || '');
                    setDuration(examData.duration);
                    const examSettings = examData.settings || {};
                    setSettings({
                        ...settings,
                        ...examSettings,
                        requireRollNo: examSettings.requireRollNo ?? true,
                        requireName: examSettings.requireName ?? true,
                        maxWarnings: examSettings.maxWarnings ?? 2,
                        deviceRestriction: examSettings.deviceRestriction ?? 'both',
                        lateEntryPolicy: examSettings.lateEntryPolicy ?? 'allow',
                        cameraAntiCheat: examSettings.cameraAntiCheat ?? false,
                        mobileLocking: examSettings.mobileLocking ?? false,
                        geofence: examSettings.geofence || undefined
                    });

                    if (examSettings.schedulingEnabled && examSettings.scheduledStartTime) {
                        const start = examSettings.scheduledStartTime.toDate 
                            ? examSettings.scheduledStartTime.toDate() 
                            : new Date(examSettings.scheduledStartTime);
                        const yyyy = start.getFullYear();
                        const mm = String(start.getMonth() + 1).padStart(2, '0');
                        const dd = String(start.getDate()).padStart(2, '0');
                        setScheduledDate(`${yyyy}-${mm}-${dd}`);

                        const hh = String(start.getHours()).padStart(2, '0');
                        const min = String(start.getMinutes()).padStart(2, '0');
                        const ss = String(start.getSeconds()).padStart(2, '0');
                        setScheduledTime(`${hh}:${min}:${ss}`);
                    }
                    setQuestions(examData.questions || []);
                    setAssignedFaculty(examData.assignedFaculty || []);
                    setAllowedStudents(examData.allowedStudents || []);
                } else {
                    setError('Exam not found');
                }

                // Fetch Faculty from admin_users collection where role is 'faculty'
                const q = query(collection(db, 'admin_users'), where('role', '==', 'faculty'));
                const snapshot = await getDocs(q);
                const faculty = snapshot.docs.map(doc => ({
                    id: doc.id,
                    name: doc.data().name as string,
                    email: doc.data().email as string
                }));
                setFacultyList(faculty);

            } catch (err) {
                console.error('Error fetching data:', err);
                setError('Failed to load exam data');
            } finally {
                setLoading(false);
            }
        };

        fetchExamAndFaculty();
    }, [examId]);

    const handleAddQuestion = () => {
        if (!currentQuestion.text?.trim()) {
            setError('Question text is required');
            return;
        }

        const newQuestion: Question = {
            id: `q_${Date.now()}`,
            text: currentQuestion.text!,
            type: currentQuestion.type || 'mcq',
            options: currentQuestion.options?.filter((o: string) => o.trim()) || [],
            correctAnswer: currentQuestion.correctAnswer!,
            points: currentQuestion.points || 1
        };

        if (editingQuestionId) {
            setQuestions(prev => prev.map((q: Question) => q.id === editingQuestionId ? newQuestion : q));
        } else {
            setQuestions(prev => [...prev, newQuestion]);
        }
        setCurrentQuestion({ type: 'mcq', options: ['', '', '', ''], points: 1 });
        setEditingQuestionId(null);
        setShowQuestionModal(false);
        setError('');
    };

    const handleEditQuestion = (question: Question) => {
        setCurrentQuestion(question);
        setEditingQuestionId(question.id);
        setShowQuestionModal(true);
    };

    const handleRemoveQuestion = (id: string) => {
        setQuestions(prev => prev.filter((q: Question) => q.id !== id));
    };


    // Parse CSV properly handling quoted fields
    const parseCSVLine = (line: string): string[] => {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    // Escaped quote
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim());
        return result;
    };

    const downloadCSVTemplate = () => {
        const template = `type,question,option1,option2,option3,option4,correctAnswer,points
mcq,"What is the capital of France?","London","Berlin","Paris","Madrid",2,1
mcq,"Which programming language is used for web development?","Python","JavaScript","C++","Java",1,2
true_false,"The Earth is flat.",false,,,,false,1
true_false,"Water boils at 100 degrees Celsius at sea level.",true,,,,true,1
short_answer,"What is the chemical symbol for water?",H2O,,,,,2`;

        const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'exam_questions_template.csv';
        link.click();
        URL.revokeObjectURL(link.href);
    };

    const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target?.result as string;
            const lines = text.split('\n');

            // Skip header row
            const dataLines = lines.slice(1).filter(line => line.trim());

            const parsedQuestions: Question[] = [];
            let parseErrors: string[] = [];

            dataLines.forEach((line, index) => {
                try {
                    const parts = parseCSVLine(line);
                    // Format: type,question,option1,option2,option3,option4,correctAnswer,points

                    if (parts.length < 3) {
                        parseErrors.push(`Row ${index + 2}: Not enough columns`);
                        return;
                    }

                    const questionType = (parts[0]?.toLowerCase() || 'mcq') as Question['type'];
                    const questionText = parts[1];

                    if (!questionText) {
                        parseErrors.push(`Row ${index + 2}: Missing question text`);
                        return;
                    }

                    let question: Question;

                    if (questionType === 'mcq') {
                        const options = [parts[2], parts[3], parts[4], parts[5]].filter(o => o && o.trim());
                        const correctAnswerRaw = parts[6];
                        let correctAnswer: number;

                        if (!isNaN(parseInt(correctAnswerRaw))) {
                            correctAnswer = parseInt(correctAnswerRaw);
                        } else {
                            correctAnswer = options.findIndex(o =>
                                o.toLowerCase().trim() === correctAnswerRaw?.toLowerCase().trim()
                            );
                            if (correctAnswer === -1) correctAnswer = 0;
                        }

                        question = {
                            id: `q_csv_${Date.now()}_${index}`,
                            text: questionText,
                            type: 'mcq',
                            options,
                            correctAnswer,
                            points: parseInt(parts[7]) || 1
                        };
                    } else if (questionType === 'true_false') {
                        const correctAnswer = parts[6]?.toLowerCase() === 'true' || parts[2]?.toLowerCase() === 'true' ? 'true' : 'false';
                        question = {
                            id: `q_csv_${Date.now()}_${index}`,
                            text: questionText,
                            type: 'true_false',
                            options: [],
                            correctAnswer,
                            points: parseInt(parts[7]) || 1
                        };
                    } else {
                        question = {
                            id: `q_csv_${Date.now()}_${index}`,
                            text: questionText,
                            type: 'short_answer',
                            options: [],
                            correctAnswer: parts[2] || '',
                            points: parseInt(parts[7]) || 1
                        };
                    }

                    parsedQuestions.push(question);
                } catch (err) {
                    parseErrors.push(`Row ${index + 2}: Parse error`);
                }
            });

            if (parsedQuestions.length > 0) {
                setQuestions(prev => [...prev, ...parsedQuestions]);
                if (parseErrors.length > 0) {
                    setError(`Imported ${parsedQuestions.length} questions. ${parseErrors.length} rows had errors.`);
                } else {
                    setError('');
                }
                alert(`Successfully imported ${parsedQuestions.length} questions!`);
            } else if (parseErrors.length > 0) {
                setError(`Failed to parse CSV: ${parseErrors.slice(0, 3).join('; ')}`);
            } else {
                setError('No valid questions found in CSV file.');
            }
        };
        reader.readAsText(file);
        e.target.value = ''; // Reset input
    };

    const downloadQuestionsCSV = () => {
        if (questions.length === 0) {
            alert('No questions available to download.');
            return;
        }

        const escapeCSVField = (field: any) => {
            if (field === null || field === undefined) return '';
            const str = String(field);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const headers = ['type', 'question', 'option1', 'option2', 'option3', 'option4', 'correctAnswer', 'points'];
        const rows = questions.map(q => {
            const type = q.type || 'mcq';
            const text = escapeCSVField(q.text);
            const p = q.points || 1;
            
            if (type === 'mcq') {
                const opt1 = escapeCSVField(q.options?.[0]);
                const opt2 = escapeCSVField(q.options?.[1]);
                const opt3 = escapeCSVField(q.options?.[2]);
                const opt4 = escapeCSVField(q.options?.[3]);
                const correct = q.correctAnswer;
                return [type, text, opt1, opt2, opt3, opt4, correct, p].join(',');
            } else if (type === 'true_false') {
                const correct = escapeCSVField(q.correctAnswer);
                return [type, text, '', '', '', '', correct, p].join(',');
            } else {
                const correct = escapeCSVField(q.correctAnswer);
                return [type, text, '', '', '', '', correct, p].join(',');
            }
        });

        const csvContent = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${examName.trim() || 'exam'}_questions.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
    };

    const handleSave = async () => {
        if (!examId || !examName.trim() || (!examPassword.trim() && !existingPasswordHash)) {
            setError('Please fill in all required fields');
            return;
        }

        setSaving(true);
        setError('');

        try {
            let finalSettings = { ...settings };
            if (finalSettings.schedulingEnabled) {
                if (!scheduledDate || !scheduledTime) {
                    setError('Start Date and Start Time are required when scheduling is enabled');
                    setSaving(false);
                    return;
                }
                const start = new Date(`${scheduledDate}T${scheduledTime}`);
                const end = new Date(start.getTime() + duration * 60 * 1000);
                finalSettings.scheduledStartTime = start;
                finalSettings.scheduledEndTime = end;
            } else {
                delete finalSettings.scheduledStartTime;
                delete finalSettings.scheduledEndTime;
            }

            // Remove any undefined properties to prevent Firestore write errors
            const cleanedSettings: any = {};
            Object.entries(finalSettings).forEach(([key, val]) => {
                if (val !== undefined) {
                    cleanedSettings[key] = val;
                }
            });

            const protectedQuestions = await Promise.all(questions.map(async question => {
                const { correctAnswer, answerKeyHash, ...publicQuestion } = question;
                return { ...publicQuestion, answerKeyHash: correctAnswer === undefined ? answerKeyHash : await hashAnswer(question.id, correctAnswer) };
            }));
            await updateDoc(doc(db, 'exams', examId), {
                examName: examName.trim(),
                examPasswordHash: examPassword.trim() ? await hashExamPassword(examPassword.trim()) : existingPasswordHash,
                duration,
                settings: cleanedSettings,
                questions: protectedQuestions,
                assignedFaculty,
                allowedStudents: allowedStudents.length > 0 ? allowedStudents : []
            });

            navigate('/admin/dashboard/exams');
        } catch (err) {
            console.error('Error updating exam:', err);
            setError('Failed to update exam');
        } finally {
            setSaving(false);
        }
    };

    const calculateEndTimeString = () => {
        if (!scheduledDate || !scheduledTime) return '';
        try {
            const start = new Date(`${scheduledDate}T${scheduledTime}`);
            const end = new Date(start.getTime() + duration * 60 * 1000);
            return end.toLocaleString();
        } catch (e) {
            return '';
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center" style={{ minHeight: '50vh' }}>
                <div className="spinner"></div>
            </div>
        );
    }

    if (!exam) {
        return (
            <div className="card">
                <div className="empty-state">
                    <div className="empty-state-icon">❓</div>
                    <p className="empty-state-title">Exam not found</p>
                    <button className="btn btn-primary" onClick={() => navigate('/admin/dashboard/exams')}>
                        Back to Exams
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div>
            <div className="page-header flex justify-between items-center">
                <div>
                    <h1 className="page-title">Edit Exam</h1>
                    <p className="page-subtitle">Modify exam settings and questions</p>
                </div>
                <span className={`badge badge-${exam.status === 'active' ? 'success' :
                    exam.status === 'draft' ? 'warning' : 'info'
                    }`}>
                    {exam.status}
                </span>
            </div>

            {error && (
                <div className="alert alert-error mb-lg">
                    <span>⚠️</span>
                    <span>{error}</span>
                </div>
            )}

            <div className="grid grid-2 mb-xl">
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">📋 Basic Information</h3>
                    </div>
                    <div className="card-body">
                        <div className="input-group">
                            <label className="input-label required">Exam Name</label>
                            <input
                                type="text"
                                className="input"
                                value={examName}
                                onChange={(e) => setExamName(e.target.value)}
                            />
                        </div>

                        <div className="input-group">
                            <label className="input-label required">Exam Password</label>
                            <input
                                type="text"
                                className="input"
                                value={examPassword}
                                onChange={(e) => setExamPassword(e.target.value)}
                            />
                        </div>

                        <div className="input-group">
                            <label className="input-label required">Duration (minutes)</label>
                            <input
                                type="number"
                                className="input"
                                min={5}
                                max={300}
                                value={duration}
                                onChange={(e) => setDuration(parseInt(e.target.value) || 60)}
                            />
                        </div>
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">⚙️ Settings</h3>
                    </div>
                    <div className="card-body">
                        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={settings.allowReview}
                                onChange={(e) => setSettings(prev => ({ ...prev, allowReview: e.target.checked }))}
                            />
                            <span>Allow review before submit</span>
                        </label>

                        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={settings.showResults}
                                onChange={(e) => setSettings(prev => ({ ...prev, showResults: e.target.checked }))}
                            />
                            <span>Show results after submission</span>
                        </label>

                        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={settings.shuffleQuestions}
                                onChange={(e) => setSettings(prev => ({ ...prev, shuffleQuestions: e.target.checked }))}
                            />
                            <span>Shuffle questions</span>
                        </label>

                        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={settings.shuffleOptions}
                                onChange={(e) => setSettings(prev => ({ ...prev, shuffleOptions: e.target.checked }))}
                            />
                            <span>Shuffle MCQ options</span>
                        </label>

                        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={settings.cameraAntiCheat ?? false}
                                onChange={(e) => setSettings(prev => ({ ...prev, cameraAntiCheat: e.target.checked }))}
                            />
                            <span style={{ fontWeight: 600, color: 'var(--primary-500)' }}>📷 Enable Camera Anti-Cheat (Surveillance, Gaze & movement tracking)</span>
                        </label>

                        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={settings.mobileLocking ?? false}
                                onChange={(e) => setSettings(prev => ({ ...prev, mobileLocking: e.target.checked, mobileLockReengageLimit: e.target.checked ? (prev.mobileLockReengageLimit || 30) : undefined }))}
                            />
                            <span style={{ fontWeight: 600, color: 'var(--primary-500)' }}>📱 Enable Mobile Phone Security Locking (Requires secondary phone lock)</span>
                        </label>

                        {settings.mobileLocking && (
                            <div style={{ marginLeft: 'var(--space-lg)', marginTop: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
                                <div className="input-group" style={{ marginBottom: 'var(--space-md)' }}>
                                    <label className="input-label" style={{ fontWeight: 600 }}>Mobile Lock Re-engage Limit (seconds)</label>
                                    <input
                                        type="number"
                                        className="input"
                                        min={10}
                                        max={600}
                                        value={settings.mobileLockReengageLimit ?? 30}
                                        onChange={(e) => setSettings(prev => ({ ...prev, mobileLockReengageLimit: parseInt(e.target.value) || 30 }))}
                                    />
                                    <small className="text-muted" style={{ display: 'block', marginTop: '4px' }}>Time in seconds the student has to relock their mobile phone before the exam is terminated (Default: 30s)</small>
                                </div>

                                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer', marginTop: 'var(--space-md)' }}>
                                    <input
                                        type="checkbox"
                                        checked={settings.mobileCameraAntiCheat ?? false}
                                        onChange={(e) => setSettings(prev => ({ 
                                            ...prev, 
                                            mobileCameraAntiCheat: e.target.checked,
                                            mobileCameraSource: e.target.checked ? (prev.mobileCameraSource || 'front') : undefined
                                        }))}
                                    />
                                    <span style={{ fontWeight: 600, color: 'var(--primary-400)' }}>📷 Enable Secondary Mobile Camera Anti-Cheat (Face Tracking on Phone)</span>
                                </label>

                                {settings.mobileCameraAntiCheat && (
                                    <div style={{ marginLeft: 'var(--space-lg)', marginTop: 'var(--space-sm)' }}>
                                        <div className="input-group" style={{ marginBottom: 'var(--space-md)' }}>
                                            <label className="input-label">Select Mobile Camera Lens</label>
                                            <select
                                                className="input"
                                                value={settings.mobileCameraSource ?? 'front'}
                                                onChange={(e) => setSettings(prev => ({ ...prev, mobileCameraSource: e.target.value as 'front' | 'rear' }))}
                                                style={{ width: '100%' }}
                                            >
                                                <option value="front">Front Camera (Selfie/Face Lens)</option>
                                                <option value="rear">Rear Camera (Back Lens)</option>
                                            </select>
                                            <small className="text-muted" style={{ display: 'block', marginTop: '4px' }}>The camera to be activated on the secondary mobile device for face monitoring.</small>
                                        </div>

                                        <div className="input-group">
                                            <label className="input-label" style={{ fontWeight: 600 }}>Face Positioning Grace Period (seconds)</label>
                                            <input
                                                type="number"
                                                className="input"
                                                min={5}
                                                max={60}
                                                value={settings.mobileLockGracePeriod ?? 10}
                                                onChange={(e) => setSettings(prev => ({ ...prev, mobileLockGracePeriod: parseInt(e.target.value) || 10 }))}
                                            />
                                            <small className="text-muted" style={{ display: 'block', marginTop: '4px' }}>Time in seconds the student has to position their phone and align their face after re-engaging lock (Default: 10s)</small>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="divider" style={{ margin: 'var(--space-md) 0', borderTop: '1px solid var(--border-color)' }}></div>
                        <h4 style={{ fontSize: '0.875rem', marginBottom: 'var(--space-sm)', color: 'var(--text-secondary)' }}>Student Requirements</h4>

                        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={settings.requireRollNo}
                                onChange={(e) => setSettings(prev => ({ ...prev, requireRollNo: e.target.checked }))}
                            />
                            <span>Require Roll Number</span>
                        </label>

                        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={settings.requireName}
                                onChange={(e) => setSettings(prev => ({ ...prev, requireName: e.target.checked }))}
                            />
                            <span>Require Name</span>
                        </label>

                        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={settings.requirePhone}
                                onChange={(e) => setSettings(prev => ({ ...prev, requirePhone: e.target.checked }))}
                            />
                            <span>Require Phone Number</span>
                        </label>

                        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={settings.requireEmail}
                                onChange={(e) => setSettings(prev => ({ ...prev, requireEmail: e.target.checked }))}
                            />
                            <span>Require Email</span>
                        </label>

                        <div className="input-group" style={{ marginBottom: 'var(--space-md)' }}>
                            <label className="input-label" style={{ fontWeight: 600 }}>Max Warnings Before Termination</label>
                            <input
                                type="number"
                                className="input"
                                min={1}
                                max={100}
                                value={settings.maxWarnings ?? 2}
                                onChange={(e) => setSettings(prev => ({ ...prev, maxWarnings: parseInt(e.target.value) || 2 }))}
                            />
                            <small className="text-muted" style={{ display: 'block', marginTop: '4px' }}>Number of security violations allowed before student is blocked (Default: 2)</small>
                        </div>

                        <div className="input-group" style={{ marginBottom: 0 }}>
                            <label className="input-label" style={{ fontWeight: 600 }}>Device Restriction</label>
                            <select
                                className="input"
                                value={settings.deviceRestriction ?? 'both'}
                                onChange={(e) => setSettings(prev => ({ ...prev, deviceRestriction: e.target.value as any }))}
                            >
                                <option value="both">Both (Mobile & Desktop)</option>
                                <option value="mobile_only">Mobile Only</option>
                                <option value="desktop_only">Desktop Only</option>
                            </select>
                            <small className="text-muted" style={{ display: 'block', marginTop: '4px' }}>Restrict which devices students can use to attempt the exam.</small>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-2 mb-xl">
                {/* Faculty Assignment */}
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">👨‍🏫 Assign Faculty</h3>
                    </div>
                    <div className="card-body">
                        <p className="text-secondary mb-sm">Select faculty members who can monitor and manage this exam.</p>

                        {/* Faculty Dropdown */}
                        <div className="input-group mb-md">
                            <select
                                className="input"
                                value=""
                                onChange={(e) => {
                                    const selectedId = e.target.value;
                                    if (selectedId && !assignedFaculty.includes(selectedId)) {
                                        setAssignedFaculty(prev => [...prev, selectedId]);
                                    }
                                }}
                            >
                                <option value="">-- Select Faculty to Assign --</option>
                                {facultyList
                                    .filter(f => !assignedFaculty.includes(f.id))
                                    .map(faculty => (
                                        <option key={faculty.id} value={faculty.id}>
                                            {faculty.name} ({faculty.email})
                                        </option>
                                    ))}
                            </select>
                        </div>

                        {/* Assigned Faculty Chips */}
                        {assignedFaculty.length > 0 ? (
                            <div className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
                                {assignedFaculty.map(id => {
                                    const faculty = facultyList.find(f => f.id === id);
                                    return (
                                        <div key={id} className="badge badge-info flex items-center gap-xs" style={{ padding: '8px 12px', fontSize: '0.9rem' }}>
                                            <span>{faculty ? faculty.name : 'Unknown Faculty'}</span>
                                            <button
                                                onClick={() => setAssignedFaculty(prev => prev.filter(fid => fid !== id))}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'currentColor', marginLeft: '4px', opacity: 0.7 }}
                                                className="hover:opacity-100"
                                                title="Remove"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="text-muted italic text-sm">No faculty assigned yet.</div>
                        )}
                    </div>
                </div>

                {/* Roll List - Allowed Students */}
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">📋 Roll List (Optional)</h3>
                    </div>
                    <div className="card-body">
                        <p className="text-secondary mb-sm">Upload a CSV with allowed roll numbers. Only listed students can take this exam. Leave empty to allow all students.</p>

                        <div className="flex gap-sm mb-md">
                            <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => {
                                    const template = `rollNo,name\r\n21IT001,John Doe\r\n21IT002,Jane Smith\r\n21IT003,Bob Johnson`;
                                    const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
                                    const link = document.createElement('a');
                                    link.href = URL.createObjectURL(blob);
                                    link.download = 'roll_list_template.csv';
                                    link.click();
                                    URL.revokeObjectURL(link.href);
                                }}
                            >
                                <span>⬇️</span>
                                <span>Download Template</span>
                            </button>
                            <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                                <span>📄</span>
                                <span>Upload Roll List</span>
                                <input
                                    type="file"
                                    accept=".csv"
                                    style={{ display: 'none' }}
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        const reader = new FileReader();
                                        reader.onload = (event) => {
                                            const text = event.target?.result as string;
                                            const lines = text.split('\n');
                                            const dataLines = lines.slice(1).filter(line => line.trim());
                                            const students: { rollNo: string; name: string }[] = [];
                                            dataLines.forEach(line => {
                                                const parts = parseCSVLine(line);
                                                if (parts[0]) {
                                                    students.push({
                                                        rollNo: parts[0].toUpperCase(),
                                                        name: parts[1] || ''
                                                    });
                                                }
                                            });
                                            if (students.length > 0) {
                                                setAllowedStudents(students);
                                                alert(`Successfully imported ${students.length} students!`);
                                            } else {
                                                setError('No valid students found in CSV file.');
                                            }
                                        };
                                        reader.readAsText(file);
                                        e.target.value = '';
                                    }}
                                />
                            </label>
                            {allowedStudents.length > 0 && (
                                <button
                                    type="button"
                                    className="btn btn-danger"
                                    onClick={() => setAllowedStudents([])}
                                >
                                    <span>🗑️</span>
                                    <span>Clear All</span>
                                </button>
                            )}
                        </div>

                        {allowedStudents.length > 0 ? (
                            <div>
                                <p className="text-muted mb-sm" style={{ fontSize: '0.813rem' }}>
                                    {allowedStudents.length} students allowed for this exam:
                                </p>
                                <div className="table-container" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>#</th>
                                                <th>Roll No</th>
                                                <th>Name</th>
                                                <th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {allowedStudents.map((student, index) => (
                                                <tr key={student.rollNo}>
                                                    <td>{index + 1}</td>
                                                    <td>{student.rollNo}</td>
                                                    <td>{student.name || '-'}</td>
                                                    <td>
                                                        <button
                                                            type="button"
                                                            className="btn btn-danger btn-sm"
                                                            onClick={() => setAllowedStudents(prev => prev.filter(s => s.rollNo !== student.rollNo))}
                                                        >
                                                            ✕
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ) : (
                            <div className="text-muted italic text-sm">No roll list uploaded. All students with the correct password can take this exam.</div>
                        )}
                    </div>
                </div>
            </div>

            {/* Geofencing Card */}
            <div className="card mb-xl">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 className="card-title" style={{ margin: 0 }}>📍 Geofence Exam Access</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Disabled</span>
                        <label className="switch" style={{ margin: 0 }}>
                            <input
                                type="checkbox"
                                checked={!!settings.geofence}
                                onChange={(e) => {
                                    if (e.target.checked) {
                                        setSettings(prev => ({
                                            ...prev,
                                            geofence: { type: 'circle', center: { lat: 21.0309, lng: 79.0544 }, radius: 100 }
                                        }));
                                    } else {
                                        setSettings(prev => {
                                            const copy = { ...prev };
                                            delete copy.geofence;
                                            return copy;
                                        });
                                    }
                                }}
                            />
                            <span className="slider"></span>
                        </label>
                        <span style={{ fontSize: '0.85rem', color: !!settings.geofence ? 'var(--primary-500)' : 'var(--text-muted)', fontWeight: 600 }}>Enabled</span>
                    </div>
                </div>
                <div className="card-body">
                    {settings.geofence ? (
                        <>
                            <p className="text-secondary mb-md">Define a restricted physical boundary where students can take this exam. Students must be inside this boundary to start the exam.</p>
                            <GeofenceMap 
                                initialPoints={settings.geofence} 
                                onChange={(config) => setSettings(prev => ({ ...prev, geofence: config }))}
                            />
                        </>
                    ) : (
                        <p className="text-secondary" style={{ margin: 0 }}>Geofencing is currently disabled. Students can start the exam from any location.</p>
                    )}
                </div>
            </div>

            {/* Exam Scheduling Card */}
            <div className="card mb-xl">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 className="card-title" style={{ margin: 0 }}>📅 Exam Scheduling</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Disabled</span>
                        <label className="switch" style={{ margin: 0 }}>
                            <input
                                type="checkbox"
                                checked={settings.schedulingEnabled ?? false}
                                onChange={(e) => {
                                    setSettings(prev => ({
                                        ...prev,
                                        schedulingEnabled: e.target.checked
                                    }));
                                }}
                            />
                            <span className="slider"></span>
                        </label>
                        <span style={{ fontSize: '0.85rem', color: settings.schedulingEnabled ? 'var(--primary-500)' : 'var(--text-muted)', fontWeight: 600 }}>Enabled</span>
                    </div>
                </div>
                <div className="card-body">
                    {settings.schedulingEnabled ? (
                        <>
                            <p className="text-secondary mb-md">Specify when the exam should start. Students can pre-login before this time, but the exam countdown will only release at the start time.</p>
                            <div className="grid grid-2" style={{ gap: 'var(--space-md)' }}>
                                <div className="input-group" style={{ marginBottom: 0 }}>
                                    <label className="input-label required">Start Date</label>
                                    <input
                                        type="date"
                                        className="input"
                                        value={scheduledDate}
                                        onChange={(e) => setScheduledDate(e.target.value)}
                                        required
                                    />
                                </div>
                                <div className="input-group" style={{ marginBottom: 0 }}>
                                    <label className="input-label required">Start Time</label>
                                    <input
                                        type="time"
                                        step="1"
                                        className="input"
                                        value={scheduledTime}
                                        onChange={(e) => setScheduledTime(e.target.value)}
                                        required
                                    />
                                </div>
                            </div>

                            <div className="input-group" style={{ marginTop: 'var(--space-md)' }}>
                                <label className="input-label" style={{ fontWeight: 600 }}>Late Entry Policy</label>
                                <select
                                    className="input"
                                    value={settings.lateEntryPolicy ?? 'allow'}
                                    onChange={(e) => setSettings(prev => ({ ...prev, lateEntryPolicy: e.target.value as any }))}
                                >
                                    <option value="allow">Allow Late Entry (Candidates get remaining exam time)</option>
                                    <option value="disallow">Disallow Late Entry (Candidates cannot start after scheduled time)</option>
                                </select>
                                <small className="text-muted" style={{ display: 'block', marginTop: '4px' }}>
                                    Choose whether candidates are allowed to start the exam after the scheduled start time.
                                </small>
                            </div>
                            {(scheduledDate && scheduledTime) && (
                                <div style={{ marginTop: 'var(--space-md)', background: 'var(--bg-surface)', padding: 'var(--space-md)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                        <span style={{ color: 'var(--text-secondary)' }}>Calculated End Time:</span>
                                        <strong style={{ color: 'var(--primary-500)' }}>
                                            {calculateEndTimeString()}
                                        </strong>
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <p className="text-secondary" style={{ margin: 0 }}>Scheduling is currently disabled. This exam will be open for students to start immediately upon activation.</p>
                    )}
                </div>
            </div>

            {/* Questions Section */}
            <div className="card mb-xl">
                <div className="card-header">
                    <h3 className="card-title">❓ Questions ({questions.length})</h3>
                    <div className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
                        <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={downloadCSVTemplate}
                        >
                            <span>⬇️</span>
                            <span>Download Template</span>
                        </button>
                        <label className="btn btn-secondary" style={{ cursor: 'pointer', margin: 0 }}>
                            <span>📄</span>
                            <span>Upload CSV</span>
                            <input
                                type="file"
                                accept=".csv"
                                style={{ display: 'none' }}
                                onChange={handleCSVUpload}
                            />
                        </label>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={downloadQuestionsCSV}
                            disabled={questions.length === 0}
                        >
                            <span>📥</span>
                            <span>Download Questions</span>
                        </button>
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => {
                                setEditingQuestionId(null);
                                setCurrentQuestion({ type: 'mcq', options: ['', '', '', ''], points: 1 });
                                setShowQuestionModal(true);
                            }}
                        >
                            <span>➕</span>
                            <span>Add Question</span>
                        </button>
                    </div>
                </div>

                {questions.length > 0 ? (
                    <div className="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Question</th>
                                    <th>Type</th>
                                    <th>Points</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {questions.map((q, index) => (
                                    <tr key={q.id}>
                                        <td>{index + 1}</td>
                                        <td style={{ maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {q.text}
                                        </td>
                                        <td><span className="badge badge-info">{q.type}</span></td>
                                        <td>{q.points}</td>
                                        <td>
                                            <div className="flex gap-sm">
                                                <button className="btn btn-secondary btn-sm" onClick={() => handleEditQuestion(q)}>
                                                    ✏️
                                                </button>
                                                <button className="btn btn-danger btn-sm" onClick={() => handleRemoveQuestion(q.id)}>
                                                    🗑️
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
                        <p>No questions added yet</p>
                    </div>
                )}
            </div>

            <div className="flex gap-md justify-between">
                <button className="btn btn-ghost" onClick={() => navigate('/admin/dashboard/exams')}>
                    Cancel
                </button>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                    {saving ? <span className="spinner spinner-sm"></span> : <span>💾</span>}
                    <span>Save Changes</span>
                </button>
            </div>

            {/* Add Question Modal */}
            {showQuestionModal && (
                <div className="modal-overlay" onClick={() => setShowQuestionModal(false)}>
                    <div className="modal" style={{ maxWidth: '600px' }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{editingQuestionId ? 'Edit Question' : 'Add Question'}</h3>
                            <button className="modal-close" onClick={() => setShowQuestionModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div className="input-group mb-lg">
                                <label className="input-label required">Question Type</label>
                                <select
                                    className="input"
                                    value={currentQuestion.type}
                                    onChange={(e) => setCurrentQuestion(prev => ({
                                        ...prev,
                                        type: e.target.value as Question['type'],
                                        options: e.target.value === 'mcq' ? ['', '', '', ''] : []
                                    }))}
                                >
                                    <option value="mcq">Multiple Choice</option>
                                    <option value="true_false">True/False</option>
                                    <option value="short_answer">Short Answer</option>
                                </select>
                            </div>

                            <div className="input-group mb-lg">
                                <label className="input-label required">Question Text</label>
                                <textarea
                                    className="input"
                                    rows={3}
                                    value={currentQuestion.text || ''}
                                    onChange={(e) => setCurrentQuestion(prev => ({ ...prev, text: e.target.value }))}
                                />
                            </div>

                            {currentQuestion.type === 'mcq' && (
                                <div className="input-group mb-lg">
                                    <label className="input-label required">Options</label>
                                    {currentQuestion.options?.map((option, index) => (
                                        <div key={index} className="flex gap-sm mb-sm" style={{ alignItems: 'center' }}>
                                            <input
                                                type="radio"
                                                name="correctAnswer"
                                                checked={currentQuestion.correctAnswer === index}
                                                onChange={() => setCurrentQuestion(prev => ({ ...prev, correctAnswer: index }))}
                                            />
                                            <input
                                                type="text"
                                                className="input"
                                                placeholder={`Option ${index + 1}`}
                                                value={option}
                                                onChange={(e) => {
                                                    const newOptions = [...(currentQuestion.options || [])];
                                                    newOptions[index] = e.target.value;
                                                    setCurrentQuestion(prev => ({ ...prev, options: newOptions }));
                                                }}
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}

                            {currentQuestion.type === 'true_false' && (
                                <div className="input-group mb-lg">
                                    <label className="input-label required">Correct Answer</label>
                                    <select
                                        className="input"
                                        value={currentQuestion.correctAnswer as string || 'true'}
                                        onChange={(e) => setCurrentQuestion(prev => ({ ...prev, correctAnswer: e.target.value }))}
                                    >
                                        <option value="true">True</option>
                                        <option value="false">False</option>
                                    </select>
                                </div>
                            )}

                            <div className="input-group">
                                <label className="input-label">Points</label>
                                <input
                                    type="number"
                                    className="input"
                                    min={1}
                                    value={currentQuestion.points || 1}
                                    onChange={(e) => setCurrentQuestion(prev => ({ ...prev, points: parseInt(e.target.value) || 1 }))}
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-ghost" onClick={() => setShowQuestionModal(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleAddQuestion}>
                                {editingQuestionId ? 'Update Question' : 'Add Question'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
