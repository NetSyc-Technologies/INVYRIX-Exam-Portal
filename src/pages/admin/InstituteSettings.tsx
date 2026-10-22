import { FormEvent, useEffect, useState } from 'react';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useInstitute } from '../../context/InstituteContext';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../services/firebase';
import { api, timestamp } from '../../services/platform';
import { tenantId } from '../../services/tenant';
import Logo from '../../components/Logo';
export default function InstituteSettings() {
    const { institute, active } = useInstitute();
    const { adminData } = useAuth();
    const [note, setNote] = useState('');
    const [renewal, setRenewal] = useState<any>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const canManage = adminData?.role === 'admin' || adminData?.role === 'superadmin';
    useEffect(() => {
        if (!tenantId || !canManage) return;
        return onSnapshot(doc(db, 'renewals', tenantId), snapshot => setRenewal(snapshot.data() || null), err => setError(err.message));
    }, [canManage]);
    if (!institute) return null;
    const renew = async (event: FormEvent) => {
        event.preventDefault(); setBusy(true); setError(''); setSuccess('');
        try { await api('requestRenewal', { note }); setSuccess('Renewal requested. Access will resume once the super admin approves it.'); }
        catch (err: any) { setError(err.message); } finally { setBusy(false); }
    };
    const upload = async (file?: File) => {
        if (!file) return;
        setBusy(true); setError(''); setSuccess('');
        try {
            if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size >= 2 * 1024 * 1024) throw new Error('Choose a PNG, JPEG or WebP logo smaller than 2 MB.');
            const bitmap = await createImageBitmap(file);
            const canvas = document.createElement('canvas');
            const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            bitmap.close();
            const logoUrl = canvas.toDataURL('image/webp', 0.78);
            if (logoUrl.length >= 180000) throw new Error('This logo is too large after compression. Choose a simpler image.');
            await updateDoc(doc(db, 'institutes', tenantId!), { logoUrl, updatedAt: serverTimestamp() });
            setSuccess('Logo updated. The website and connected apps will use the new branding.');
        } catch (err: any) { setError(err.message); } finally { setBusy(false); }
    };
    return <div className="institute-settings"><div className="page-header"><h1>Institute & subscription</h1><p>Manage your branding and access to INVYRIX.</p></div>{error && <div className="alert alert-error" role="alert">{error}</div>}{success && <div className="alert alert-success" role="status">{success}</div>}<section className="card" style={{ padding: 'var(--space-xl)', marginBottom: 'var(--space-xl)' }}><div className="platform-row"><div><h2>{institute.name}</h2><p>INVYRIX ID: <strong>{institute.invyrixId}</strong></p><p><a href={`/${institute.slug}`}>{window.location.origin}/{institute.slug}</a></p><p>The institute name is managed by the super admin.</p></div><Logo size={90} /></div>{canManage && <label className="input-label">Update institute logo (PNG, JPEG or WebP, under 2 MB)<input className="input" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} /></label>}</section><section className="card" style={{ padding: 'var(--space-xl)' }}><span className={`platform-badge ${active ? 'active' : 'paused'}`}>{active ? 'Active subscription' : institute.status === 'paused' ? 'Account paused' : 'Subscription expired'}</span><h2>Valid until {new Date(timestamp(institute.expiresAt)).toLocaleString()}</h2>{!active && <p>{institute.message || 'Your exam link is inactive. Request a renewal or contact NetSyc to restore access.'}</p>}{canManage ? <form onSubmit={renew}><label className="input-label">Message for the super admin<textarea className="input" value={note} onChange={e => setNote(e.target.value)} maxLength={1000} placeholder="Requested duration or any details for your renewal" /></label>{renewal?.status === 'pending' ? <p className="alert alert-info">Your renewal request is awaiting review.</p> : <button className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Request renewal'}</button>}<p>Renewal requests are reviewed by NetSyc. Submitting a request does not extend your subscription.</p></form> : <p>Contact your institute administrator to renew access.</p>}</section></div>;
}
