const fs = require('fs');
const xml = fs.readFileSync('C:/Users/ADN DigiNet/.gemini/antigravity/brain/1bd4fb03-14f1-413f-bffc-068116925dfc/scratch/app_front.xml', 'utf8');
['HR', 'SpO2', 'Dynamic', 'Sync', 'Send Test Command', 'Disconnect', 'Scan'].forEach(label => {
  let idx = 0;
  while ((idx = xml.indexOf(label, idx)) !== -1) {
    const chunk = xml.slice(Math.max(0, idx - 100), idx + 200);
    const m = chunk.match(/bounds="(\[\d+,\d+\]\[\d+,\d+\])"/);
    console.log(label, m ? m[1] : 'no bounds');
    idx += label.length;
  }
});
