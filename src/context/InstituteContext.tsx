import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { tenantId } from '../services/tenant';
import { Institute, isInstituteActive } from '../services/platform';
const InstituteContext = createContext<{ institute: Institute | null; loading: boolean; error: string; active: boolean }>({ institute: null, loading: false, error: '', active: false });
export const useInstitute = () => useContext(InstituteContext);
export function InstituteProvider({ children }: { children: ReactNode }) {
    const [institute, setInstitute] = useState<Institute | null>(null);
    const [loading, setLoading] = useState(Boolean(tenantId));
    const [error, setError] = useState('');
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        if (!tenantId) return () => clearInterval(timer);
        const unsubscribe = onSnapshot(doc(db, 'institutes', tenantId), snapshot => {
            setInstitute(snapshot.exists() ? snapshot.data() as Institute : null);
            setError(snapshot.exists() ? '' : 'This institute address was not found. Check the link or INVYRIX ID.');
            setLoading(false);
        }, () => { setError('Unable to load this institute. Check your connection and retry.'); setLoading(false); });
        return () => { unsubscribe(); clearInterval(timer); };
    }, []);
    useEffect(() => { document.title = institute ? `${institute.name} | INVYRIX` : 'INVYRIX by NetSyc Technologies'; }, [institute?.name]);
    return <InstituteContext.Provider value={{ institute, loading, error, active: isInstituteActive(institute, now) }}>{children}</InstituteContext.Provider>;
}
