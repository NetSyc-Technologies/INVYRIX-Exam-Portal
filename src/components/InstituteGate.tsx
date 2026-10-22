import { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useInstitute } from '../context/InstituteContext';
import { useAuth } from '../context/AuthContext';
import Logo from './Logo';
export default function InstituteGate({ children }: { children: ReactNode }) {
    const { institute, loading, error, active } = useInstitute();
    const { loading: authLoading, user, isSuperAdmin, error: authError } = useAuth();
    const { pathname } = useLocation();
    if (loading || authLoading) return <div className="platform-gate"><div className="spinner" /><p>Connecting to your institute…</p></div>;
    if (error || !institute || !user) return <div className="platform-gate"><Logo size={80} /><h1>Unable to open this portal</h1><p role="alert">{error || authError || 'Please check your connection.'}</p><button className="btn btn-primary" onClick={() => window.location.reload()}>Try again</button><a href="/">Find your institute</a></div>;
    if (!active && !isSuperAdmin) {
        if (pathname.startsWith('/admin/dashboard') && pathname !== '/admin/dashboard/subscription') return <Navigate to="/admin/dashboard/subscription" replace />;
        if (pathname !== '/admin' && pathname !== '/admin/dashboard/subscription') return <div className="platform-gate"><Logo size={80} /><h1>{institute.name}</h1><span className="platform-badge paused">{institute.status === 'paused' ? 'Account paused' : 'Subscription expired'}</span><p>{institute.message || 'This institute’s exam portal is currently inactive. Please contact your institute administrator.'}</p><Link to="/admin" className="btn btn-primary">Administrator sign in / renewal</Link><small>INVYRIX by NetSyc Technologies</small></div>;
    }
    return <>{children}</>;
}
