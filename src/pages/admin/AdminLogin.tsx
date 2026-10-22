import { useInstitute } from '../../context/InstituteContext';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Footer from '../../components/Footer';
import Logo from '../../components/Logo';

export default function AdminLogin() {
    const { institute } = useInstitute();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const navigate = useNavigate();
    const { signInWithGoogle, adminData, loading: authLoading, user } = useAuth();
    useEffect(() => { if (!authLoading && adminData) navigate('/admin/dashboard', { replace: true }); }, [authLoading, adminData, navigate]);

    const handleGoogleLogin = async () => {
        setLoading(true);
        setError('');

        try {
            await signInWithGoogle();

        } catch (err: any) {
            setError(err.message || 'Failed to login with Google');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="admin-portal" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
            <div className="page flex items-center justify-center" style={{ flex: 1 }}>
                <div className="container" style={{ maxWidth: '450px' }}>
                    <div className="card" style={{ padding: 'var(--space-2xl)' }}>
                        {/* Header */}
                        <div className="text-center mb-xl">
                            <Logo size={64} style={{ margin: '0 auto var(--space-lg)', display: 'block' }} />
                            <h1 style={{ fontSize: '1.6rem', fontWeight: 800, marginBottom: 'var(--space-xs)', lineHeight: '1.3' }}>
                                INVYRIX
                                <span style={{ display: 'block', fontSize: '0.95rem', color: 'var(--text-secondary)', fontWeight: 500, marginTop: '6px' }}>
                                    {institute?.name}
                                </span>
                            </h1>
                            <p className="text-secondary" style={{ fontSize: '0.85rem', margin: 0 }}>
                                INVYRIX · Administrator sign in
                            </p>
                        </div>

                        {user && !user.isAnonymous && !authLoading && !adminData && <p className="alert alert-error">This Google account does not have access to this institute. Sign in with an authorized account.</p>}
                        {/* Error Message */}
                        {error && (
                            <div className="alert alert-error mb-lg">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                                </svg>
                                <span>{error}</span>
                            </div>
                        )}

                        <div className="mb-lg">
                            <button
                                onClick={handleGoogleLogin}
                                className="btn btn-google btn-lg"
                                disabled={loading}
                            >
                                {loading ? (
                                    <>
                                        <span className="spinner spinner-sm"></span>
                                        <span>Signing in...</span>
                                    </>
                                ) : (
                                    <>
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                            <path d="M12 4.63c1.69 0 3.26.58 4.54 1.8l3.49-3.49C17.9 0.96 15.18 0 12 0 7.7 0 3.99 2.47 2.18 5.86l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                                        </svg>
                                        <span>Sign in with Google</span>
                                    </>
                                )}
                            </button>
                        </div>

                        <div className="text-center">
                            <p className="text-muted" style={{ fontSize: '0.85rem' }}>
                                Only authorized administrators can access this portal.
                            </p>
                        </div>
                    </div>

                    <p className="text-center text-muted mt-lg" style={{ fontSize: '0.813rem' }}>
                        Student exam portal? <a href={institute ? `/${institute.slug}` : "/"}>Click here</a>
                    </p>
                </div>
            </div>
            <Footer />
        </div>
    );
}
