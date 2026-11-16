const fs = require('fs');
const { execSync } = require('child_process');
const dexdump = 'C:/Users/ADN DigiNet/AppData/Local/Android/Sdk/build-tools/35.0.0/dexdump.exe';
const dexFile = 'C:/Users/ADN DigiNet/.gemini/antigravity/brain/1bd4fb03-14f1-413f-bffc-068116925dfc/scratch/dex/classes6.dex';

console.log('Running dexdump...');
const out = execSync(`"${dexdump}" -d "${dexFile}"`, { maxBuffer: 300 * 1024 * 1024 }).toString('utf8');
console.log('Dump completed, length:', out.length);

let idx = 0;
while ((idx = out.indexOf('queryTodayStep', idx)) !== -1) {
  console.log(out.slice(idx - 100, idx + 400));
  console.log('='.repeat(50));
  idx += 14;
}
