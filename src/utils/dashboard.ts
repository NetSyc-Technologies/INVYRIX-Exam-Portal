import { Exam, ExamSession } from '../types';

/** Accept Firestore timestamps, Dates and serialized dates; pending timestamps sort last. */
export function timestampMillis(value: unknown): number {
    if (!value) return 0;
    if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
        return timestampMillis(value.toDate());
    }
    const time = value instanceof Date ? value.getTime() : new Date(value as string).getTime();
    return Number.isFinite(time) ? time : 0;
}

export function summarizeDashboard(exams: Exam[], sessions: ExamSession[], now = new Date()) {
    const completedSessions = sessions.filter(session => session.status === 'completed').length;
    const days = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(now);
        date.setDate(date.getDate() - 6 + index);
        date.setHours(0, 0, 0, 0);
        const next = new Date(date);
        next.setDate(next.getDate() + 1);
        return {
            label: date.toLocaleDateString('en-IN', { weekday: 'short' }),
            date: date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
            count: sessions.filter(session => {
                const time = timestampMillis(session.startTime);
                return time >= date.getTime() && time < next.getTime();
            }).length,
        };
    });
    return {
        totalExams: exams.length,
        activeExams: exams.filter(exam => exam.status === 'active').length,
        totalSessions: sessions.length,
        activeSessions: sessions.filter(session => session.status === 'started').length,
        cheatingAlerts: sessions.reduce((count, session) => count + (session.cheatingEvents?.length || 0), 0),
        terminatedSessions: sessions.filter(session => session.status === 'terminated').length,
        cancelledSessions: sessions.filter(session => session.status === 'cancelled').length,
        completedSessions,
        completionRate: sessions.length ? Math.round(completedSessions / sessions.length * 100) : 0,
        days,
    };
}
