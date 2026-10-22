export const SUPER_ADMIN = 'admin@netsyc.com';
export const TERMS_VERSION = '2026-10-21';
export const RESERVED = new Set(['admin', 'superadmin', 'register', 'terms', 'privacy', 'download', 'desktop', 'exam', 'results', 'assets', 'api', 'mobile', 'login', 'favicon.ico', 'logo.png', 'namelogo.png']);
export function validSlug(value) {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length >= 3 && value.length <= 64 && !RESERVED.has(value);
}
export function millis(value) {
  if (value?.toMillis) return value.toMillis();
  if (value?._seconds !== undefined) return value._seconds * 1000;
  if (value?.seconds !== undefined) return value.seconds * 1000;
  return new Date(value).getTime();
}
export function isActive(profile, now = Date.now()) {
  return profile?.status === 'active' && Number.isFinite(millis(profile.expiresAt)) && millis(profile.expiresAt) > now;
}
export function publicExam(exam, includeQuestions = false) {
  const { examPassword, allowedStudents, assignedFaculty, createdBy, ...safe } = exam;
  return { ...safe, questionCount: exam.questions?.length || 0, questions: includeQuestions ? (exam.questions || []).map(({ correctAnswer, ...question }) => question) : [] };
}
export function grade(questions, answers) {
  const map = new Map(answers.map(answer => [answer.questionId, answer.answer]));
  return questions.reduce((sum, question) => {
    const answer = map.get(question.id);
    if (answer === undefined || answer === null || String(answer).trim() === '') return sum;
    const correct = question.type === 'mcq'
      ? Number.isInteger(Number(answer)) && Number(answer) === Number(question.correctAnswer)
      : String(answer).trim().toLowerCase() === String(question.correctAnswer).trim().toLowerCase();
    return sum + (correct ? Number(question.points) || 0 : 0);
  }, 0);
}
export function deadline(exam, started) {
  const durationEnd = millis(started) + exam.duration * 60000;
  const scheduledEnd = exam.settings?.schedulingEnabled ? millis(exam.settings.scheduledEndTime) : NaN;
  return Number.isFinite(scheduledEnd) ? Math.min(durationEnd, scheduledEnd) : durationEnd;
}
