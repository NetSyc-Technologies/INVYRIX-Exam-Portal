import { collection as firebaseCollection, doc as firebaseDoc, Firestore } from 'firebase/firestore';
const reserved = new Set(['admin', 'superadmin', 'register', 'terms', 'privacy', 'download', 'desktop', 'exam', 'results', 'assets', 'api', 'mobile', 'login']);
export function tenantFromPath(pathname: string) {
    const first = pathname.split('/').filter(Boolean)[0] || '';
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(first) && first.length >= 3 && first.length <= 64 && !reserved.has(first) ? first : null;
}
export const tenantId = tenantFromPath(window.location.pathname);
export const tenantBase = tenantId ? `/${tenantId}` : '';
export function tenantPath(path: string) {
    if (!tenantId) throw new Error('Select an institute before accessing exam data.');
    return `institutes/${tenantId}/${path}`;
}
export const collection = (db: Firestore, path: string, ...segments: string[]) => firebaseCollection(db, tenantPath(path), ...segments);
export const doc = (db: Firestore, path: string, ...segments: string[]) => firebaseDoc(db, tenantPath(path), ...segments);
