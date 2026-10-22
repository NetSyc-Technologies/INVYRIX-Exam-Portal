import { ReactNode } from 'react';
import Footer from '../../components/Footer';
export default function PlatformShell({ children }: { children: ReactNode }) {
    return <div className="platform"><header className="platform-header"><a href="/" className="platform-brand"><img src="/logo.png" alt="" /><span><img src="/namelogo.png" alt="INVYRIX" /><small>by NetSyc Technologies</small></span></a><nav aria-label="Main navigation"><a href="/#how-it-works">How it works</a><a href="/download">Windows app</a><a href="/admin">Sign in</a><a className="btn btn-primary" href="/register">Register institute ↗</a></nav></header><main className="platform-main">{children}</main><Footer /></div>;
}
