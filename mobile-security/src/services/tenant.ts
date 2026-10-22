import { doc as firebaseDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
export const tenantId = new URLSearchParams(window.location.search).get('institute') || '';
export const doc = (db: Firestore, collection: string, id: string) => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tenantId)) throw new Error('Open the mobile link shown on your exam screen.');
    return firebaseDoc(db, 'institutes', tenantId, collection, id);
};
