import { FormEvent, useEffect, useState } from 'react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../context/AuthContext';
import { api, Institute, isInstituteActive, timestamp } from '../../services/platform';
import PlatformShell from './PlatformShell';
import { RegistrationFields, emptyRegistration } from './Register';

const dateLabel = (value: any) => new Date(timestamp(value)).toLocaleString();
const defaultExpiry = () => { const date = new Date(); date.setMonth(date.getMonth() + 1); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
export default function SuperAdmin() {
    const { loading, isSuperAdmin } = useAuth();
    if (loading) return <PlatformShell><p>Checking super-admin access…</p></PlatformShell>;
    if (!isSuperAdmin) return <PlatformShell><section className="platform-card"><h1>Super-admin access required</h1><p>Sign in with admin@netsyc.com to manage INVYRIX.</p><a className="btn btn-primary" href="/admin">Sign in</a></section></PlatformShell>;
    return <Console />;
}
function Console() {
    const [institutes, setInstitutes] = useState<Institute[]>([]);
    const [applications, setApplications] = useState<any[]>([]);
    const [renewals, setRenewals] = useState<any[]>([]);
    const [audits, setAudits] = useState<any[]>([]);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);
    const [tab, setTab] = useState('institutes');
    const [search, setSearch] = useState('');
    const [review, setReview] = useState<any>(null);
    const [slug, setSlug] = useState('');
    const [expiresAt, setExpiresAt] = useState(defaultExpiry);
    const [reason, setReason] = useState('');
    const [manual, setManual] = useState(false);
    const [form, setForm] = useState(emptyRegistration);
    const [selected, setSelected] = useState<Institute | null>(null);
    const [newName, setNewName] = useState('');
    const [message, setMessage] = useState('');
    const [contacts, setContacts] = useState<Record<string, any>>({});
    const [loaded, setLoaded] = useState(false);
    const [, tick] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => tick(value => value + 1), 10000);
        const fail = (err: Error) => setError(`Unable to load administration data: ${err.message}`);
        const subscriptions = [
            onSnapshot(collection(db, 'institutes'), snap => { setInstitutes(snap.docs.map(doc => doc.data() as Institute)); setLoaded(true); }, fail),
            onSnapshot(collection(db, 'registrations'), snap => setApplications(snap.docs.map(doc => ({ ...doc.data(), id: doc.id }))), fail),
            onSnapshot(collection(db, 'renewals'), snap => setRenewals(snap.docs.map(doc => ({ ...doc.data(), id: doc.id }))), fail),
            onSnapshot(collection(db, 'institute_contacts'), snap => setContacts(Object.fromEntries(snap.docs.map(doc => [doc.id, doc.data()]))), fail),
            onSnapshot(query(collection(db, 'audit_log'), orderBy('at', 'desc'), limit(30)), snap => setAudits(snap.docs.map(doc => ({ ...doc.data(), id: doc.id }))), fail),
        ];
        return () => { clearInterval(timer); subscriptions.forEach(unsubscribe => unsubscribe()); };
    }, []);
    const execute = async (name: string, data: Record<string, unknown>, success: string) => {
        setBusy(true); setError(''); setNotice('');
        try { const result = await api(name, data); setNotice(success); return result; }
        catch (err: any) { setError(err.message || 'Unable to complete this action.'); return null; }
        finally { setBusy(false); }
    };
    const approve = async (event: FormEvent) => {
        event.preventDefault();
        const result = await execute('approveInstitute', { ...(manual ? form : { registrationId: review.id }), slug, expiresAt: new Date(`${expiresAt}T23:59:59`).toISOString() }, 'Institute approved. The administrator can find the link and ID in their account dashboard.');
        if (result) { setManual(false); setReview(null); setTab('institutes'); }
    };
    const action = async (kind: string) => {
        if (!selected) return;
        const result = await execute('updateInstitute', { tenantId: selected.slug, action: kind, message, name: newName, ...(kind === 'renew' ? { expiresAt: new Date(`${expiresAt}T23:59:59`).toISOString() } : {}) }, `Institute ${kind === 'renew' ? 'renewed' : kind === 'rename' ? 'name updated' : kind === 'message' ? 'message updated' : kind === 'pause' ? 'paused' : 'resumed'}.`);
        if (result) setSelected(null);
    };
    const pending = applications.filter(app => app.status === 'pending');
    const pendingRenewals = renewals.filter(request => request.status === 'pending');
    return <PlatformShell><div className="platform-page-heading platform-row"><div><span className="platform-eyebrow">NETSYC CONTROL CENTER</span><h1>Super-admin console</h1><p>Approve organizations, manage access, and oversee every institute.</p></div><button className="btn btn-primary" onClick={() => { setManual(true); setReview(null); setSelected(null); setForm(emptyRegistration); setSlug(''); setExpiresAt(defaultExpiry()); }}>+ Create institute</button></div><div className="platform-stats">{[['Institutes', institutes.length],['Active subscriptions',institutes.filter(profile => isInstituteActive(profile)).length],['Pending applications',pending.length],['Renewal requests',pendingRenewals.length]].map(([label,count]) => <article key={label}><span>{label}</span><strong>{count}</strong></article>)}</div>{error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status" className="form-success">{notice}</p>}
    {(manual || review) && <section className="platform-card"><div className="platform-row"><h2>{manual ? 'Create an institute' : `Review: ${review.name}`}</h2><button className="btn btn-ghost" disabled={busy} onClick={() => { setManual(false); setReview(null); }}>Close</button></div><form onSubmit={approve}><fieldset disabled={busy}>{manual ? <><p>Create access directly after verifying the organization and its administrator.</p><RegistrationFields value={form} onChange={setForm} /></> : <><dl className="platform-details">{Object.entries(review).filter(([key]) => ['name','type','address','city','country','website','adminName','adminEmail','adminPhone','termsVersion'].includes(key)).map(([key,value]) => <div key={key}><dt>{key.replace(/([A-Z])/g,' $1')}</dt><dd>{String(value)}</dd></div>)}</dl><p>Terms accepted: {dateLabel(review.termsAcceptedAt)}</p></>}<div className="platform-form-grid"><label>Permanent portal address<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength={3} maxLength={64} value={slug} onChange={e => setSlug(e.target.value.toLowerCase())} placeholder="your-institute" /><small>invyrix.netsyc.com/{slug || 'your-institute'}</small></label><label>Subscription valid through (your local time)<input type="date" required min={new Date().toLocaleDateString('en-CA')} value={expiresAt} onChange={e => setExpiresAt(e.target.value)} /></label></div><button className="btn btn-primary" disabled={!expiresAt}>{busy ? 'Saving…' : 'Approve & activate institute'}</button>{!manual && <div className="platform-spaced"><label>Reason for rejection<textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} /></label><button type="button" className="btn btn-secondary" disabled={!reason.trim()} onClick={async () => { if (await execute('rejectRegistration', { registrationId: review.id, reason }, 'Application rejected with your message.')) setReview(null); }}>Reject application</button></div>}</fieldset></form></section>}
    {selected && <section className="platform-card"><div className="platform-row"><h2>Manage {selected.name}</h2><button className="btn btn-ghost" disabled={busy} onClick={() => setSelected(null)}>Close</button></div><p>{selected.invyrixId} · <a href={`/${selected.slug}/admin/dashboard`}>Open institute dashboard ↗</a></p>{contacts[selected.slug] && <p>Administrator: {contacts[selected.slug].adminName} · {contacts[selected.slug].adminEmail} · {contacts[selected.slug].adminPhone}</p>}<fieldset disabled={busy}><div className="platform-form-grid"><label>Institute name<input value={newName} onChange={e => setNewName(e.target.value)} maxLength={160} /></label><div className="platform-field-action"><button className="btn btn-secondary" disabled={!newName.trim()} onClick={() => action('rename')}>Update name</button><small>The portal address and INVYRIX ID stay permanent.</small></div><label>Custom inactive-account message<textarea value={message} onChange={e => setMessage(e.target.value)} maxLength={1000} placeholder="Subscription expired. Contact your administrator to renew." /></label><div className="platform-field-action"><button className="btn btn-secondary" onClick={() => action('message')}>Save message</button><button className="btn btn-secondary" onClick={() => action('pause')}>Pause account</button><button className="btn btn-secondary" onClick={() => action('resume')}>Resume account</button></div><label>Renew through (your local time)<input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} /></label><div className="platform-field-action"><button className="btn btn-primary" disabled={!expiresAt} onClick={() => action('renew')}>Approve renewal & activate</button></div></div></fieldset></section>}
    <div className="platform-tabs" role="tablist" aria-label="Console sections">{[['institutes','Institutes'],['applications',`Applications (${pending.length})`],['renewals',`Renewals (${pendingRenewals.length})`],['audit','Recent activity']].map(([key,label]) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>)}</div><section className="platform-card">{tab === 'institutes' && <><label className="platform-search">Search institutes<input placeholder="Search by name or INVYRIX ID…" value={search} onChange={e => setSearch(e.target.value)} /></label>{!loaded && <p>Loading institutes…</p>}<div className="platform-table-wrap"><table className="platform-table"><thead><tr><th>Institute</th><th>INVYRIX ID</th><th>Status</th><th>Valid until</th><th>Actions</th></tr></thead><tbody>{institutes.filter(profile => `${profile.name} ${profile.invyrixId}`.toLowerCase().includes(search.toLowerCase())).map(profile => <tr key={profile.slug}><td><strong>{profile.name}</strong><a href={`/${profile.slug}`}>/{profile.slug} ↗</a></td><td><code>{profile.invyrixId}</code></td><td><span className={`platform-badge ${isInstituteActive(profile) ? 'active' : 'paused'}`}>{isInstituteActive(profile) ? 'Active' : profile.status === 'paused' ? 'Paused' : 'Expired'}</span></td><td>{dateLabel(profile.expiresAt)}</td><td><button className="btn btn-secondary" onClick={() => { setSelected(profile); setNewName(profile.name); setMessage(profile.message); setExpiresAt(defaultExpiry()); setReview(null); setManual(false); }}>Manage</button></td></tr>)}</tbody></table></div>{loaded && !institutes.length && <p>No institutes yet. Review an application or create an institute to begin.</p>}</>}
    {tab === 'applications' && <>{applications.length ? applications.map(application => <article className="platform-request" key={application.id}><div><span className={`platform-badge ${application.status}`}>{application.status}</span><h3>{application.name}</h3><p>{application.adminName} · {application.adminEmail} · {application.city}</p></div>{application.status === 'pending' && <button className="btn btn-primary" onClick={() => { setReview(application); setManual(false); setSelected(null); setReason(''); setSlug(application.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,64)); setExpiresAt(defaultExpiry()); }}>Review application</button>}</article>) : <p>No registration applications yet.</p>}</>}
    {tab === 'renewals' && <>{renewals.length ? renewals.map(renewal => <article key={renewal.id} className="platform-request"><div><span className={`platform-badge ${renewal.status}`}>{renewal.status}</span><h3>{renewal.name}</h3><p>{renewal.adminEmail}</p><p>{renewal.note}</p></div>{renewal.status === 'pending' && <button className="btn btn-primary" onClick={() => { const profile = institutes.find(item => item.slug === renewal.tenantId); if (profile) { setSelected(profile); setNewName(profile.name); setMessage(profile.message); setExpiresAt(defaultExpiry()); } }}>Review renewal</button>}</article>) : <p>No renewal requests.</p>}</>}
    {tab === 'audit' && <>{audits.length ? audits.map(entry => <article key={entry.id} className="platform-request"><div><h3>{entry.action} · {entry.tenantId || 'Registration'}</h3><p>{entry.actor}</p></div><time>{dateLabel(entry.at)}</time></article>) : <p>No administrative activity recorded yet.</p>}</>}</section></PlatformShell>;
}
