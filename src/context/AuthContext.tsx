import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { signOut as firebaseSignOut, onAuthStateChanged, User, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signInAnonymously } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../services/firebase';
import { tenantId } from '../services/tenant';
import { SUPER_ADMIN } from '../services/platform';
import { AdminUser } from '../types';
interface AuthContextType {
    user: User | null; adminData: AdminUser | null; loading: boolean; error: string | null;
    isSuperAdmin: boolean; signInWithGoogle: () => Promise<void>; signOut: () => Promise<void>; clearError: () => void;
}
const AuthContext = createContext<AuthContextType | undefined>(undefined);
export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within an AuthProvider');
    return context;
}
export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [adminData, setAdminData] = useState<AdminUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        let membership: (() => void) | undefined;
        let generation = 0;
        const unsubscribe = onAuthStateChanged(auth, current => {
            const version = ++generation;
            membership?.();
            setUser(current); setAdminData(null); setLoading(true);
            if (!current) {
                if (tenantId) signInAnonymously(auth).catch(err => { if (version === generation) { setError(err.message); setLoading(false); } });
                else setLoading(false);
                return;
            }
            if (current.emailVerified && current.email?.toLowerCase() === SUPER_ADMIN) {
                setAdminData({ id: current.uid, email: SUPER_ADMIN, name: 'NetSyc Super Admin', role: 'superadmin', permissions: ['all'], createdAt: new Date() });
                setLoading(false); return;
            }
            if (tenantId && current.emailVerified && current.email) {
                membership = onSnapshot(doc(db, 'institutes', tenantId, 'admin_users', current.email.toLowerCase()), snapshot => {
                    if (version !== generation) return;
                    setAdminData(snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } as AdminUser : null);
                    setLoading(false);
                }, () => { if (version === generation) { setError('Unable to verify staff access.'); setAdminData(null); setLoading(false); } });
            } else setLoading(false);
        });
        return () => { generation++; membership?.(); unsubscribe(); };
    }, []);
    const signInWithGoogle = async () => {
        setError(null);
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        try {
            await signInWithPopup(auth, provider);
        } catch (err: any) {
            const code = String(err?.code || '');
            // Embedded browsers and popup-blocking policies frequently surface this as
            // auth/internal-error. Redirect is the supported fallback for those clients.
            if (['auth/internal-error', 'auth/popup-blocked', 'auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/operation-not-supported-in-this-environment'].includes(code)) {
                await signInWithRedirect(auth, provider);
                return;
            }
            if (code === 'auth/operation-not-allowed') throw new Error('Google sign-in is not enabled in the INVYRIX Firebase project. Enable Google under Firebase Console → Authentication → Sign-in method.');
            if (code === 'auth/unauthorized-domain') throw new Error(`This site is not an authorized Firebase domain. Add ${window.location.hostname} under Firebase Console → Authentication → Settings → Authorized domains.`);
            if (code === 'auth/configuration-not-found') throw new Error('Firebase Authentication is not enabled for this project. Enable Authentication and the Google provider in the Firebase console.');
            if (code === 'auth/invalid-api-key' || code === 'auth/api-key-not-valid') throw new Error('The Firebase web API key is invalid for this deployment. Check the project configuration in the root .env file.');
            throw new Error(err?.message || 'Google sign-in could not start. Please try again.');
        }
    };
    const signOut = async () => { await firebaseSignOut(auth); setAdminData(null); };
    return <AuthContext.Provider value={{ user, adminData, loading, error, isSuperAdmin: adminData?.role === 'superadmin', signInWithGoogle, signOut, clearError: () => setError(null) }}>{children}</AuthContext.Provider>;
}
