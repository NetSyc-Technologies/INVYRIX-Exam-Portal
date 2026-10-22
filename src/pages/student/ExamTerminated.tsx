import { useLocation, Link } from 'react-router-dom';
import Footer from '../../components/Footer';

export default function ExamTerminated() {
    const location = useLocation();
    const reason = location.state?.reason || 'Exam terminated due to rule violation';

    return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
            <div className="page flex items-center justify-center" style={{ flex: 1 }}>
                <div className="container" style={{ maxWidth: '500px' }}>
                    <div className="card text-center" style={{ padding: 'var(--space-2xl)' }}>
                        <div style={{
                            width: 80, height: 80, margin: '0 auto var(--space-lg)',
                            background: 'rgba(239, 68, 68, 0.2)', borderRadius: 'var(--radius-full)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                            </svg>
                        </div>
                        <h1 style={{ fontSize: '1.75rem', marginBottom: 'var(--space-md)', color: 'var(--error)' }}>
                            Exam Terminated
                        </h1>
                        <p className="text-secondary" style={{ fontSize: '1rem', marginBottom: 'var(--space-lg)' }}>
                            {reason}
                        </p>

                        <div className="alert alert-error mb-xl" style={{ textAlign: 'left' }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                            </svg>
                            <div>
                                <strong>What happened?</strong>
                                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.875rem' }}>
                                    {reason.toLowerCase().includes('warning') || reason.toLowerCase().includes('violation')
                                        ? 'Your exam session was terminated due to exceeding the allowed security warning limit. You are now blocked from retaking this exam until an administrator reviews your case.'
                                        : reason}
                                </p>
                            </div>
                        </div>

                        <div className="card" style={{ background: 'var(--bg-surface)', textAlign: 'left', marginBottom: 'var(--space-xl)' }}>
                            <h4 style={{ marginBottom: 'var(--space-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                                </svg>
                                Contact Administrator
                            </h4>
                            <p className="text-secondary" style={{ fontSize: '0.875rem', margin: 0 }}>
                                If you believe this was an error or technical issue, please contact your
                                exam administrator immediately with your roll number and exam details.
                            </p>
                        </div>

                        <Link to="/" className="btn btn-secondary btn-lg" style={{ width: '100%' }}>
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
