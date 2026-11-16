const { execSync } = require('child_process');
const dexdump = 'C:/Users/ADN DigiNet/AppData/Local/Android/Sdk/build-tools/35.0.0/dexdump.exe';
const dexFile = 'C:/Users/ADN DigiNet/.gemini/antigravity/brain/1bd4fb03-14f1-413f-bffc-068116925dfc/scratch/dex/classes5.dex';
const out = execSync(`"${dexdump}" -d "${dexFile}"`, { maxBuffer: 300 * 1024 * 1024 }).toString('utf8');
const target = "Class descriptor  : 'Lcom/crrepa/ble/conn/CRPBleConnection;'";
const idx = out.indexOf(target);
const chunk = out.slice(idx, idx + 80000);
const lines = chunk.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('name          :')) {
    const name = lines[i].trim();
    if (/step|activity|sync|walk|sport|pedometer/i.test(name)) {
      console.log(name, lines[i+1].trim());
    }
  }
}
