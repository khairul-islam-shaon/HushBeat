const { execSync } = require('child_process');
const dexdump = 'C:/Users/ADN DigiNet/AppData/Local/Android/Sdk/build-tools/35.0.0/dexdump.exe';
const dexFile = 'C:/Users/ADN DigiNet/.gemini/antigravity/brain/1bd4fb03-14f1-413f-bffc-068116925dfc/scratch/dex/classes6.dex';
const out = execSync(`"${dexdump}" -d "${dexFile}"`, { maxBuffer: 300 * 1024 * 1024 }).toString('utf8');

// Find method index for C1
// In ui3, let's look for invoke-virtual or invoke-direct {...}, ...ui3;.C1:([B)V
let idx = 0;
while ((idx = out.indexOf('ui3;.C1:([B)V', idx)) !== -1) {
  console.log('=== Caller at', idx, '===');
  console.log(out.slice(Math.max(0, idx - 300), idx + 200));
  idx += 13;
}
