import { getDoc, getDocs } from 'firebase/firestore';
import { collection, doc } from './tenant';
import { db } from './firebase';
export async function getSessionDocs() {
    const [sessions, grades] = await Promise.all([getDocs(collection(db, 'exam_sessions')), getDocs(collection(db, 'session_grades'))]);
    const grading = new Map(grades.docs.map(item => [item.id, item.data()]));
    return { docs: sessions.docs.map(item => ({ id: item.id, data: () => ({ ...item.data(), ...grading.get(item.id) }) })) };
}
export async function getSessionDoc(id: string) {
    const [session, grade] = await Promise.all([getDoc(doc(db, 'exam_sessions', id)), getDoc(doc(db, 'session_grades', id))]);
    return { id: session.id, exists: () => session.exists(), data: () => ({ ...session.data(), ...grade.data() }) };
}
