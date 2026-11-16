const fs = require('fs');

const buf = fs.readFileSync('d:/Zeblaze/scratch/zc_dex/classes2.dex');

const stringIdsSize = buf.readUInt32LE(0x38);
const stringIdsOff = buf.readUInt32LE(0x3c);
const typeIdsSize = buf.readUInt32LE(0x40);
const typeIdsOff = buf.readUInt32LE(0x44);
const methodIdsSize = buf.readUInt32LE(0x58);
const methodIdsOff = buf.readUInt32LE(0x5c);
const classDefsSize = buf.readUInt32LE(0x60);
const classDefsOff = buf.readUInt32LE(0x64);

function getString(idx) {
  if (idx < 0 || idx >= stringIdsSize) return '';
  const off = buf.readUInt32LE(stringIdsOff + idx * 4);
  let p = off; while (buf[p] & 0x80) p++; p++;
  let end = p; while (buf[end] !== 0) end++;
  return buf.toString('utf8', p, end);
}
function getType(idx) { return getString(buf.readUInt32LE(typeIdsOff + idx * 4)); }
function getMethod(idx) {
  if (idx < 0 || idx >= methodIdsSize) return '';
  const classIdx = buf.readUInt16LE(methodIdsOff + idx * 8);
  const nameIdx = buf.readUInt32LE(methodIdsOff + idx * 8 + 4);
  return `${getType(classIdx)}->${getString(nameIdx)}`;
}
function readUleb128(p) {
  let result = 0, shift = 0, byte, count = 0;
  do { byte = buf[p++]; count++; result |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80);
  return { val: result, len: count };
}

function dumpClass(className) {
  for (let i = 0; i < classDefsSize; i++) {
    const cOff = classDefsOff + i * 32;
    const cName = getType(buf.readUInt32LE(cOff));
    if (cName.includes(className)) {
      console.log(`\n================ ${cName} ================`);
      const classDataOff = buf.readUInt32LE(cOff + 24);
      if (classDataOff === 0) continue;
      let p = classDataOff;
      const sfs = readUleb128(p); p += sfs.len;
      const ifs = readUleb128(p); p += ifs.len;
      const dms = readUleb128(p); p += dms.len;
      const vms = readUleb128(p); p += vms.len;
      for (let j = 0; j < sfs.val; j++) { const d = readUleb128(p); p += d.len; const a = readUleb128(p); p += a.len; }
      for (let j = 0; j < ifs.val; j++) { const d = readUleb128(p); p += d.len; const a = readUleb128(p); p += a.len; }
      const allMethods = [];
      let mIdx = 0;
      for (let j = 0; j < dms.val; j++) {
        const d = readUleb128(p); p += d.len; mIdx += d.val;
        const a = readUleb128(p); p += a.len;
        allMethods.push({ idx: mIdx, codeOff: readUleb128(p).val });
      }
      mIdx = 0;
      for (let j = 0; j < vms.val; j++) {
        const d = readUleb128(p); p += d.len; mIdx += d.val;
        const a = readUleb128(p); p += a.len;
        allMethods.push({ idx: mIdx, codeOff: readUleb128(p).val });
      }

      for (const m of allMethods) {
        if (m.codeOff === 0) continue;
        console.log(`\nMethod: ${getMethod(m.idx)} (codeOff: ${m.codeOff})`);
        const insnsSize = buf.readUInt32LE(m.codeOff + 12);
        const insns = buf.slice(m.codeOff + 16, m.codeOff + 16 + insnsSize * 2);
        for (let ip = 0; ip < insns.length; ip += 2) {
          const op = insns[ip];
          if (op === 0x1a) {
            const sId = insns.readUInt16LE(ip + 2);
            if (sId < stringIdsSize) console.log(`  const-string "${getString(sId)}"`);
            ip += 2;
          } else if (op >= 0x6e && op <= 0x72) {
            const mId = insns.readUInt16LE(ip + 2);
            if (mId < methodIdsSize) console.log(`  invoke ${getMethod(mId)}`);
            ip += 4;
          } else if (op === 0x13) {
            console.log(`  const/16 ${insns.readInt16LE(ip + 2)}`);
            ip += 2;
          } else if (op === 0x12) {
            console.log(`  const/4 ${insns[ip+1] >> 4}`);
          }
        }
      }
    }
  }
}

dumpClass('SetMeasureHeartRateCmd');
dumpClass('SetMeasureOxygenCmd');
dumpClass('SetSingleMeasureCmd');
