import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../services/firebase';
import { api, Institute, isInstituteActive } from '../../services/platform';
import PlatformShell from './PlatformShell';
export default function Account() {
    const { user, loading, isSuperAdmin, signInWithGoogle, signOut } = useAuth();
    const [institutes, setInstitutes] = useState<Institute[]>([]);
    const [application, setApplication] = useState<any>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        if (!user || user.isAnonymous) { setInstitutes([]); setApplication(null); return; }
        let alive = true;
        setBusy(true);
        api<Institute[]>('listMyInstitutes').then(value => { if (alive) setInstitutes(value); }).catch(err => { if (alive) setError(err.message); }).finally(() => { if (alive) setBusy(false); });
        const unsubscribe = onSnapshot(doc(db, 'registrations', user.uid), snapshot => setApplication(snapshot.exists() ? snapshot.data() : null), err => setError(err.message));
        return () => { alive = false; unsubscribe(); };
    }, [user?.uid, revision]);
    return <PlatformShell><section className="platform-page-heading"><span className="platform-eyebrow">YOUR INVYRIX ACCOUNT</span><h1>{user && !user.isAnonymous ? 'Welcome back.' : 'Sign in to your workspace.'}</h1><p>Manage your institute, track your application, or renew access.</p></section><section className="platform-card">{loading ? <p>Checking your account…</p> : !user || user.isAnonymous ? <><h2>Administrator sign in</h2><p>Use the Google account nominated for your institute.</p><button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await signInWithGoogle(); } catch (err: any) { setError(err.message); } finally { setBusy(false); } }}>Continue with Google</button></> : <><div className="platform-row"><p>Signed in as <strong>{user.email}</strong></p><button className="btn btn-secondary" onClick={() => signOut().catch(err => setError(err.message))}>Sign out</button></div>{isSuperAdmin && <a href="/superadmin" className="btn btn-primary">Open super-admin console →</a>}{application && <div className="application-status"><span className={`platform-badge ${application.status}`}>{application.status}</span><h2>{application.name}</h2>{application.status === 'pending' && <p>Your registration is awaiting verification by NetSyc.</p>}{application.status === 'rejected' && <><p>{application.reason}</p><a href="/register">Update and resubmit your application →</a></>}{application.status === 'approved' && <><p>Your INVYRIX ID: <strong>{application.invyrixId}</strong></p><a href={`/${application.tenantId}/admin/dashboard`}>Open institute dashboard →</a></>}</div>}<h2 className="platform-spaced">Your institutes</h2>{busy ? <p>Loading institutes…</p> : institutes.length ? <div className="platform-institute-grid">{institutes.map(profile => <article key={profile.slug}><img src={profile.logoUrl || '/logo.png'} alt="" /><h3>{profile.name}</h3><span className={`platform-badge ${isInstituteActive(profile) ? 'active' : 'paused'}`}>{isInstituteActive(profile) ? 'Active' : profile.status === 'paused' ? 'Paused' : 'Expired'}</span><p>{profile.invyrixId}</p><a href={`/${profile.slug}/admin/dashboard`} className="btn btn-secondary">Open dashboard →</a></article>)}</div> : <p>No institute access is assigned yet. <a href="/register">Register an institute</a> or check with your administrator.</p>}<button className="btn btn-ghost" onClick={() => { setError(''); setRevision(value => value + 1); }}>Refresh account</button></>}{error && <p role="alert" className="form-error">{error}</p>}</section></PlatformShell>;
}
