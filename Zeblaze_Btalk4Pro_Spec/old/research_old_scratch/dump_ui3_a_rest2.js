const { execSync } = require('child_process');
const dexdump = 'C:/Users/ADN DigiNet/AppData/Local/Android/Sdk/build-tools/35.0.0/dexdump.exe';
const dexFile = 'C:/Users/ADN DigiNet/.gemini/antigravity/brain/1bd4fb03-14f1-413f-bffc-068116925dfc/scratch/dex/classes6.dex';
const out = execSync(`"${dexdump}" -d "${dexFile}"`, { maxBuffer: 300 * 1024 * 1024 }).toString('utf8');

const idx = out.indexOf('193772:');
console.log(out.slice(idx, idx + 2000));
