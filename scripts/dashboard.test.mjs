import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/utils/dashboard.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { timestampMillis, summarizeDashboard } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('Firestore, Date and serialized timestamps sort consistently; pending values sort last', () => {
    const date = new Date('2026-10-15T06:30:00Z');
    assert.equal(timestampMillis({ toDate: () => date }), date.getTime());
    assert.equal(timestampMillis(date.toISOString()), date.getTime());
    for (const value of [null, undefined, 'invalid', new Date('invalid')]) assert.equal(timestampMillis(value), 0);
});

test('empty dashboard has zero completion and seven zero-count days', () => {
    const stats = summarizeDashboard([], []);
    assert.equal(stats.completionRate, 0);
    assert.equal(stats.totalSessions, 0);
    assert.equal(stats.days.length, 7);
    assert.ok(stats.days.every(day => day.count === 0));
});

test('outcomes include cancelled sessions and count alerts independently', () => {
    const sessions = ['started', 'completed', 'completed', 'terminated', 'cancelled'].map((status, i) => ({ status, cheatingEvents: i === 3 ? [{}, {}] : [] }));
    const stats = summarizeDashboard([{ status: 'active' }, { status: 'draft' }], sessions);
    assert.equal(stats.activeExams, 1);
    assert.equal(stats.totalExams, 2);
    assert.equal(stats.completionRate, 40);
    assert.equal(stats.completedSessions + stats.activeSessions + stats.terminatedSessions + stats.cancelledSessions, 5);
    assert.equal(stats.cheatingAlerts, 2);
});

test('activity buckets use calendar-day boundaries, excluding older and pending sessions', () => {
    const now = new Date(2026, 9, 15, 12);
    const startTime = new Date(2026, 9, 9, 0);
    const stats = summarizeDashboard([], [
        { startTime },
        { startTime: { toDate: () => new Date(2026, 9, 15, 0) } },
        { startTime: new Date(2026, 9, 15, 23, 59, 59) },
        { startTime: new Date(2026, 9, 8, 23, 59, 59) },
        { startTime: null },
    ], now);
    assert.deepEqual(stats.days.map(day => day.count), [1, 0, 0, 0, 0, 0, 2]);
});
