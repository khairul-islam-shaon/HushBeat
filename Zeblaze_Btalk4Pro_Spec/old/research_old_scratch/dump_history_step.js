const { execSync } = require('child_process');
const dexdump = 'C:/Users/ADN DigiNet/AppData/Local/Android/Sdk/build-tools/35.0.0/dexdump.exe';

for (const f of ['classes5.dex', 'classes6.dex', 'classes7.dex']) {
  const dexFile = `C:/Users/ADN DigiNet/.gemini/antigravity/brain/1bd4fb03-14f1-413f-bffc-068116925dfc/scratch/dex/${f}`;
  try {
    const out = execSync(`"${dexdump}" -d "${dexFile}"`, { maxBuffer: 300 * 1024 * 1024 }).toString('utf8');
    let idx = 0;
    while ((idx = out.indexOf('queryHistoryStep', idx)) !== -1) {
      console.log(`=== In ${f} at ${idx} ===`);
      console.log(out.slice(Math.max(0, idx - 100), idx + 800));
      idx += 16;
    }
  } catch (e) {
    console.error(`Error with ${f}:`, e.message);
  }
}
