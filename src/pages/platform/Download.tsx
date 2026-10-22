import PlatformShell from './PlatformShell';
import { InstituteLookup } from './Landing';
export default function Download({ setup = false }: { setup?: boolean }) {
    const downloadUrl = import.meta.env.VITE_WINDOWS_DOWNLOAD_URL;
    return <PlatformShell><section className="platform-card download-card"><img src="/logo.png" width="88" height="88" alt="INVYRIX" /><h1>{setup ? 'Welcome to INVYRIX.' : 'Your institute. On Windows.'}</h1><p>{setup ? 'Enter your INVYRIX ID once. This app will remember your institute and load its latest name and logo whenever you open it.' : 'Install INVYRIX, enter the ID shared by your institute, and open your branded exam portal.'}</p>{setup ? <InstituteLookup desktop /> : <>{downloadUrl ? <a className="btn btn-primary" href={downloadUrl}>Download INVYRIX for Windows (.exe)</a> : <p className="application-status">The Windows installer has not been published to this website yet. Contact your institute administrator for the installation file.</p>}<p>Windows 10 or later · 64-bit · Internet connection required</p><a href="/">Use INVYRIX in your browser →</a></>}</section></PlatformShell>;
}
