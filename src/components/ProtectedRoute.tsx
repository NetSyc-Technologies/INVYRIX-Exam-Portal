import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface ProtectedRouteProps {
    children: ReactNode;
    adminOnly?: boolean;
}

export default function ProtectedRoute({ children, adminOnly = false }: ProtectedRouteProps) {
    const { user, adminData, loading } = useAuth();
    const location = useLocation();

    if (loading) {
        return (
            <div className="page flex items-center justify-center" style={{ minHeight: '100vh' }}>
                <div className="spinner"></div>
            </div>
        );
    }

    if (!user || !adminData) {
        return <Navigate to="/admin" state={{ from: location }} replace />;
    }

    if (adminOnly && adminData.role === 'faculty') return <Navigate to="/admin/dashboard" replace />;

    return <>{children}</>;
}
