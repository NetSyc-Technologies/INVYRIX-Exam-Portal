import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api, TERMS_VERSION } from '../../services/platform';
import PlatformShell from './PlatformShell';
export const emptyRegistration = { name: '', type: 'Institute', address: '', city: '', country: '', website: '', adminName: '', adminEmail: '', adminPhone: '' };
export function RegistrationFields({ value, onChange, lockEmail = false }: { value: typeof emptyRegistration; onChange: (value: typeof emptyRegistration) => void; lockEmail?: boolean }) {
    const fields = [['name', 'Institute / organization name'], ['type', 'Organization type'], ['address', 'Registered address'], ['city', 'City / state'], ['country', 'Country'], ['website', 'Website (optional)'], ['adminName', 'Administrator’s full name'], ['adminEmail', 'Administrator’s Google email'], ['adminPhone', 'Mobile number with country code']];
    return <div className="platform-form-grid">{fields.map(([key, label]) => <label key={key}>{label}{key === 'type' ? <select value={value.type} onChange={e => onChange({ ...value, type: e.target.value })}><option>Institute</option><option>Organization</option><option>Training provider</option></select> : <input required={key !== 'website'} type={key === 'adminEmail' ? 'email' : key === 'adminPhone' ? 'tel' : key === 'website' ? 'url' : 'text'} readOnly={key === 'adminEmail' && lockEmail} maxLength={key === 'address' ? 600 : 254} value={value[key as keyof typeof value]} onChange={e => onChange({ ...value, [key]: e.target.value })} />}</label>)}</div>;
}
export default function Register() {
    const { user, loading, signInWithGoogle } = useAuth();
    const [form, setForm] = useState(emptyRegistration);
    const [accepted, setAccepted] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [sent, setSent] = useState(false);
    useEffect(() => { if (user?.email) setForm(previous => ({ ...previous, adminEmail: user.email!, adminName: previous.adminName || user.displayName || '' })); }, [user?.uid]);
    const submit = async (event: FormEvent) => {
        event.preventDefault(); setBusy(true); setError('');
        try { await api('submitRegistration', { ...form, termsAccepted: accepted, termsVersion: TERMS_VERSION }); setSent(true); }
        catch (err: any) { setError(err.message); } finally { setBusy(false); }
    };
    return <PlatformShell><section className="platform-page-heading"><span className="platform-eyebrow">JOIN INVYRIX</span><h1>A dedicated home for your exams.</h1><p>Register your institute. Our team will review the details before activating your portal.</p></section><section className="platform-card registration-card">{sent ? <div className="platform-success"><span>✓</span><h2>Application submitted</h2><p>Your application is awaiting verification. Check your dashboard for the decision, institute link, and INVYRIX ID.</p><a className="btn btn-primary" href="/admin">View application status</a></div> : !user || user.isAnonymous ? <><h2>Start with your administrator’s account</h2><p>Use the Google account that will manage your institute. This verifies the email on your application.</p><button className="btn btn-primary" disabled={loading || busy} onClick={async () => { setBusy(true); try { await signInWithGoogle(); } catch (err: any) { setError(err.message); } finally { setBusy(false); } }}>Continue with Google</button>{error && <p role="alert" className="form-error">{error}</p>}</> : <form onSubmit={submit}><h2>Organization & administrator details</h2><p>The approved institute name can only be changed by the super admin.</p><fieldset disabled={busy}><RegistrationFields value={form} onChange={setForm} lockEmail /><label className="platform-checkbox"><input type="checkbox" required checked={accepted} onChange={e => setAccepted(e.target.checked)} /><span>I am authorized to register this organization and accept the <a href="/terms" target="_blank" rel="noreferrer">terms and conditions</a> (version {TERMS_VERSION}).</span></label>{error && <p role="alert" className="form-error">{error}</p>}<button className="btn btn-primary">{busy ? 'Submitting…' : 'Submit for verification →'}</button></fieldset></form>}</section></PlatformShell>;
}
