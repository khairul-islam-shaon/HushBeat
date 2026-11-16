const { execSync } = require('child_process');
const dexdump = 'C:/Users/ADN DigiNet/AppData/Local/Android/Sdk/build-tools/35.0.0/dexdump.exe';
const dexFile = 'd:/Zeblaze/scratch/zc_dex/classes.dex';

const out = execSync(`"${dexdump}" -d "${dexFile}"`, { maxBuffer: 300 * 1024 * 1024 }).toString('utf8');
const target = "Class descriptor  : 'Lcom/antjy/sdk/bluetooth/connect/UUIDConfig;'";
const idx = out.indexOf(target);
console.log(out.slice(idx, idx + 4000));
