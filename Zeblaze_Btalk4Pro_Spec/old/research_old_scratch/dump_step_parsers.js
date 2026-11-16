const { execSync } = require('child_process');
const dexdump = 'C:/Users/ADN DigiNet/AppData/Local/Android/Sdk/build-tools/35.0.0/dexdump.exe';
const dexFile = 'C:/Users/ADN DigiNet/.gemini/antigravity/brain/1bd4fb03-14f1-413f-bffc-068116925dfc/scratch/dex/classes6.dex';
const out = execSync(`"${dexdump}" -d "${dexFile}"`, { maxBuffer: 300 * 1024 * 1024 }).toString('utf8');

// 1. Check method around 190e64
const idx1 = out.indexOf('190e64:');
console.log('=== Method around 190e64 (ui3.onStepChange caller) ===');
console.log(out.slice(Math.max(0, idx1 - 600), idx1 + 200));

// 2. Check lN3 class methods
const idx2 = out.indexOf("Class descriptor  : 'Lcom/android/mltcode/paycertificationapi/lN3;'");
console.log('=== lN3 class (step parser) ===');
console.log(out.slice(idx2, idx2 + 4000));
