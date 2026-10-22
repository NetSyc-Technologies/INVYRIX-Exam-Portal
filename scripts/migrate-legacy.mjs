// Explicit, copy-only migration. Dry run unless --apply is passed. No source writes.
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { validSlug } from '../functions/policy.js';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { values } = parseArgs({ options: { 'source-project': {type:'string'}, 'target-project': {type:'string'}, institute: {type:'string'}, apply: {type:'boolean',default:false} } });
if (!values['source-project'] || !values['target-project'] || !validSlug(values.institute)) throw new Error('Usage: node scripts/migrate-legacy.mjs --source-project OLD --target-project NEW --institute approved-slug [--apply]');
const source = getFirestore(initializeApp({ credential: applicationDefault(), projectId: values['source-project'] }, 'legacy-source'));
const target = getFirestore(initializeApp({ credential: applicationDefault(), projectId: values['target-project'] }, 'invyrix-target'));
const institute = target.doc(`institutes/${values.institute}`);
if (!(await institute.get()).exists) throw new Error('Approve the destination institute in the super-admin console before migrating.');
const active = await source.collection('exam_sessions').where('status','==','started').limit(1).get();
if (!active.empty) throw new Error('Legacy exams are still in progress. Finish them before migration.');
const oldFaculty = await source.collection('admin_users').get();
const facultyMap = new Map(oldFaculty.docs.map(item=>[item.id,String(item.data().email || '').trim().toLowerCase()]));
let copied=0, skipped=0;
for (const collectionName of ['admin_users','exams','exam_sessions','blocked_students']) {
  let cursor;
  while (true) {
    let query=source.collection(collectionName).orderBy('__name__').limit(200);
    if (cursor) query=query.startAfter(cursor);
    const page=await query.get();
    if (page.empty) break;
    for (const item of page.docs) {
      const data=item.data();
      if (collectionName==='admin_users' && data.role!=='faculty') { skipped++; continue; }
      const id=collectionName==='admin_users' ? facultyMap.get(item.id) : item.id;
      if (!id || id.includes('/')) { skipped++; continue; }
      const destination=institute.collection(collectionName).doc(id);
      if ((await destination.get()).exists) { skipped++; continue; }
      if (collectionName==='exams') data.assignedFaculty=(data.assignedFaculty||[]).map(id=>facultyMap.get(id)||id);
      if (values.apply) {
        // create() preconditions ensure concurrent runs cannot overwrite a document.
        await destination.create(data);
        if (collectionName==='admin_users') await target.doc(`directory/${id}`).set({institutes:FieldValue.arrayUnion(values.institute)},{merge:true});
      }
      copied++;
    }
    cursor=page.docs.at(-1);
  }
}
console.log(`${values.apply?'Copied':'Would copy'} ${copied} records; skipped ${skipped}. Original data was not modified. Historical student sessions remain staff-only because they predate authenticated session ownership.`);
