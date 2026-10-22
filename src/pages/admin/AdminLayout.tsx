import { useInstitute } from '../../context/InstituteContext';
import { useState, useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Footer from '../../components/Footer';
import Logo from '../../components/Logo';
import PortalIcon from '../../components/PortalIcon';

// SVG Icons as components
const DashboardIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" />
        <rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" />
    </svg>
);

const ExamsIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
    </svg>
);

const MonitorIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);

const AnalyticsIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
);

const BlockedIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
);

const SessionsIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
);

const SignOutIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
    </svg>
);

const FacultyIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
);

const ResultsIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="8" r="7" />
        <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
    </svg>
);

export default function AdminLayout() {
    const { institute } = useInstitute();
    const { adminData, signOut } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [mobileOpen, setMobileOpen] = useState(false);
    const [signOutError, setSignOutError] = useState('');

    // Check localStorage for collapsed sidebar state
    const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
        return localStorage.getItem('admin_sidebar_collapsed') === 'true';
    });

    useEffect(() => {
        localStorage.setItem('admin_sidebar_collapsed', String(isCollapsed));
    }, [isCollapsed]);

    const handleSignOut = async () => {
        try {
            setSignOutError('');
            await signOut();
            navigate('/admin');
        } catch {
            setSignOutError('Unable to sign out. Please try again.');
        }
    };

    useEffect(() => { setMobileOpen(false); }, [location.pathname]);

    useEffect(() => {
        if (!mobileOpen) return;
        const close = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setMobileOpen(false);
                document.getElementById('admin-menu-toggle')?.focus();
            }
        };
        window.addEventListener('keydown', close);
        return () => window.removeEventListener('keydown', close);
    }, [mobileOpen]);

    const isAdmin = adminData?.role === 'admin' || adminData?.role === 'superadmin';

    const navLinks = [
        { to: '/admin/dashboard', icon: <DashboardIcon />, label: 'Dashboard' },
        { to: '/admin/dashboard/exams', icon: <ExamsIcon />, label: 'Exams' },
        { to: '/admin/dashboard/monitor', icon: <MonitorIcon />, label: 'Live Monitor' },
        { to: '/admin/dashboard/sessions', icon: <SessionsIcon />, label: 'Sessions' },
        { to: '/admin/dashboard/results', icon: <ResultsIcon />, label: 'Results' },
        { to: '/admin/dashboard/analytics', icon: <AnalyticsIcon />, label: 'Analytics' },
    ];

    if (isAdmin) {
        navLinks.push({ to: '/admin/dashboard/blocked', icon: <BlockedIcon />, label: 'Blocked Students' });
        navLinks.push({ to: '/admin/dashboard/faculty', icon: <FacultyIcon />, label: 'Faculty' });
    }
    navLinks.push({ to: '/admin/dashboard/subscription', icon: <PortalIcon name="shield" />, label: 'Institute & subscription' });
    const currentPage = [...navLinks].reverse().find(link => location.pathname.startsWith(link.to))?.label || 'Dashboard';

    return (
        <div className="admin-portal" style={{ display: 'flex', minHeight: '100vh' }}>
            <a className="portal-skip-link" href="#admin-main">Skip to main content</a>
            {mobileOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
            {/* Sidebar */}
            <aside id="admin-navigation" className={`sidebar ${isCollapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
                <div className="sidebar-header" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', justifyContent: isCollapsed ? 'center' : 'flex-start' }}>
                    <Logo size={isCollapsed ? 32 : 40} />
                    {!isCollapsed && (
                        <div className="sidebar-brand">
                            <span>{institute?.name}</span><br />
                            INVYRIX
                        </div>
                    )}
                </div>

                <nav className="sidebar-nav" aria-label="Administration">
                    {!isCollapsed && <p className="sidebar-section-label">WORKSPACE</p>}
                    {navLinks.map((link) => (
                        <NavLink
                            key={link.to}
                            to={link.to}
                            end={link.to === '/admin/dashboard'}
                            className={({ isActive }) =>
                                `sidebar-link ${isActive ? 'active' : ''} ${isCollapsed ? 'collapsed' : ''}`
                            }
                            title={isCollapsed ? link.label : undefined}
                            aria-label={link.label}
                        >
                            <span className="sidebar-link-icon">{link.icon}</span>
                            {!isCollapsed && <span>{link.label}</span>}
                        </NavLink>
                    ))}
                </nav>

                <div className="sidebar-footer">
                    {!isCollapsed && <div className="sidebar-workspace-note"><PortalIcon name="shield" size={16} /><span>{isAdmin ? 'Administrator workspace' : 'Faculty workspace'}</span></div>}
                    {/* User Profile Info */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: isCollapsed ? '0' : 'var(--space-md)',
                        justifyContent: isCollapsed ? 'center' : 'flex-start',
                        marginBottom: 'var(--space-md)'
                    }}>
                        <div style={{
                            width: 40,
                            height: 40,
                            borderRadius: 'var(--radius-full)',
                            background: 'linear-gradient(135deg, var(--primary-500), var(--accent-purple))',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '1rem',
                            fontWeight: 600,
                            color: 'white',
                            flexShrink: 0
                        }}
                        title={isCollapsed ? adminData?.name || adminData?.email || 'Admin' : undefined}
                        >
                            {adminData?.name?.charAt(0) || adminData?.email?.charAt(0)?.toUpperCase() || 'A'}
                        </div>
                        {!isCollapsed && (
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                    fontWeight: 500,
                                    fontSize: '0.875rem',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis'
                                }}>
                                    {adminData?.name || 'Admin'}
                                </div>
                                <div style={{
                                    fontSize: '0.75rem',
                                    color: 'var(--text-muted)',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis'
                                }}>
                                    {adminData?.email}
                                </div>
                            </div>
                        )}
                    </div>
                    
                    {/* Footer Actions Group */}
                    <div className="flex flex-col gap-sm">
                        <button
                            onClick={handleSignOut}
                            className="btn btn-ghost"
                            style={{ width: '100%', justifyContent: isCollapsed ? 'center' : 'flex-start', padding: isCollapsed ? '0.65rem 0' : '0.65rem 1.25rem' }}
                            title={isCollapsed ? 'Sign Out' : undefined}
                            aria-label="Sign out"
                        >
                            <SignOutIcon />
                            {!isCollapsed && <span>Sign Out</span>}
                        </button>
                        
                        <button
                            onClick={() => setIsCollapsed(!isCollapsed)}
                            className="btn btn-ghost"
                            style={{ 
                                width: '100%', 
                                justifyContent: isCollapsed ? 'center' : 'flex-start', 
                                padding: isCollapsed ? '0.65rem 0' : '0.65rem 1.25rem',
                                borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                                paddingTop: 'var(--space-sm)',
                                marginTop: 'var(--space-xs)'
                            }}
                            title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
                            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                            aria-expanded={!isCollapsed}
                        >
                            {isCollapsed ? (
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="13 17 18 12 13 7" />
                                    <polyline points="6 17 11 12 6 7" />
                                </svg>
                            ) : (
                                <>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <polyline points="11 17 6 12 11 7" />
                                        <polyline points="18 17 13 12 18 7" />
                                    </svg>
                                    <span>Collapse</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </aside>

            {/* Main Content Pane */}
            <div className={`main-content ${isCollapsed ? 'sidebar-collapsed' : ''}`} style={{ display: 'flex', flexDirection: 'column' }}>
                <header className="admin-topbar">
                    <div className="admin-breadcrumb"><button id="admin-menu-toggle" className="btn btn-ghost mobile-menu-toggle" aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileOpen} aria-controls="admin-navigation" onClick={() => { setIsCollapsed(false); setMobileOpen(value => !value); }}><PortalIcon name={mobileOpen ? 'close' : 'menu'} /></button><span>Workspace</span><span aria-hidden="true">/</span><strong>{currentPage}</strong></div>
                    <div className="admin-topbar-actions"><span className="workspace-role">{isAdmin ? 'Admin' : 'Faculty'}</span><Link to="/" className="btn btn-ghost btn-sm">Student portal <PortalIcon name="arrow" size={16} /></Link></div>
                </header>
                {signOutError && <div role="alert" className="alert alert-error">{signOutError}</div>}
                <main id="admin-main" tabIndex={-1} className="page container" style={{ flex: 1 }}>
                    <Outlet />
                </main>
                <Footer />
            </div>
        </div>
    );
}
