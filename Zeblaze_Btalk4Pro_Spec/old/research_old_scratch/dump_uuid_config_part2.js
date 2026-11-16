const { execSync } = require('child_process');
const dexdump = 'C:/Users/ADN DigiNet/AppData/Local/Android/Sdk/build-tools/35.0.0/dexdump.exe';
const dexFile = 'd:/Zeblaze/scratch/zc_dex/classes.dex';

const out = execSync(`"${dexdump}" -d "${dexFile}"`, { maxBuffer: 300 * 1024 * 1024 }).toString('utf8');
const target = "000001ff-3c17-d293-8e48-14fe2e4da212";
const idx = out.indexOf(target);
console.log(out.slice(idx, idx + 2000));
