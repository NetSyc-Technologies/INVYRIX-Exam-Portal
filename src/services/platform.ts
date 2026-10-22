import {
    addDoc, arrayUnion, collection as rootCollection, deleteDoc, doc as rootDoc, getDoc,
    getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where,
    writeBatch,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { collection as tenantCollection, doc as tenantDoc, tenantId } from './tenant';
import { Exam } from '../types';

export const SUPER_ADMIN = 'admin@netsyc.com';
export const TERMS_VERSION = '2026-10-21';
const root = (name: string) => rootCollection(db, name);
const profileRef = (slug = tenantId) => {
    if (!slug) throw new Error('Select an institute before accessing exam data.');
    return rootDoc(db, 'institutes', slug);
};
const requireUser = () => {
    const user = auth.currentUser;
    if (!user) throw new Error('Please sign in and try again.');
    return user;
};
const emailOf = () => (requireUser().email || '').trim().toLowerCase();
const isSuperAdmin = () => emailOf() === SUPER_ADMIN;
const text = (value: unknown, max = 254) => typeof value === 'string' ? value.trim().slice(0, max) : '';

/** SHA-256 keeps answer values and exam passwords out of Firestore. */
export async function hashValue(value: string) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function normalizeAnswer(value: unknown) { return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase(); }
export async function hashAnswer(questionId: string, value: unknown) { return hashValue(`invyrix-answer:${questionId}:${normalizeAnswer(value)}`); }
export async function hashExamPassword(value: string) { return hashValue(`invyrix-password:${normalizeAnswer(value)}`); }

export function timestamp(value: any): number {
    if (value?.toMillis) return value.toMillis();
    if (value?._seconds !== undefined) return value._seconds * 1000;
    if (value?.seconds !== undefined) return value.seconds * 1000;
    return new Date(value).getTime();
}
export function isInstituteActive(profile: Institute | null, now = Date.now()) { return profile?.status === 'active' && timestamp(profile.expiresAt) > now; }
export interface Institute { slug: string; name: string; invyrixId: string; logoUrl: string; status: 'active' | 'paused'; expiresAt: any; message: string; }

function safeExam(exam: any, includeQuestions = true) {
    const { examPassword, examPasswordHash, allowedStudents, assignedFaculty, createdBy, ...rest } = exam || {};
    return { ...rest, questions: includeQuestions ? (rest.questions || []).map((question: any) => { const { correctAnswer, ...publicQuestion } = question; return publicQuestion; }) : [] };
}
async function gradeAnswers(exam: any, answers: any[]) {
    let score = 0;
    for (const answer of answers || []) {
        const question = (exam.questions || []).find((item: any) => item.id === answer.questionId);
        if (!question) continue;
        const expected = question.answerKeyHash || (question.correctAnswer !== undefined ? await hashAnswer(question.id, question.correctAnswer) : '');
        if (expected && expected === await hashAnswer(question.id, answer.answer)) score += Number(question.points) || 0;
    }
    return score;
}
async function cleanAnswers(exam: any, input: any[]) {
    if (!Array.isArray(input)) throw new Error('Invalid answers.');
    const seen = new Set<string>();
    return input.slice(0, (exam.questions || []).length).map(answer => {
        const question = (exam.questions || []).find((item: any) => item.id === answer.questionId);
        if (!question || seen.has(answer.questionId)) throw new Error('Invalid answer.');
        seen.add(answer.questionId);
        return { questionId: question.id, answer: typeof answer.answer === 'number' ? answer.answer : text(answer.answer, 10000), answeredAt: Timestamp.now() };
    });
}

/** Spark mode: all application operations use Firebase client SDK and Rules. */
export async function api<T = any>(name: string, data: Record<string, any> = {}): Promise<T> {
    const user = requireUser();
    switch (name) {
        case 'submitRegistration': {
            const adminEmail = text(data.adminEmail).toLowerCase();
            if (!user.emailVerified || adminEmail !== (user.email || '').toLowerCase()) throw new Error('Use the verified Google account nominated for this organization.');
            if (data.termsAccepted !== true) throw new Error('Accept the current terms and conditions.');
            await setDoc(rootDoc(db, 'registrations', user.uid), { name: text(data.name, 160), type: text(data.type, 80), address: text(data.address, 600), city: text(data.city, 160), country: text(data.country, 100), website: text(data.website, 254), adminName: text(data.adminName, 160), adminEmail, adminPhone: text(data.adminPhone, 40), status: 'pending', applicantUid: user.uid, termsVersion: TERMS_VERSION, termsAcceptedAt: serverTimestamp(), createdAt: serverTimestamp() });
            return { id: user.uid } as T;
        }
        case 'approveInstitute': {
            if (!isSuperAdmin()) throw new Error('Super-admin access is required.');
            const slug = text(data.slug, 64).toLowerCase(), expires = new Date(data.expiresAt);
            if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !Number.isFinite(expires.getTime()) || expires.getTime() <= Date.now()) throw new Error('Use a valid unique portal address and a future expiry date.');
            const registration = data.registrationId ? await getDoc(rootDoc(db, 'registrations', text(data.registrationId))) : null;
            if (registration && (!registration.exists() || registration.data()?.status !== 'pending')) throw new Error('This application has already been reviewed or is missing.');
            const details = registration?.data() || data, ref = profileRef(slug);
            if ((await getDoc(ref)).exists()) throw new Error('This institute address is already used. Choose another.');
            const invyrixId = `INV-${crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`, batch = writeBatch(db);
            batch.set(ref, { name: text(details.name, 160), slug, invyrixId, logoUrl: '', status: 'active', expiresAt: Timestamp.fromDate(expires), message: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
            batch.set(rootDoc(db, 'institute_contacts', slug), { name: text(details.name, 160), type: text(details.type, 80), address: text(details.address, 600), city: text(details.city, 160), country: text(details.country, 100), website: text(details.website, 254), adminName: text(details.adminName, 160), adminEmail: text(details.adminEmail).toLowerCase(), adminPhone: text(details.adminPhone, 40) });
            batch.set(rootDoc(db, 'institutes', slug, 'admin_users', text(details.adminEmail).toLowerCase()), { email: text(details.adminEmail).toLowerCase(), name: text(details.adminName, 160), role: 'admin', permissions: ['all'], createdAt: serverTimestamp() });
            batch.set(rootDoc(db, 'invyrix_ids', invyrixId), { tenantId: slug });
            batch.set(rootDoc(db, 'directory', text(details.adminEmail).toLowerCase()), { institutes: arrayUnion(slug) }, { merge: true });
            if (registration) batch.update(registration.ref, { status: 'approved', tenantId: slug, invyrixId, reviewedAt: serverTimestamp(), reviewedBy: SUPER_ADMIN });
            batch.set(rootDoc(db, 'audit_log', crypto.randomUUID()), { action: 'approve', tenantId: slug, actor: SUPER_ADMIN, invyrixId, at: serverTimestamp() });
            await batch.commit(); return { tenantId: slug, invyrixId } as T;
        }
        case 'rejectRegistration': {
            if (!isSuperAdmin()) throw new Error('Super-admin access is required.');
            await updateDoc(rootDoc(db, 'registrations', text(data.registrationId)), { status: 'rejected', reason: text(data.reason, 1000), reviewedAt: serverTimestamp(), reviewedBy: SUPER_ADMIN }); return { ok: true } as T;
        }
        case 'updateInstitute': {
            if (!isSuperAdmin()) throw new Error('Super-admin access is required.');
            const slug = text(data.tenantId, 64), ref = profileRef(slug), current = await getDoc(ref); if (!current.exists()) throw new Error('Institute not found.');
            const update: Record<string, any> = { updatedAt: serverTimestamp() }, action = data.action;
            if (action === 'pause') { update.status = 'paused'; update.message = text(data.message, 1000) || 'This account is paused. Contact your institute administrator.'; }
            else if (action === 'resume') { if (timestamp(current.data().expiresAt) <= Date.now()) throw new Error('Renew the subscription before resuming.'); update.status = 'active'; update.message = ''; }
            else if (action === 'renew') { const expires = new Date(data.expiresAt); if (!Number.isFinite(expires.getTime()) || expires.getTime() <= Date.now()) throw new Error('Choose a future expiry date.'); update.expiresAt = Timestamp.fromDate(expires); update.status = 'active'; update.message = ''; }
            else if (action === 'rename') { update.name = text(data.name, 160); if (!update.name) throw new Error('Enter the institute name.'); }
            else if (action === 'message') update.message = text(data.message, 1000); else throw new Error('Unknown action.');
            const batch = writeBatch(db); batch.update(ref, update);
            if (action === 'rename') batch.update(rootDoc(db, 'institute_contacts', slug), { name: update.name });
            if (action === 'renew') batch.set(rootDoc(db, 'renewals', slug), { status: 'approved', reviewedAt: serverTimestamp(), expiresAt: update.expiresAt }, { merge: true });
            batch.set(rootDoc(db, 'audit_log', crypto.randomUUID()), { action, tenantId: slug, actor: SUPER_ADMIN, at: serverTimestamp() }); await batch.commit(); return { ok: true } as T;
        }
        case 'requestRenewal': {
            if (!tenantId) throw new Error('Select an institute before requesting renewal.'); const profile = await getDoc(profileRef()); if (!profile.exists()) throw new Error('Institute not found.');
            await setDoc(rootDoc(db, 'renewals', tenantId), { tenantId, name: profile.data().name, adminEmail: emailOf(), note: text(data.note, 1000), status: 'pending', createdAt: serverTimestamp() }); return { ok: true } as T;
        }
        case 'listMyInstitutes': {
            const snapshot = await getDocs(query(root('institute_contacts'), where('adminEmail', '==', emailOf()))); const result = await Promise.all(snapshot.docs.map(async item => { const profile = await getDoc(profileRef(item.id)); return profile.exists() ? { ...profile.data(), role: 'admin' } : null; })); return result.filter(Boolean) as T;
        }
        case 'manageFaculty': {
            if (!tenantId) throw new Error('Select an institute before managing faculty.'); const address = text(data.email).toLowerCase(), previous = text(data.previousEmail || address).toLowerCase();
            if (data.action === 'remove') { await deleteDoc(tenantDoc(db, 'admin_users', address)); return { ok: true } as T; }
            if (!text(data.name)) throw new Error('Enter the faculty name.'); if (address !== previous) await deleteDoc(tenantDoc(db, 'admin_users', previous)); await setDoc(tenantDoc(db, 'admin_users', address), { email: address, name: text(data.name, 160), role: 'faculty', permissions: ['monitor_exam', 'view_results', 'grade_exam'], createdAt: serverTimestamp() }); return { ok: true } as T;
        }
        case 'listAvailableExams': {
            if (!tenantId) throw new Error('Select an institute before accessing exams.'); const profile = await getDoc(profileRef()); if (!profile.exists() || !isInstituteActive(profile.data() as Institute)) throw new Error(profile.data()?.message || 'This institute is inactive.'); const exams = await getDocs(tenantCollection(db, 'exams')); return exams.docs.filter(item => item.data().status === 'active').map(item => ({ id: item.id, ...safeExam(item.data(), false) })) as T;
        }
        case 'startExam': {
            if (!tenantId) throw new Error('Select an institute before starting an exam.'); const profile = await getDoc(profileRef()), examSnap = await getDoc(tenantDoc(db, 'exams', text(data.examId))), exam = examSnap.data(); if (!profile.exists() || !isInstituteActive(profile.data() as Institute)) throw new Error(profile.data()?.message || 'This institute is inactive.'); if (!exam || exam.status !== 'active') throw new Error('This exam is not accepting entries.');
            const passwordHash = await hashExamPassword(text(data.password, 500)); if (exam.examPasswordHash ? passwordHash !== exam.examPasswordHash : text(data.password, 500) !== exam.examPassword) throw new Error('Incorrect exam password.');
            const settings = exam.settings || {}, roll = text(data.rollNo, 100).toUpperCase(), name = text(data.studentName, 160), roster = exam.allowedStudents || [];
            if ((settings.requireRollNo !== false && !roll) || (settings.requireName !== false && !name) || (settings.requirePhone && !text(data.phone, 30)) || (settings.requireEmail && !/^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(text(data.email).toLowerCase()))) throw new Error('Complete all required student details.');
            if (roster.length && !roster.some((item: any) => String(item.rollNo).toUpperCase() === roll)) throw new Error('Your roll number is not on the allowed list.');
            if (settings.deviceRestriction === 'mobile_only' && data.isMobile !== true) throw new Error('This exam requires a mobile device.');
            if (settings.deviceRestriction === 'desktop_only' && data.isMobile === true) throw new Error('This exam requires a desktop or laptop.');
            if (settings.schedulingEnabled && settings.scheduledEndTime && timestamp(settings.scheduledEndTime) <= Date.now()) throw new Error('This exam has ended.');
            if (settings.schedulingEnabled && settings.lateEntryPolicy === 'disallow' && settings.scheduledStartTime && timestamp(settings.scheduledStartTime) < Date.now()) throw new Error('Late entry is not allowed for this exam.');
            const session = await addDoc(tenantCollection(db, 'exam_sessions'), { examId: text(data.examId), ownerUid: user.uid, studentRollNo: text(data.rollNo, 100).toUpperCase() || 'N/A', studentName: text(data.studentName, 160) || 'Anonymous', studentPhone: text(data.phone, 30), studentEmail: text(data.email, 254).toLowerCase(), startTime: serverTimestamp(), createdAt: serverTimestamp(), deadline: Timestamp.fromMillis(Date.now() + (Number(exam.duration) || 60) * 60000), status: 'started', answers: [], cheatingEvents: [], tabSwitchCount: 0, warningCount: 0, deviceInfo: data.deviceInfo || {}, ...(exam.settings?.mobileLocking && data.isMobile !== true ? { mobileLockCode: crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase(), mobileLockStatus: 'pending' } : {}) }); return { sessionId: session.id } as T;
        }
        case 'getStudentExam': { const session = await getDoc(tenantDoc(db, 'exam_sessions', text(data.sessionId))); if (!session.exists() || session.data().ownerUid !== user.uid) throw new Error('This exam session belongs to another user.'); const exam = await getDoc(tenantDoc(db, 'exams', session.data().examId)); if (!exam.exists()) throw new Error('Exam not found.'); return safeExam({ ...exam.data(), id: exam.id }) as T; }
        case 'beginExam': { const session = await getDoc(tenantDoc(db, 'exam_sessions', text(data.sessionId))); if (!session.exists() || session.data().ownerUid !== user.uid) throw new Error('This exam session belongs to another user.'); const exam = await getDoc(tenantDoc(db, 'exams', session.data().examId)); if (!exam.exists()) throw new Error('Exam not found.'); if (!session.data().beganAt) await updateDoc(session.ref, { beganAt: serverTimestamp(), startTime: serverTimestamp(), deadline: Timestamp.fromMillis(Date.now() + (Number(exam.data().duration) || 60) * 60000) }); return { ok: true } as T; }
        case 'saveAnswers': { const session = await getDoc(tenantDoc(db, 'exam_sessions', text(data.sessionId))); if (!session.exists() || session.data().ownerUid !== user.uid) throw new Error('This exam session belongs to another user.'); const exam = await getDoc(tenantDoc(db, 'exams', session.data().examId)); if (!exam.exists()) throw new Error('Exam not found.'); await updateDoc(session.ref, { answers: await cleanAnswers(exam.data(), data.answers) }); return { ok: true } as T; }
        case 'submitExam': { const session = await getDoc(tenantDoc(db, 'exam_sessions', text(data.sessionId))); if (!session.exists() || session.data().ownerUid !== user.uid) throw new Error('This exam session belongs to another user.'); const exam = await getDoc(tenantDoc(db, 'exams', session.data().examId)); if (!exam.exists()) throw new Error('Exam not found.'); const answers = await cleanAnswers(exam.data(), data.answers || session.data().answers || []), score = await gradeAnswers(exam.data(), answers); await updateDoc(session.ref, { status: 'completed', endTime: serverTimestamp(), answers, mobileLockStatus: 'unlocked' }); await setDoc(tenantDoc(db, 'session_grades', text(data.sessionId)), { score }); return { ok: true } as T; }
        case 'getStudentResult': { const session = await getDoc(tenantDoc(db, 'exam_sessions', text(data.sessionId))); if (!session.exists() || session.data().ownerUid !== user.uid) throw new Error('This session belongs to another user.'); const exam = await getDoc(tenantDoc(db, 'exams', session.data().examId)); if (session.data().status === 'started' || exam.data()?.settings?.showResults !== true) return {} as T; const result = await getDoc(tenantDoc(db, 'session_grades', text(data.sessionId))); return (result.data() || {}) as T; }
        case 'regeneratePairingCode': { const session = await getDoc(tenantDoc(db, 'exam_sessions', text(data.sessionId))); if (!session.exists() || session.data().ownerUid !== user.uid) throw new Error('This session belongs to another user.'); const code = crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase(); await updateDoc(session.ref, { mobileLockCode: code, mobileUid: null, mobileLockStatus: 'pending' }); return { code } as T; }
        case 'saveGrades': { if (!tenantId) throw new Error('Select an institute before grading.'); const session = await getDoc(tenantDoc(db, 'exam_sessions', text(data.sessionId))); if (!session.exists()) throw new Error('Session not found.'); const previous = await getDoc(tenantDoc(db, 'session_grades', text(data.sessionId))), scores = data.scores || {}; const answers = (previous.data()?.answers || session.data().answers || []).map((answer: any) => ({ ...answer, score: scores[answer.questionId] === undefined ? answer.score : Number(scores[answer.questionId]) })), total = data.totalScore === undefined ? answers.reduce((sum: number, answer: any) => sum + (Number(answer.score) || 0), 0) : Number(data.totalScore); await setDoc(tenantDoc(db, 'session_grades', text(data.sessionId)), { score: total, answers }); await updateDoc(session.ref, { answers: answers.map(({ score, ...answer }: any) => answer), scoreModified: true, scoreModifiedAt: serverTimestamp() }); return { ok: true } as T; }
        default: throw new Error(`Frontend-only mode does not support “${name}”.`);
    }
}

export async function studentExam(sessionId: string) { const exam = await api<Exam>('getStudentExam', { sessionId }); for (const field of ['scheduledStartTime', 'scheduledEndTime'] as const) if (exam.settings?.[field]) exam.settings[field] = new Date(timestamp(exam.settings[field])).toISOString(); return { exists: () => true, id: exam.id, data: () => exam }; }


