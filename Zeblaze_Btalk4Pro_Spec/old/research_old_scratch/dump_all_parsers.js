const fs = require('fs');
const buf = fs.readFileSync('scratch/zc_dex/classes.dex');
const methodIdsOff = buf.readUInt32LE(0x5c);
const typeIdsOff = buf.readUInt32LE(0x44);
const stringIdsOff = buf.readUInt32LE(0x3c);
const classDefsOff = buf.readUInt32LE(0x64);
const classDefsSize = buf.readUInt32LE(0x60);

function getString(idx) {
  const off = buf.readUInt32LE(stringIdsOff + idx * 4);
  let p = off; while (buf[p] & 0x80) p++; p++;
  let end = p; while (buf[end] !== 0) end++;
  return buf.toString('utf8', p, end);
}
function getType(idx) { return getString(buf.readUInt32LE(typeIdsOff + idx * 4)); }
function getMethod(idx) {
  const classIdx = buf.readUInt16LE(methodIdsOff + idx * 8);
  const nameIdx = buf.readUInt32LE(methodIdsOff + idx * 8 + 4);
  return getType(classIdx) + '->' + getString(nameIdx);
}
function readUleb128(p) {
  let result = 0, shift = 0, byte, count = 0;
  do { byte = buf[p++]; count++; result |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80);
  return { val: result, len: count };
}

const parserNames = [
  'DeviceInfoEventParser',
  'DeviceSetEventParser',
  'DeviceRemindEventParser',
  'SyncDataV1EventParser',
  'DeviceTestEventParser',
  'DeviceOtaEventParser',
  'DeviceReportEventParser',
  'MultiPackEventParser'
];

let fullReport = '';

for (let i = 0; i < classDefsSize; i++) {
  const cOff = classDefsOff + i * 32;
  const cName = getType(buf.readUInt32LE(cOff));
  const matched = parserNames.find(p => cName.endsWith('/' + p + ';'));
  if (matched) {
    fullReport += `\n======================================================\n`;
    fullReport += `PARSER: ${matched} (${cName})\n`;
    fullReport += `======================================================\n`;
    const classDataOff = buf.readUInt32LE(cOff + 24);
    if (!classDataOff) continue;
    let p = classDataOff;
    const sfs = readUleb128(p); p += sfs.len;
    const ifs = readUleb128(p); p += ifs.len;
    const dms = readUleb128(p); p += dms.len;
    const vms = readUleb128(p); p += vms.len;
    for (let j = 0; j < sfs.val + ifs.val; j++) { readUleb128(p); readUleb128(p); }
    let mIdx = 0;
    for (let j = 0; j < dms.val + vms.val; j++) {
      if (j === dms.val) mIdx = 0;
      const d = readUleb128(p); p += d.len; mIdx += d.val;
      const access = readUleb128(p); p += access.len;
      const codeOff = readUleb128(p); p += codeOff.len;
      if (codeOff.val === 0) continue;
      const mName = getString(buf.readUInt32LE(methodIdsOff + mIdx * 8 + 4));
      fullReport += `\n--- Method: ${mName} (codeOff: ${codeOff.val}) ---\n`;
      const insnsSize = buf.readUInt32LE(codeOff.val + 12);
      const insns = buf.slice(codeOff.val + 16, codeOff.val + 16 + insnsSize * 2);
      for (let ip = 0; ip < insns.length; ip += 2) {
        const op = insns[ip];
        if (op === 0x1a) {
          fullReport += `  [pc 0x${(ip/2).toString(16)}] String: "${getString(insns.readUInt16LE(ip + 2))}"\n`;
        } else if (op === 0x13) {
          fullReport += `  [pc 0x${(ip/2).toString(16)}] Const16: ${insns.readInt16LE(ip + 2)} (0x${(insns.readUInt16LE(ip + 2)).toString(16)})\n`;
        } else if (op >= 0x6e && op <= 0x72) {
          const m = getMethod(insns.readUInt16LE(ip + 2));
          if (!m.includes('StringBuilder')) {
            fullReport += `  [pc 0x${(ip/2).toString(16)}] Invoke: ${m}\n`;
          }
        }
      }
    }
  }
}

fs.writeFileSync('scratch/all_parsers_analysis.txt', fullReport, 'utf8');
console.log('Saved all_parsers_analysis.txt. Length:', fullReport.length);
