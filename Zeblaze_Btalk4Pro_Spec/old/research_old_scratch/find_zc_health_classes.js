const { execSync } = require('child_process');
const dexdump = 'C:/Users/ADN DigiNet/AppData/Local/Android/Sdk/build-tools/35.0.0/dexdump.exe';
const dexFile = 'd:/Zeblaze/scratch/zc_dex/classes2.dex';

const out = execSync(`"${dexdump}" -d "${dexFile}"`, { maxBuffer: 300 * 1024 * 1024 }).toString('utf8');

['HeartRate', 'Oxygen', 'Step', 'parse'].forEach(kw => {
  let idx = 0;
  const found = new Set();
  while ((idx = out.indexOf(kw, idx)) !== -1) {
    const classStart = out.lastIndexOf('Class descriptor  : ', idx);
    if (classStart !== -1) {
      const lineEnd = out.indexOf('\n', classStart);
      found.add(out.slice(classStart, lineEnd).trim());
    }
    idx += kw.length;
  }
  console.log(`=== Classes for ${kw} (${found.size}) ===`);
  for (const c of Array.from(found).slice(0, 15)) {
    console.log(' ', c);
  }
});
