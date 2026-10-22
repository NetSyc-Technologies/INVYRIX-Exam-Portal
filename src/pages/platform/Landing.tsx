import { FormEvent, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import PlatformShell from './PlatformShell';

export function InstituteLookup({ desktop = false }: { desktop?: boolean }) {
    const [id, setId] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const connect = async (event: FormEvent) => {
        event.preventDefault(); setBusy(true); setError('');
        try {
            const value = id.trim().toUpperCase();
            if (!/^INV-[A-F0-9]{12}$/.test(value)) throw new Error('Enter the INVYRIX ID supplied by your institute, for example INV-A1B2C3D4E5F6.');
            const record = await getDoc(doc(db, 'invyrix_ids', value));
            if (!record.exists()) throw new Error('That INVYRIX ID was not found. Check it with your institute.');
            const slug = record.data().tenantId;
            if (desktop && window.invyrixDesktop) await window.invyrixDesktop.linkInstitute(value, slug);
            window.location.assign(`/${slug}`);
        } catch (err: any) { setError(err.message || 'Unable to connect. Try again.'); setBusy(false); }
    };
    return <form onSubmit={connect} className="lookup-form"><label htmlFor="invyrix-id">{desktop ? 'Link this app to your institute' : 'Already a student? Find your institute'}</label><div><input id="invyrix-id" value={id} onChange={e => setId(e.target.value)} placeholder="Enter your INVYRIX ID" required maxLength={16} autoComplete="off" /><button className="btn btn-primary" disabled={busy}>{busy ? 'Connecting…' : 'Continue →'}</button></div>{error && <p role="alert" className="form-error">{error}</p>}<small>Your institute administrator can share this ID with you.</small></form>;
}
export default function Landing() {
    return <PlatformShell><section className="platform-hero"><div><span className="platform-eyebrow">ONE PLATFORM. YOUR INSTITUTION.</span><h1>Your exams.<br />Your identity.<br /><em>One INVYRIX.</em></h1><p>A dedicated exam portal for your institute or organization. Bring your branding, manage your exams, and keep every session in one place.</p><div className="platform-actions"><a className="btn btn-primary" href="/register">Create your institute portal ↗</a><a className="btn btn-secondary" href="/#how-it-works">Explore the platform ↓</a></div><p className="hero-note">For colleges, training teams, and organizations.</p></div><div className="hero-panel"><div className="hero-panel-top"><span className="live-dot" /> YOUR DEDICATED WORKSPACE<span>INVYRIX</span></div><div className="hero-institute"><img src="/logo.png" alt="" /><div><small>YOUR INSTITUTE</small><h2>A space of your own.</h2></div></div><div className="hero-address">invyrix.netsyc.com/<strong>your-institute</strong></div><div className="hero-feature"><span>01</span><div><h3>Institutional branding</h3><p>Your name and logo across your portal.</p></div><b>↗</b></div><div className="hero-feature"><span>02</span><div><h3>Exam management</h3><p>Questions, sessions, monitoring, and results.</p></div><b>↗</b></div><div className="hero-feature"><span>03</span><div><h3>A connected Windows app</h3><p>Enter your institute ID once to get started.</p></div><b>↗</b></div><div className="hero-panel-footer">Built for your next examination.</div></div></section><section className="platform-entry"><div><span className="platform-eyebrow">READY TO TAKE AN EXAM?</span><h2>Go straight to your institute.</h2></div><InstituteLookup /></section><section id="how-it-works" className="platform-section"><span className="platform-eyebrow">FROM APPLICATION TO EXAMINATION</span><h2>Your portal in three steps.</h2><div className="platform-steps">{[['01','Register your organization','Share your institute details, nominate an administrator, and accept the terms.'],['02','Get verified','NetSyc reviews your application and approves access for a specific subscription period.'],['03','Make it yours','Receive your unique link and INVYRIX ID. Add your logo, invite faculty, and create exams.']].map(([number,title,body])=><article key={number}><span>{number}</span><h3>{title}</h3><p>{body}</p></article>)}</div></section><section className="platform-callout"><div><h2>Your next exam starts here.</h2><p>Set up an institute profile with INVYRIX by NetSyc Technologies.</p></div><a className="btn btn-primary" href="/register">Start registration ↗</a></section></PlatformShell>;
}
