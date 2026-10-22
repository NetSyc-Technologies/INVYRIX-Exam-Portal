import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
let env;
const profile = { name:'Institute',slug:'college-a',invyrixId:'INV-123456789ABC',logoUrl:'',status:'active',expiresAt:Timestamp.fromMillis(Date.now()+86400000),message:'' };
before(async()=> { env=await initializeTestEnvironment({projectId:'demo-invyrix',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}}); });
after(async()=>env?.cleanup());
beforeEach(async()=>{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    for(const tenant of ['college-a','college-b','expired','paused']) {
      await setDoc(doc(db,'institutes',tenant),{...profile,slug:tenant,status:tenant==='paused'?'paused':'active',expiresAt:Timestamp.fromMillis(Date.now()+(tenant==='expired'?-10000:86400000))});
      await setDoc(doc(db,'institutes',tenant,'admin_users',`${tenant}@example.com`),{email:`${tenant}@example.com`,role:'admin'});
      await setDoc(doc(db,'institutes',tenant,'exams','exam'),{examName:'Exam',examPassword:'secret',questions:[{correctAnswer:0}],assignedFaculty:['teacher@example.com']});
      await setDoc(doc(db,'institutes',tenant,'exam_sessions','session'),{ownerUid:'student',mobileUid:'phone',examId:'exam',status:'started',warningCount:0,tabSwitchCount:0,cheatingEvents:[],answers:[],startTime:Timestamp.fromMillis(Date.now()-1000),deadline:Timestamp.fromMillis(Date.now()+3600000)});
    }
    await setDoc(doc(db,'institutes','college-a','admin_users','teacher@example.com'),{email:'teacher@example.com',role:'faculty'});
    await setDoc(doc(db,'registrations','applicant'),{status:'pending',adminEmail:'applicant@example.com'});
    await setDoc(doc(db,'institutes','college-a','session_keys','session'),{secret:'answer key'});
  });
});
const account=(uid,email,verified=true)=>env.authenticatedContext(uid,{email,email_verified:verified}).firestore();
test('public profiles are readable but private applications and exam keys are protected',async()=>{
  const db=env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db,'institutes','college-a')));
  await assertFails(getDocs(collection(db,'institutes')));
  await assertFails(getDoc(doc(db,'registrations','applicant')));
  await assertFails(getDoc(doc(db,'institutes','college-a','exams','exam')));
  await assertFails(getDoc(doc(db,'institutes','college-a','session_keys','session')));
});
test('institute admin is confined to their own institute and cannot rename or self-renew',async()=>{
  const db=account('admin','college-a@example.com');
  await assertSucceeds(getDoc(doc(db,'institutes','college-a','exams','exam')));
  await assertFails(getDoc(doc(db,'institutes','college-b','exams','exam')));
  await assertSucceeds(updateDoc(doc(db,'institutes','college-a'),{logoUrl:'https://example.com/logo.png'}));
  await assertFails(updateDoc(doc(db,'institutes','college-a'),{name:'Forged name'}));
  await assertFails(updateDoc(doc(db,'institutes','college-a'),{expiresAt:Timestamp.fromMillis(Date.now()+1e10)}));
  await assertFails(setDoc(doc(db,'institutes','college-a','admin_users','attacker@example.com'),{role:'admin'}));
});
test('expiry and pause block exam reads and writes while administrator account access remains',async()=>{
  for(const tenant of ['expired','paused']) {
    const db=account('admin',`${tenant}@example.com`);
    await assertSucceeds(getDoc(doc(db,'institutes',tenant,'admin_users',`${tenant}@example.com`)));
    await assertFails(getDoc(doc(db,'institutes',tenant,'exams','exam')));
    await assertFails(setDoc(doc(db,'institutes',tenant,'exams','new'),{examName:'Blocked'}));
  }
});
test('students can save only their own answers and cannot forge grades, timers, owners or keys',async()=>{
  const db=env.authenticatedContext('student').firestore();
  const session=doc(db,'institutes','college-a','exam_sessions','session');
  await assertFails(updateDoc(session,{answers:[{questionId:'q',answer:1}]}));
  await assertFails(updateDoc(session,{mobileLockStatus:'locked'}));
  await assertFails(updateDoc(session,{lastActiveHeartbeat:Timestamp.now()}));
  await assertSucceeds(updateDoc(session,{warningCount:1}));
  for(const change of [{score:100},{ownerUid:'someone'},{status:'completed'},{startTime:Timestamp.now()},{deadline:Timestamp.fromMillis(Date.now()+1e10)}]) await assertFails(updateDoc(session,change));
  await assertFails(getDoc(doc(db,'institutes','college-a','session_keys','session')));
  await assertFails(getDoc(doc(env.authenticatedContext('other').firestore(),'institutes','college-a','exam_sessions','session')));
  await assertFails(setDoc(doc(db,'institutes','college-a','exam_sessions','forged'),{ownerUid:'student'}));
});
test('super admin requires a verified exact email and can inspect all institutes',async()=>{
  const good=account('super','admin@netsyc.com');
  await assertSucceeds(getDocs(collection(good,'institutes')));
  await assertSucceeds(getDoc(doc(good,'institutes','expired','exams','exam')));
  for(const db of [account('fake','admin@netsyc.com',false),account('other','someone@netsyc.com')]) await assertFails(getDocs(collection(db,'institutes')));
});
test('faculty cannot create exams or grant administrator roles',async()=>{
  const db=account('teacher','teacher@example.com');
  await assertSucceeds(getDoc(doc(db,'institutes','college-a','exams','exam')));
  await assertFails(setDoc(doc(db,'institutes','college-a','exams','new'),{}));
  await assertFails(updateDoc(doc(db,'institutes','college-a','admin_users','teacher@example.com'),{role:'admin'}));
});
test('phone telemetry access cannot edit answers or grades',async()=>{
  const db=env.authenticatedContext('phone').firestore();
  const ref=doc(db,'institutes','college-a','exam_sessions','session');
  await assertSucceeds(updateDoc(ref,{mobileLockStatus:'locked'}));
  await assertFails(updateDoc(ref,{answers:[{questionId:'q',answer:0}]}));
  await assertFails(updateDoc(ref,{score:999}));
  assert.ok(true);
});
