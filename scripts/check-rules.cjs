// Static checks for firestore.rules hardening (sin emulador).
const fs = require('fs');
const rules = fs.readFileSync('firestore.rules', 'utf8');
const checks = [
  ['users self-only', /match \/users\/\{userId\}[\s\S]*request\.auth\.uid == userId/],
  ['users read self-only', /match \/users\/\{userId\}[\s\S]*allow read: if isSignedIn\(\) && request\.auth\.uid == userId/],
  ['likesCount ±1', /likesCount == resource\.data\.likesCount \+ 1/],
  ['likesCount >=0', /likesCount >= 0/],
  ['composer likesCount ±1', /match \/composer_projects[\s\S]*likesCount == resource\.data\.likesCount \+ 1[\s\S]*likesCount == resource\.data\.likesCount - 1/],
  ['likes no públicas', /match \/likes\/\{userId\}[\s\S]*allow read: if isProjectPublic/],
  ['test no write', /match \/test\/\{docId\}[\s\S]*allow write: if false/],
];
let fail = 0;
for (const [name, rx] of checks) {
  if (rx.test(rules)) console.log(`OK ${name}`);
  else { console.error(`FAIL ${name}`); fail = 1; }
}
process.exit(fail);
