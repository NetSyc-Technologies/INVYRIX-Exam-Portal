import { useState, useEffect, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../services/platform';
import { useInstitute } from '../../context/InstituteContext';
import { Exam } from '../../types';
import Footer from '../../components/Footer';
import Logo from '../../components/Logo';
import { parseUserAgent } from '../../utils/deviceUtils';
import PortalIcon from '../../components/PortalIcon';
import '../../landing.css';

export default function ExamEntry() {
    const { institute } = useInstitute();
    const navigate = useNavigate();
    const [exams, setExams] = useState<Exam[]>([]);
    const [selectedExam, setSelectedExam] = useState('');
    const [rollNo, setRollNo] = useState('');
    const [studentName, setStudentName] = useState('');
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [fetchingExams, setFetchingExams] = useState(true);
    const [error, setError] = useState('');
    const [fetchError, setFetchError] = useState('');
    const [retry, setRetry] = useState(0);
    const [showPassword, setShowPassword] = useState(false);
    const currentExam = exams.find(exam => exam.id === selectedExam);

    // Roll verification states
    const [rollVerified, setRollVerified] = useState(false);
    const [fetchedName, setFetchedName] = useState('');
    const [verifyingRoll, setVerifyingRoll] = useState(false);
    const [rollError, setRollError] = useState('');

    useEffect(() => {
        let cancelled = false;
        const fetchExams = async () => {
            setFetchingExams(true);
            setFetchError('');
            try {
                const available = await api<Exam[]>('listAvailableExams');
                if (!cancelled) setExams(available.sort((a, b) => a.examName.localeCompare(b.examName)));
            } catch (err) {
                console.error('Error fetching exams:', err);
                if (!cancelled) setFetchError('We couldn’t load the available exams. Check your connection and try again.');
            } finally {
                if (!cancelled) setFetchingExams(false);
            }
        };
        fetchExams();
        return () => { cancelled = true; };
    }, [retry]);

    const changeExam = (id: string) => {
        setSelectedExam(id);
        setRollVerified(false);
        setFetchedName('');
        setStudentName('');
        setRollNo('');
        setPhone('');
        setEmail('');
        setRollError('');
        setError('');
        setPassword('');
        setShowPassword(false);
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const exam = exams.find(e => e.id === selectedExam);
            if (!exam) { setError('Please select an exam'); setLoading(false); return; }

            const settings = exam.settings || { requireRollNo: true, requireName: true };

            // Validate required fields
            if (settings.requireRollNo !== false && (!rollNo.trim() || !rollVerified)) { setError('Please confirm your roll number'); setLoading(false); return; }
            if (settings.requireName !== false && !studentName.trim()) { setError('Name is required'); setLoading(false); return; }
            if (settings.requirePhone && !phone.trim()) { setError('Phone number is required'); setLoading(false); return; }
            if (settings.requireEmail && !email.trim()) { setError('Email is required'); setLoading(false); return; }

            // Check Device Restriction
            const deviceRestriction = exam.settings?.deviceRestriction || 'both';
            const isMobile = window.matchMedia("(pointer:coarse)").matches ||
                /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            
            if (deviceRestriction === 'mobile_only' && !isMobile) {
                setError('Access Denied: This exam is restricted to mobile devices only.');
                setLoading(false);
                return;
            } else if (deviceRestriction === 'desktop_only' && isMobile) {
                setError('Access Denied: This exam is restricted to desktop or laptop devices only.');
                setLoading(false);
                return;
            }

            // Check if exam scheduling is active and has expired, or late entry is disallowed
            if (exam.settings?.schedulingEnabled) {
                if (exam.settings.scheduledStartTime) {
                    const startVal = exam.settings.scheduledStartTime;
                    const startTimeMs = startVal.toDate ? startVal.toDate().getTime() : new Date(startVal).getTime();
                    
                    if (exam.settings.lateEntryPolicy === 'disallow' && Date.now() > startTimeMs) {
                        setError('Access Denied: Late entry is not permitted for this exam.');
                        setLoading(false);
                        return;
                    }
                }

                if (exam.settings.scheduledEndTime) {
                    const endVal = exam.settings.scheduledEndTime;
                    const endTimeMs = endVal.toDate ? endVal.toDate().getTime() : new Date(endVal).getTime();
                    if (Date.now() >= endTimeMs) {
                        setError('This exam has already ended.');
                        setLoading(false);
                        return;
                    }
                }
            }

            const sessionRef = await api<{ sessionId: string }>('startExam', {
                examId: selectedExam, rollNo: rollNo.trim().toUpperCase(), studentName, phone, email, password, isMobile,
                deviceInfo: { userAgent: navigator.userAgent, platform: navigator.platform, screenWidth: window.screen.width, screenHeight: window.screen.height, ...parseUserAgent(navigator.userAgent) }
            });
            // Navigate to pre-exam check
            navigate('/exam/verify', {
                state: {
                    sessionId: sessionRef.sessionId,
                    examName: exam.examName,
                    duration: exam.duration,
                    studentName: studentName.trim(),
                    maxWarnings: exam.settings?.maxWarnings ?? 2
                }
            });
        } catch (err) {
            console.error('Error starting exam:', err);
            setError(err instanceof Error ? err.message : 'Failed to start exam. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="student-landing">
            <a className="portal-skip-link" href="#exam-entry">Skip to exam entry</a>
            <main className="landing-main">
                <section id="exam-entry" className="landing-entry" aria-labelledby="entry-title" tabIndex={-1}>
                    <div className="card entry-card">
                        <header className="entry-heading">
                            <div className="entry-brand">
                                <span className="entry-brand-mark"><Logo size={38} /></span>
                                <div><strong>{institute?.name}</strong><span>INVYRIX by NetSyc Technologies</span></div>
                            </div>
                            <span className="entry-eyebrow">STUDENT ACCESS</span>
                            <h1 id="entry-title">Exam Portal</h1>
                            <p>Select your exam to get started.</p>
                        </header>

                        {error && (
                            <div className="alert alert-error mb-lg" role="alert">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                                </svg>
                                <span>{error}</span>
                            </div>
                        )}

                        <form onSubmit={handleSubmit} aria-busy={loading}>
                          <fieldset disabled={loading} className="entry-fields">
                            <div className="input-group mb-lg">
                                <label className="input-label required" htmlFor="exam-select">Select Exam</label>
                                {fetchingExams ? (
                                    <div className="flex items-center gap-sm">
                                        <div className="spinner spinner-sm"></div>
                                        <span className="text-muted">Loading exams...</span>
                                    </div>
                                ) : fetchError ? (
                                    <div className="entry-load-error" role="alert"><p>{fetchError}</p><button type="button" className="btn btn-secondary btn-sm" onClick={() => setRetry(value => value + 1)}><PortalIcon name="refresh" size={16} /> Try again</button></div>
                                ) : exams.length > 0 ? (
                                    <div className="entry-select">
                                    <PortalIcon name="book" size={19} />
                                    <select id="exam-select" className="input" value={selectedExam} onChange={(e) => changeExam(e.target.value)} required>
                                        <option value="">Choose an exam</option>
                                        {exams.map(exam => <option key={exam.id} value={exam.id}>{exam.examName} ({exam.duration} min)</option>)}
                                    </select>
                                    </div>
                                ) : (
                                    <div className="alert alert-info">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                                        </svg>
                                        <span>No active exams right now. Your instructor will let you know when one opens. <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRetry(value => value + 1)}>Refresh exams</button></span>
                                    </div>
                                )}
                            </div>
                            {selectedExam && (
                                <>
                                    <div className="entry-exam-summary"><span><PortalIcon name="clock" size={16} /> {currentExam?.duration} minutes</span><span><PortalIcon name="book" size={16} /> {currentExam?.questionCount || 0} questions</span><span>{currentExam?.settings?.deviceRestriction === 'mobile_only' ? 'Mobile only' : currentExam?.settings?.deviceRestriction === 'desktop_only' ? 'Desktop / laptop only' : 'Any device'}</span></div>

                                    {(exams.find(e => e.id === selectedExam)?.settings?.requireRollNo !== false) && (
                                        <div className="input-group mb-lg">
                                            <label className="input-label required" htmlFor="student-roll">Roll Number</label>
                                            <div className="flex gap-sm">
                                                <input
                                                    id="student-roll"
                                                    type="text"
                                                    className="input"
                                                    placeholder="Enter your roll number"
                                                    value={rollNo}
                                                    onChange={(e) => {
                                                        setRollNo(e.target.value.toUpperCase());
                                                        setRollVerified(false);
                                                        setFetchedName('');
                                                        setRollError('');
                                                    }}
                                                    required
                                                    style={{ textTransform: 'uppercase', flex: 1 }}
                                                    disabled={rollVerified}
                                                    autoComplete="off"
                                                    autoCorrect="off"
                                                />
                                                {!rollVerified ? (
                                                    <button
                                                        type="button"
                                                        className="btn btn-secondary"
                                                        disabled={!rollNo.trim() || !selectedExam || verifyingRoll}
                                                        onClick={async () => {
                                                            if (!rollNo.trim() || !selectedExam) return;
                                                            setVerifyingRoll(true);
                                                            setRollError('');

                                                            const exam = exams.find(e => e.id === selectedExam);
                                                            if (!exam) {
                                                                setRollError('Please select an exam first');
                                                                setVerifyingRoll(false);
                                                                return;
                                                            }

                                                            setRollVerified(true);
                                                            setVerifyingRoll(false);
                                                        }}
                                                    >
                                                        {verifyingRoll ? (
                                                            <span className="spinner spinner-sm"></span>
                                                        ) : (
                                                            <span>Fetch</span>
                                                        )}
                                                    </button>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        className="btn btn-ghost"
                                                        onClick={() => {
                                                            setRollVerified(false);
                                                            setFetchedName('');
                                                            setRollNo('');
                                                            setStudentName('');
                                                        }}
                                                    >
                                                        Change
                                                    </button>
                                                )}
                                            </div>
                                            {rollError && (
                                                <div className="alert alert-error mt-sm" style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.813rem' }}>
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                                                    </svg>
                                                    <span>{rollError}</span>
                                                </div>
                                            )}
                                            {rollVerified && fetchedName && (
                                                <div className="alert alert-success mt-sm" style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.813rem' }}>
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <polyline points="20 6 9 17 4 12" />
                                                    </svg>
                                                    <span>Verified: {fetchedName}</span>
                                                </div>
                                            )}
                                            {rollVerified && !fetchedName && (
                                                <div className="alert alert-info mt-sm" style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.813rem' }}>
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <polyline points="20 6 9 17 4 12" />
                                                    </svg>
                                                    <span>Roll number accepted. Please enter your name below.</span>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {(exams.find(e => e.id === selectedExam)?.settings?.requireName !== false) && (() => {
                                        const exam = exams.find(e => e.id === selectedExam);
                                        const hasRollList = (exam?.allowedStudents?.length ?? 0) > 0;
                                        const isNameDisabled = !!fetchedName || (hasRollList && exam?.settings?.requireRollNo !== false);

                                        return (
                                            <div className="input-group mb-lg">
                                                <label className="input-label required" htmlFor="student-name">Full Name</label>
                                                <input
                                                    id="student-name"
                                                    type="text"
                                                    className="input"
                                                    placeholder={hasRollList ? "Fetch roll number to auto-fill name" : "Enter your full name"}
                                                    value={studentName}
                                                    onChange={(e) => setStudentName(e.target.value)}
                                                    required
                                                    disabled={isNameDisabled}
                                                    style={isNameDisabled ? { background: 'var(--bg-surface)', color: 'var(--text-secondary)' } : {}}
                                                    autoComplete="off"
                                                    autoCorrect="off"
                                                />
                                                {fetchedName && (
                                                    <small className="text-muted">Name auto-filled from roll list</small>
                                                )}
                                                {!fetchedName && hasRollList && (
                                                    <small className="text-muted">Please fetch your roll number to identify yourself</small>
                                                )}
                                            </div>
                                        );
                                    })()}

                                    {exams.find(e => e.id === selectedExam)?.settings?.requirePhone && (
                                        <div className="input-group mb-lg">
                                            <label className="input-label required" htmlFor="student-phone">Phone Number</label>
                                            <input
                                                id="student-phone"
                                                type="tel"
                                                className="input"
                                                placeholder="Enter your phone number"
                                                value={phone}
                                                onChange={(e) => setPhone(e.target.value)}
                                                required
                                            />
                                        </div>
                                    )}

                                    {exams.find(e => e.id === selectedExam)?.settings?.requireEmail && (
                                        <div className="input-group mb-lg">
                                            <label className="input-label required" htmlFor="student-email">Email Address</label>
                                            <input
                                                id="student-email"
                                                type="email"
                                                className="input"
                                                placeholder="Enter your email"
                                                value={email}
                                                onChange={(e) => setEmail(e.target.value)}
                                                required
                                            />
                                        </div>
                                    )}

                                    <div className="input-group mb-xl">
                                        <label className="input-label required" htmlFor="exam-password">Exam Password</label>
                                        <div className="entry-password">
                                        <input
                                            id="exam-password"
                                            type={showPassword ? 'text' : 'password'}
                                            className="input"
                                            placeholder="Enter exam password"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            required
                                        />
                                        <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide exam password' : 'Show exam password'} aria-pressed={showPassword}>{showPassword ? 'Hide' : 'Show'}</button>
                                        </div>
                                    </div>

                                    <button
                                        type="submit"
                                        className="btn btn-primary btn-lg"
                                        style={{ width: '100%' }}
                                        disabled={
                                            loading ||
                                            exams.length === 0 ||
                                            ((exams.find(e => e.id === selectedExam)?.settings?.requireRollNo !== false) && !rollVerified) ||
                                            (currentExam?.settings?.requireName !== false && !studentName.trim())
                                        }
                                    >
                                        {loading ? (
                                            <>
                                                <span className="spinner spinner-sm"></span>
                                                <span>Verifying...</span>
                                            </>
                                        ) : (
                                            <>
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                                                    <polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" />
                                                </svg>
                                                <span>Proceed to Verification</span>
                                            </>
                                        )}
                                    </button>
                                </>
                            )}
                          </fieldset>
                        </form>

                        <nav className="entry-links" aria-label="Portal links">
                            <Link to="/results">
                                View Results <PortalIcon name="arrow" size={14} />
                            </Link>
                            <span aria-hidden="true">·</span>
                            <Link to="/admin">
                                Admin Panel <PortalIcon name="arrow" size={14} />
                            </Link>
                        </nav>
                    </div>
                    <p className="entry-help"><PortalIcon name="shield" size={14} /> Need help? Contact your exam coordinator.</p>
                </section>
            </main>
            <Footer />
        </div>
    );
}
