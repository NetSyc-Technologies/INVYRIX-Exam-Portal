import { spawn } from 'node:child_process';
const integration = process.argv[2] === 'integration';
const child = spawn(process.execPath, ['node_modules/firebase-tools/lib/bin/firebase.js', 'emulators:exec', '--only', integration ? 'auth,firestore,functions' : 'firestore', '--project', 'demo-invyrix', `node --test scripts/${integration ? 'integration' : 'rules'}.test.mjs`], {
  stdio: 'inherit', env: { ...process.env, FUNCTIONS_DISCOVERY_TIMEOUT: '60' }
});
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
