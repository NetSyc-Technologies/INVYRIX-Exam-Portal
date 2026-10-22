import test from 'node:test';
import assert from 'node:assert/strict';
import { validSlug, isActive, publicExam, grade, deadline } from '../functions/policy.js';

test('institute addresses reject route collisions, traversal and invalid lengths', () => {
  for (const slug of ['my-institute', 'college-123', 'abc']) assert.equal(validSlug(slug), true);
  for (const slug of ['admin', 'register', 'desktop', 'mobile', '../college', 'UPPER', 'a--b', '-abc', 'abc-', 'ab', 'a'.repeat(65), null]) assert.equal(validSlug(slug), false);
});
test('subscriptions expire at the boundary and paused/missing profiles always fail closed', () => {
  const now = Date.parse('2026-10-21T10:00:00Z');
  assert.equal(isActive({ status: 'active', expiresAt: new Date(now + 1) }, now), true);
  for (const profile of [null, {}, {status:'active',expiresAt:'bad'}, {status:'paused',expiresAt:new Date(now+1000)}, {status:'active',expiresAt:new Date(now)}]) assert.equal(isActive(profile,now),false);
  assert.equal(isActive({ status:'active', expiresAt:{toMillis:()=>now+1} },now),true);
});
test('public exam data excludes passwords, rosters and answer keys', () => {
  const exam = {examPassword:'secret',allowedStudents:[{name:'private'}],assignedFaculty:['private'],createdBy:'private',examName:'Test',questions:[{id:'q',text:'Question',correctAnswer:1,options:['a','b'],points:2}]};
  const list = publicExam(exam);
  assert.equal(list.questionCount,1); assert.deepEqual(list.questions,[]);
  assert.equal(list.examPassword,undefined); assert.equal(list.allowedStudents,undefined); assert.equal(list.assignedFaculty,undefined);
  const detail=publicExam(exam,true); assert.equal(detail.questions[0].correctAnswer,undefined); assert.equal(detail.questions[0].text,'Question');
});
test('server grading ignores unknown answers and never trusts supplied scores', () => {
  const questions=[{id:'a',type:'mcq',correctAnswer:0,points:3},{id:'b',type:'short_answer',correctAnswer:'Hello',points:2},{id:'c',type:'true_false',correctAnswer:'true',points:1}];
  assert.equal(grade(questions,[{questionId:'a',answer:'0',score:999},{questionId:'b',answer:' HELLO '},{questionId:'c',answer:'TRUE'},{questionId:'unknown',answer:'x'}]),6);
  assert.equal(grade(questions,[{questionId:'a',answer:''},{questionId:'b',answer:null}]),0);
  assert.equal(grade(questions,[{questionId:'a',answer:0},{questionId:'a',answer:1}]),0);
});
test('deadline uses the earlier of exam duration and scheduled end', () => {
  const start=new Date('2026-10-21T10:00:00Z');
  assert.equal(deadline({duration:30,settings:{}},start),start.getTime()+1800000);
  assert.equal(deadline({duration:30,settings:{schedulingEnabled:true,scheduledEndTime:'2026-10-21T10:15:00Z'}},start),start.getTime()+900000);
});
