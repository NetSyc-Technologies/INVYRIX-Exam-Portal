import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { randomBytes, createHash } from 'node:crypto';
import { SUPER_ADMIN, TERMS_VERSION, validSlug, isActive, publicExam, grade, millis, deadline } from './policy.js';

initializeApp();
const db = getFirestore();
const options = { region: 'asia-south1', maxInstances: 20 };
const fail = (code, message) => { throw new HttpsError(code, message); };
const text = (value, max = 160) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const email = value => text(value, 254).toLowerCase();
const validEmail = value => /^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(value);
const hash = value => createHash('sha256').update(value).digest('hex');
function identity(request) {
  if (!request.auth) fail('unauthenticated', 'Please sign in and try again.');
  return request.auth;
}
function verified(request) {
  const auth = identity(request);
  if (!auth.token.email_verified || !validEmail(email(auth.token.email))) fail('permission-denied', 'Use a verified Google account.');
  return email(auth.token.email);
}
function superAdmin(request) {
  if (verified(request) !== SUPER_ADMIN) fail('permission-denied', 'Super-admin access is required.');
}
function tenantRef(request) {
  const slug = request.data?.tenantId;
  if (!validSlug(slug)) fail('invalid-argument', 'Invalid institute address.');
  return db.doc(`institutes/${slug}`);
}
async function staff(request, adminOnly = false) {
  const address = verified(request);
  const ref = tenantRef(request);
  if (address !== SUPER_ADMIN) {
    const membership = await ref.collection('admin_users').doc(address).get();
    if (!membership.exists || (adminOnly && membership.data().role !== 'admin')) fail('permission-denied', 'You do not have access to this institute.');
  }
  return ref;
}
async function active(ref) {
  const snapshot = await ref.get();
  if (!snapshot.exists) fail('not-found', 'Institute not found.');
  if (!isActive(snapshot.data())) fail('failed-precondition', snapshot.data().message || 'Subscription expired or account paused. Please contact your institute administrator.');
  return snapshot.data();
}
function expiry(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) fail('invalid-argument', 'Choose an expiry date in the future.');
  return Timestamp.fromDate(date);
}
function registration(data) {
  const result = Object.fromEntries(['name', 'type', 'address', 'city', 'country', 'website', 'adminName', 'adminEmail', 'adminPhone'].map(key => [key, text(data[key], key === 'address' ? 600 : 254)]));
  result.adminEmail = email(result.adminEmail);
  if (!result.name || !result.type || !result.address || !result.city || !result.country || !result.adminName || !validEmail(result.adminEmail) || !/^[+\d ()-]{7,24}$/.test(result.adminPhone)) fail('invalid-argument', 'Complete the organization and administrator details.');
  return result;
}
function audit(tx, request, action, tenantId, details = {}) {
  tx.create(db.collection('audit_log').doc(), { action, tenantId, actor: email(request.auth?.token.email), at: Timestamp.now(), ...details });
}
function cleanAnswers(input, questions) {
  if (!Array.isArray(input) || input.length > questions.length) fail('invalid-argument', 'Invalid answers.');
  const ids = new Set();
  return input.map(answer => {
    const question = questions.find(item => item.id === answer.questionId);
    if (!question || ids.has(answer.questionId) || !['string','number'].includes(typeof answer.answer)) fail('invalid-argument', 'Invalid question or answer.');
    if (question.type === 'mcq' && (!Number.isInteger(Number(answer.answer)) || Number(answer.answer) < 0 || Number(answer.answer) >= question.options.length || String(answer.answer).trim() === '')) fail('invalid-argument', 'Invalid answer option.');
    ids.add(answer.questionId);
    return { questionId: question.id, answer: typeof answer.answer === 'number' ? answer.answer : text(answer.answer, 10000), answeredAt: Timestamp.now() };
  });
}

export const submitRegistration = onCall(options, async request => {
  const address = verified(request);
  const data = registration(request.data);
  if (data.adminEmail !== address) fail('invalid-argument', 'Sign in using the nominated administrator’s Google account.');
  if (request.data.termsAccepted !== true || request.data.termsVersion !== TERMS_VERSION) fail('invalid-argument', 'Accept the current terms and conditions.');
  const ref = db.doc(`registrations/${request.auth.uid}`);
  await db.runTransaction(async tx => {
    const existing = await tx.get(ref);
    if (existing.exists && existing.data().status !== 'rejected') fail('already-exists', 'You already have an application. Check its status in your dashboard.');
    tx.set(ref, { ...data, status: 'pending', applicantUid: request.auth.uid, termsVersion: TERMS_VERSION, termsAcceptedAt: Timestamp.now(), createdAt: Timestamp.now() });
  });
  return { id: ref.id };
});

export const approveInstitute = onCall(options, async request => {
  superAdmin(request);
  const slug = text(request.data.slug).toLowerCase();
  if (!validSlug(slug)) fail('invalid-argument', 'Use a unique address of 3–64 lowercase letters, numbers and hyphens.');
  const expiresAt = expiry(request.data.expiresAt);
  const invyrixId = `INV-${randomBytes(6).toString('hex').toUpperCase()}`;
  const ref = db.doc(`institutes/${slug}`);
  const applicationRef = request.data.registrationId ? db.doc(`registrations/${text(request.data.registrationId)}`) : null;
  await db.runTransaction(async tx => {
    const application = applicationRef ? await tx.get(applicationRef) : null;
    if (applicationRef && (!application?.exists || application.data().status !== 'pending')) fail('failed-precondition', 'This application has already been reviewed or is missing.');
    const details = registration(application ? application.data() : request.data);
    const [existing, idRecord] = await Promise.all([tx.get(ref), tx.get(db.doc(`invyrix_ids/${invyrixId}`))]);
    if (existing.exists || idRecord.exists) fail('already-exists', 'This institute address is already used. Choose another.');
    tx.create(ref, { name: details.name, slug, invyrixId, logoUrl: '', status: 'active', expiresAt, message: '', createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    tx.create(db.doc(`institute_contacts/${slug}`), details);
    tx.create(ref.collection('admin_users').doc(details.adminEmail), { email: details.adminEmail, name: details.adminName, role: 'admin', permissions: ['all'], createdAt: Timestamp.now() });
    tx.set(db.doc(`directory/${details.adminEmail}`), { institutes: FieldValue.arrayUnion(slug) }, { merge: true });
    tx.create(db.doc(`invyrix_ids/${invyrixId}`), { tenantId: slug });
    if (applicationRef) tx.update(applicationRef, { status: 'approved', tenantId: slug, invyrixId, reviewedAt: Timestamp.now(), reviewedBy: SUPER_ADMIN });
    audit(tx, request, 'approve', slug, { expiresAt, invyrixId, source: applicationRef ? 'application' : 'manual' });
  });
  return { tenantId: slug, invyrixId };
});

export const rejectRegistration = onCall(options, async request => {
  superAdmin(request);
  const reason = text(request.data.reason, 1000);
  if (!reason) fail('invalid-argument', 'Enter a reason for the applicant.');
  const ref = db.doc(`registrations/${text(request.data.registrationId)}`);
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (snapshot.data()?.status !== 'pending') fail('failed-precondition', 'This application has already been reviewed.');
    tx.update(ref, { status: 'rejected', reason, reviewedAt: Timestamp.now(), reviewedBy: SUPER_ADMIN });
    audit(tx, request, 'reject-registration', '', { registrationId: ref.id, reason });
  });
  return { ok: true };
});

export const updateInstitute = onCall(options, async request => {
  superAdmin(request);
  const ref = tenantRef(request);
  const action = request.data.action;
  const update = { updatedAt: Timestamp.now() };
  if (action === 'pause') { update.status = 'paused'; update.message = text(request.data.message, 1000) || 'This account is paused. Contact your institute administrator.'; }
  else if (action === 'resume') { update.status = 'active'; update.message = ''; }
  else if (action === 'renew') { update.expiresAt = expiry(request.data.expiresAt); update.status = 'active'; update.message = ''; }
  else if (action === 'rename') { update.name = text(request.data.name); if (!update.name) fail('invalid-argument', 'Enter the institute name.'); }
  else if (action === 'message') update.message = text(request.data.message, 1000);
  else fail('invalid-argument', 'Unknown action.');
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const renewalRef = db.doc(`renewals/${ref.id}`);
    const renewal = action === 'renew' ? await tx.get(renewalRef) : null;
    if (!snapshot.exists) fail('not-found', 'Institute not found.');
    if (action === 'resume' && millis(snapshot.data().expiresAt) <= Date.now()) fail('failed-precondition', 'The subscription has expired. Renew it before resuming.');
    tx.update(ref, update);
    if (action === 'rename') tx.update(db.doc(`institute_contacts/${ref.id}`), { name: update.name });
    if (renewal?.exists) tx.update(renewalRef, { status: 'approved', reviewedAt: Timestamp.now(), expiresAt: update.expiresAt });
    audit(tx, request, action, ref.id, { before: snapshot.data(), after: update });
  });
  return { ok: true };
});

export const requestRenewal = onCall(options, async request => {
  const ref = await staff(request, true);
  const renewalRef = db.doc(`renewals/${ref.id}`);
  await db.runTransaction(async tx => {
    const [institute, existing] = await Promise.all([tx.get(ref), tx.get(renewalRef)]);
    if (!institute.exists) fail('not-found', 'Institute not found.');
    if (existing.data()?.status === 'pending') fail('already-exists', 'A renewal request is already awaiting review.');
    tx.set(renewalRef, { tenantId: ref.id, name: institute.data().name, adminEmail: verified(request), note: text(request.data.note, 1000), status: 'pending', createdAt: Timestamp.now() });
    audit(tx, request, 'request-renewal', ref.id);
  });
  return { ok: true };
});

export const listMyInstitutes = onCall(options, async request => {
  const address = verified(request);
  const directory = await db.doc(`directory/${address}`).get();
  const profiles = await Promise.all((directory.data()?.institutes || []).map(async slug => {
    const membership = await db.doc(`institutes/${slug}/admin_users/${address}`).get();
    if (!membership.exists) return null;
    const profile = await db.doc(`institutes/${slug}`).get();
    return profile.exists ? { ...profile.data(), role: membership.data().role } : null;
  }));
  return profiles.filter(Boolean);
});

export const manageFaculty = onCall(options, async request => {
  const ref = await staff(request, true);
  await active(ref);
  const address = email(request.data.email);
  const previous = email(request.data.previousEmail || address);
  if (!validEmail(address) || !validEmail(previous)) fail('invalid-argument', 'Enter a valid email address.');
  const action = request.data.action;
  if (!['save', 'remove'].includes(action)) fail('invalid-argument', 'Unknown action.');
  await db.runTransaction(async tx => {
    const currentRef = ref.collection('admin_users').doc(previous);
    const nextRef = ref.collection('admin_users').doc(address);
    const [current, next] = await Promise.all([tx.get(currentRef), tx.get(nextRef)]);
    if (current.exists && current.data().role !== 'faculty') fail('permission-denied', 'Institute administrators cannot be changed here.');
    if (next.exists && (address !== previous || next.data().role !== 'faculty')) fail('already-exists', 'This account already has access.');
    if (action === 'remove' || address !== previous) { tx.delete(currentRef); tx.set(db.doc(`directory/${previous}`), { institutes: FieldValue.arrayRemove(ref.id) }, { merge: true }); }
    if (action === 'save') {
      const name = text(request.data.name);
      if (!name) fail('invalid-argument', 'Enter the faculty name.');
      tx.set(nextRef, { email: address, name, role: 'faculty', permissions: ['monitor_exam', 'view_results', 'grade_exam'], createdAt: current.data()?.createdAt || Timestamp.now() });
      tx.set(db.doc(`directory/${address}`), { institutes: FieldValue.arrayUnion(ref.id) }, { merge: true });
    }
    audit(tx, request, `faculty-${action}`, ref.id, { email: address });
  });
  return { ok: true };
});

// Student access is authenticated anonymously. Passwords, rosters and answer keys never leave the server.
export const listAvailableExams = onCall(options, async request => {
  identity(request);
  const ref = tenantRef(request);
  await active(ref);
  const exams = await ref.collection('exams').where('status', '==', 'active').get();
  return exams.docs.map(doc => ({ id: doc.id, ...publicExam(doc.data()) }));
});
async function rateLimit(request, action, limit = 12) {
  const ref = db.doc(`rate_limits/${hash(`${request.auth.uid}:${action}`)}`);
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const previous = snapshot.data();
    const fresh = !previous || millis(previous.resetAt) <= Date.now();
    if (!fresh && previous.count >= limit) fail('resource-exhausted', 'Too many attempts. Please wait a minute and retry.');
    tx.set(ref, { count: fresh ? 1 : previous.count + 1, resetAt: fresh ? Timestamp.fromMillis(Date.now() + 60000) : previous.resetAt });
  });
}
export const startExam = onCall(options, async request => {
  const auth = identity(request);
  const ref = tenantRef(request);
  await rateLimit(request, 'start');
  const examId = text(request.data.examId);
  if (!examId || examId.includes('/')) fail('invalid-argument', 'Select an exam.');
  const roll = text(request.data.rollNo, 100).toUpperCase();
  if (roll.includes('/')) fail('invalid-argument', 'Invalid roll number.');
  const sessionRef = ref.collection('exam_sessions').doc();
  await db.runTransaction(async tx => {
    const [profile, examSnap] = await Promise.all([tx.get(ref), tx.get(ref.collection('exams').doc(examId))]);
    if (!isActive(profile.data())) fail('failed-precondition', profile.data()?.message || 'This institute’s subscription is inactive.');
    const exam = examSnap.data();
    if (!exam || exam.status !== 'active') fail('failed-precondition', 'This exam is not accepting entries.');
    if (text(request.data.password, 500) !== exam.examPassword) fail('permission-denied', 'Incorrect exam password.');
    const settings = exam.settings || {};
    const name = text(request.data.studentName);
    const phone = text(request.data.phone, 30);
    const studentEmail = email(request.data.email);
    if ((settings.requireRollNo !== false && !roll) || (settings.requireName !== false && !name) || (settings.requirePhone && !phone) || (settings.requireEmail && !validEmail(studentEmail))) fail('invalid-argument', 'Complete all required student details.');
    const roster = exam.allowedStudents || [];
    const student = roster.find(item => item.rollNo.toUpperCase() === roll);
    if (roster.length && !student) fail('permission-denied', 'Your roll number is not on the allowed list.');
    if (settings.schedulingEnabled) {
      const start = millis(settings.scheduledStartTime), end = millis(settings.scheduledEndTime);
      if (Date.now() >= end) fail('failed-precondition', 'This exam has ended.');
      if (settings.lateEntryPolicy === 'disallow' && Date.now() > start) fail('failed-precondition', 'Late entry is not allowed.');
    }
    const attemptRef = ref.collection('attempts').doc(hash(`${examId}:${roll || auth.uid}`));
    const [attempt, blocked] = await Promise.all([tx.get(attemptRef), roll ? tx.get(ref.collection('blocked_students').doc(`${roll}_${examId}`)) : Promise.resolve(null)]);
    if (blocked?.exists && !blocked.data().isUnblocked) fail('permission-denied', 'Your roll number is blocked. Contact your administrator.');
    // Read the actual sessions so deleting an attempt in the admin dashboard permits a retake.
    const attempts = await tx.get(ref.collection('exam_sessions').where('examId', '==', examId).where(roll ? 'studentRollNo' : 'ownerUid', '==', roll || auth.uid));
    if (attempts.docs.some(doc => doc.data().status === 'started') || attempts.size >= (settings.maxAttempts || 1)) fail('already-exists', 'An active session or the maximum number of attempts already exists. Contact your administrator.');
    const now = Timestamp.now();
    const scheduledStart = settings.schedulingEnabled ? millis(settings.scheduledStartTime) : NaN;
    const started = Timestamp.fromMillis(Number.isFinite(scheduledStart) ? Math.max(now.toMillis(), scheduledStart) : now.toMillis());
    const lock = settings.mobileLocking && request.data.isMobile !== true;
    const deviceInfo = Object.fromEntries(['userAgent', 'platform', 'deviceName', 'browser', 'os'].map(key => [key, text(request.data.deviceInfo?.[key], 500)]));
    deviceInfo.screenWidth = Math.max(0, Math.min(20000, Number(request.data.deviceInfo?.screenWidth) || 0));
    deviceInfo.screenHeight = Math.max(0, Math.min(20000, Number(request.data.deviceInfo?.screenHeight) || 0));
    if (settings.deviceRestriction === 'mobile_only' && request.data.isMobile !== true) fail('failed-precondition', 'This exam requires a mobile device.');
    if (settings.deviceRestriction === 'desktop_only' && request.data.isMobile === true) fail('failed-precondition', 'This exam requires a desktop or laptop.');
    tx.create(sessionRef, { examId, ownerUid: auth.uid, studentRollNo: roll || 'N/A', studentName: student?.name || name || 'Anonymous', studentPhone: phone, studentEmail, startTime: started, createdAt: now, deadline: Timestamp.fromMillis(deadline(exam, started)), status: 'started', answers: [], cheatingEvents: [], tabSwitchCount: 0, warningCount: 0, deviceInfo, ...(lock ? { mobileLockCode: randomBytes(5).toString('hex').toUpperCase(), mobileLockStatus: 'pending', mobileLockViolationsCount: 0 } : {}) });
    tx.create(ref.collection('session_keys').doc(sessionRef.id), { ...exam, id: examId });
    tx.set(attemptRef, { sessionId: sessionRef.id, count: (attempt.data()?.count || 0) + 1 });
  });
  return { sessionId: sessionRef.id };
});

export const getStudentExam = onCall(options, async request => {
  const auth = identity(request);
  const ref = tenantRef(request);
  await active(ref);
  const sessionId = text(request.data.sessionId);
  if (!sessionId || sessionId.includes('/')) fail('invalid-argument', 'Invalid session.');
  const session = await ref.collection('exam_sessions').doc(sessionId).get();
  if (!session.exists || session.data().ownerUid !== auth.uid) fail('permission-denied', 'This exam session belongs to another user.');
  const snapshot = await ref.collection('session_keys').doc(sessionId).get();
  if (!snapshot.exists) fail('not-found', 'Exam not found.');
    const live = await ref.collection('exams').doc(session.data().examId).get();
    const exam = snapshot.data();
    return publicExam({ ...exam, settings: { ...exam.settings, showResults: live.data()?.settings?.showResults === true } }, Boolean(session.data().beganAt) || session.data().status !== 'started');
});

export const getStudentResult = onCall(options, async request => {
  const auth = identity(request), ref = tenantRef(request);
  await active(ref);
  const id = text(request.data.sessionId);
  if (!id || id.includes('/')) fail('invalid-argument', 'Invalid session.');
  const session = await ref.collection('exam_sessions').doc(id).get();
  if (!session.exists || session.data().ownerUid !== auth.uid) fail('permission-denied', 'This session belongs to another user.');
  const exam = await ref.collection('exams').doc(session.data().examId).get();
  if (session.data().status === 'started' || exam.data()?.settings?.showResults !== true) return {};
  const result = await ref.collection('session_grades').doc(id).get();
  return result.data() || {};
});

export const beginExam = onCall(options, async request => {
  const auth = identity(request);
  const ref = tenantRef(request);
  const id = text(request.data.sessionId);
  if (!id || id.includes('/')) fail('invalid-argument', 'Invalid session.');
  await db.runTransaction(async tx => {
    const sessionRef = ref.collection('exam_sessions').doc(id);
    const [profile, session, key] = await Promise.all([tx.get(ref), tx.get(sessionRef), tx.get(ref.collection('session_keys').doc(id))]);
    if (!isActive(profile.data())) fail('failed-precondition', 'This institute’s subscription is inactive.');
    if (!session.exists || session.data().ownerUid !== auth.uid) fail('permission-denied', 'This session belongs to another user.');
    const data = session.data(), exam = key.data();
    if (data.status !== 'started' || !exam) fail('failed-precondition', 'This session has ended.');
    if (data.beganAt) return; // Retrying never resets the timer.
    const settings = exam.settings || {};
    if (settings.schedulingEnabled && Date.now() < millis(settings.scheduledStartTime)) fail('failed-precondition', 'This exam has not started yet.');
    if (settings.schedulingEnabled && Date.now() >= millis(settings.scheduledEndTime)) fail('failed-precondition', 'This exam has ended.');
    if (data.mobileLockCode && data.mobileLockStatus !== 'locked') fail('failed-precondition', 'Connect and lock your phone before starting.');
    const now = Timestamp.now();
    tx.update(sessionRef, { beganAt: now, startTime: now, deadline: Timestamp.fromMillis(deadline(exam, now)) });
  });
  return { ok: true };
});

export const submitExam = onCall(options, async request => {
  const auth = identity(request);
  const ref = tenantRef(request);
  const sessionId = text(request.data.sessionId);
  if (!sessionId || sessionId.includes('/')) fail('invalid-argument', 'Invalid session.');
  await db.runTransaction(async tx => {
    const sessionRef = ref.collection('exam_sessions').doc(sessionId);
    const [profile, session, key] = await Promise.all([tx.get(ref), tx.get(sessionRef), tx.get(ref.collection('session_keys').doc(sessionId))]);
    if (!isActive(profile.data())) fail('failed-precondition', 'This institute’s subscription is inactive.');
    if (!session.exists || session.data().ownerUid !== auth.uid) fail('permission-denied', 'This session belongs to another user.');
    if (session.data().status === 'completed') return;
    if (session.data().status !== 'started' || !key.exists) fail('failed-precondition', 'This session has ended.');
    const data = session.data(), exam = key.data();
    if (!data.beganAt || Date.now() < millis(data.startTime)) fail('failed-precondition', 'This exam has not started.');
    const answers = cleanAnswers(Date.now() > millis(data.deadline) + 10000 ? data.answers : request.data.answers, exam.questions);
    const score = grade(exam.questions, answers);
    tx.update(sessionRef, { status: 'completed', endTime: Timestamp.now(), answers, score: FieldValue.delete(), mobileLockStatus: 'unlocked' });
    tx.set(ref.collection('session_grades').doc(sessionId), { score });
  });
  return { ok: true };
});

export const saveAnswers = onCall(options, async request => {
  const auth = identity(request);
  const ref = tenantRef(request);
  const id = text(request.data.sessionId);
  if (!id || id.includes('/')) fail('invalid-argument', 'Invalid session.');
  await db.runTransaction(async tx => {
    const sessionRef = ref.collection('exam_sessions').doc(id);
    const [profile, session, key] = await Promise.all([tx.get(ref), tx.get(sessionRef), tx.get(ref.collection('session_keys').doc(id))]);
    if (!isActive(profile.data())) fail('failed-precondition', 'This institute’s subscription is inactive.');
    if (!session.exists || session.data().ownerUid !== auth.uid) fail('permission-denied', 'This session belongs to another user.');
    const data = session.data();
    if (data.status !== 'started' || !data.beganAt || Date.now() > millis(data.deadline) || !key.exists) fail('failed-precondition', 'This exam is not accepting answers.');
    tx.update(sessionRef, { answers: cleanAnswers(request.data.answers, key.data().questions) });
  });
  return { ok: true };
});

export const regeneratePairingCode = onCall(options, async request => {
  const auth = identity(request), ref = tenantRef(request);
  await active(ref);
  const id = text(request.data.sessionId);
  if (!id || id.includes('/')) fail('invalid-argument', 'Invalid session.');
  const code = randomBytes(5).toString('hex').toUpperCase();
  await db.runTransaction(async tx => {
    const sessionRef = ref.collection('exam_sessions').doc(id), session = await tx.get(sessionRef);
    const data = session.data();
    if (!data || data.ownerUid !== auth.uid) fail('permission-denied', 'This session belongs to another user.');
    if (data.status !== 'started' || data.beganAt || !data.mobileLockCode) fail('failed-precondition', 'Pairing can only change before this exam begins.');
    tx.update(sessionRef, { mobileLockCode: code, mobileUid: FieldValue.delete(), mobileLockStatus: 'pending', lastActiveHeartbeat: FieldValue.delete() });
  });
  return { code };
});

export const pairMobile = onCall(options, async request => {
  const auth = identity(request);
  const ref = tenantRef(request);
  await active(ref);
  await rateLimit(request, 'mobile', 8);
  const code = text(request.data.code, 20).toUpperCase();
  if (!/^[A-F0-9]{10}$/.test(code)) fail('invalid-argument', 'Enter the pairing code shown on your exam screen.');
  const sessions = await ref.collection('exam_sessions').where('mobileLockCode', '==', code).limit(1).get();
  if (sessions.empty) fail('not-found', 'Invalid pairing code.');
  const sessionRef = sessions.docs[0].ref;
  await db.runTransaction(async tx => {
    const session = await tx.get(sessionRef);
    const data = session.data();
    if (data.status !== 'started' || millis(data.deadline) <= Date.now()) fail('failed-precondition', 'This exam session has ended.');
    if (data.mobileUid && data.mobileUid !== auth.uid) fail('already-exists', 'A phone is already paired with this session.');
    tx.update(sessionRef, { mobileUid: auth.uid });
  });
  const session = await sessionRef.get();
  const key = await ref.collection('session_keys').doc(session.id).get();
  return { sessionId: session.id, session: session.data(), settings: key.data()?.settings || {} };
});

export const saveGrades = onCall(options, async request => {
  const ref = await staff(request);
  const address = verified(request);
  const id = text(request.data.sessionId);
  if (!id || id.includes('/')) fail('invalid-argument', 'Invalid session.');
  await db.runTransaction(async tx => {
    const sessionRef = ref.collection('exam_sessions').doc(id);
    const [profile, session, membership, snapshot] = await Promise.all([tx.get(ref), tx.get(sessionRef), tx.get(ref.collection('admin_users').doc(address)), tx.get(ref.collection('session_keys').doc(id))]);
    if (!isActive(profile.data()) && address !== SUPER_ADMIN) fail('failed-precondition', 'Subscription inactive.');
    if (!session.exists) fail('not-found', 'Session not found.');
    const liveExam = await tx.get(ref.collection('exams').doc(session.data().examId));
    const exam = snapshot.data() || liveExam.data();
    if (!exam || (address !== SUPER_ADMIN && membership.data()?.role !== 'admin' && !liveExam.data()?.assignedFaculty?.includes(address))) fail('permission-denied', 'This exam is not assigned to you.');
    if (session.data().status === 'started') fail('failed-precondition', 'Wait for the student to finish before grading.');
    const previous = await tx.get(ref.collection('session_grades').doc(id));
    const input = request.data.scores || {};
    const answers = (previous.data()?.answers || session.data().answers).map(answer => {
      const question = exam.questions.find(item => item.id === answer.questionId);
      if (!question) fail('invalid-argument', 'Unknown question.');
      const score = input[answer.questionId] === undefined ? (answer.score ?? grade([question], [answer])) : Number(input[answer.questionId]);
      if (!Number.isFinite(score) || score < 0 || score > question.points) fail('invalid-argument', 'A score is outside the question’s mark range.');
      return { ...answer, score };
    });
    const total = request.data.totalScore === undefined ? answers.reduce((sum, answer) => sum + answer.score, 0) : Number(request.data.totalScore);
    const maximum = exam.questions.reduce((sum, question) => sum + question.points, 0);
    if (!Number.isFinite(total) || total < 0 || total > maximum) fail('invalid-argument', 'Total score is outside the exam’s mark range.');
    tx.set(ref.collection('session_grades').doc(id), { score: total, answers });
    tx.update(sessionRef, { answers: answers.map(({ score, ...answer }) => answer), score: FieldValue.delete(), scoreModified: true, scoreModifiedAt: Timestamp.now() });
    audit(tx, request, 'grade-session', ref.id, { sessionId: id });
  });
  return { ok: true };
});

export const blockTerminatedStudent = onDocumentUpdated({ ...options, document: 'institutes/{tenantId}/exam_sessions/{sessionId}' }, async event => {
  const before = event.data.before.data(), after = event.data.after.data();
  if (before.status !== 'started' || after.status !== 'terminated' || !after.studentRollNo || after.studentRollNo === 'N/A') return;
  await db.doc(`institutes/${event.params.tenantId}/blocked_students/${after.studentRollNo}_${after.examId}`).set({ rollNo: after.studentRollNo, examId: after.examId, reason: after.terminationReason || 'Exam terminated', blockedAt: Timestamp.now(), blockedBy: 'system', isUnblocked: false });
});
