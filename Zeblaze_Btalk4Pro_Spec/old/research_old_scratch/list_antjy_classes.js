const { execSync } = require('child_process');
const dexdump = 'C:/Users/ADN DigiNet/AppData/Local/Android/Sdk/build-tools/35.0.0/dexdump.exe';
const dexFile = 'd:/Zeblaze/scratch/zc_dex/classes.dex';

const out = execSync(`"${dexdump}" -d "${dexFile}"`, { maxBuffer: 300 * 1024 * 1024 }).toString('utf8');
const target = "Lcom/antjy/sdk/bluetooth/";
let idx = 0;
const classes = new Set();
while ((idx = out.indexOf(target, idx)) !== -1) {
  const lineEnd = out.indexOf(';', idx);
  if (lineEnd !== -1 && lineEnd - idx < 100) {
    classes.add(out.slice(idx, lineEnd));
  }
  idx += target.length;
}
console.log('Classes count:', classes.size);
for (const c of Array.from(classes).sort()) {
  console.log(c);
}
