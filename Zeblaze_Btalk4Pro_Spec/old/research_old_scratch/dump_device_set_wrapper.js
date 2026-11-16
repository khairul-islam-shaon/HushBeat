const fs = require('fs');

const buf = fs.readFileSync('d:/Zeblaze/scratch/zc_dex/classes.dex');

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

for (let i = 0; i < classDefsSize; i++) {
  const cOff = classDefsOff + i * 32;
  const cName = getType(buf.readUInt32LE(cOff));
  if (cName === 'Lcom/antjy/sdk/protocol/wrapper/DeviceSetCmdWrapper;') {
    console.log(`\n================ ${cName} ================`);
    const classDataOff = buf.readUInt32LE(cOff + 24);
    let p = classDataOff;
    const sfs = readUleb128(p); p += sfs.len;
    const ifs = readUleb128(p); p += ifs.len;
    const dms = readUleb128(p); p += dms.len;
    const vms = readUleb128(p); p += vms.len;
    for (let j = 0; j < sfs.val; j++) { const d = readUleb128(p); p += d.len; const a = readUleb128(p); p += a.len; }
    for (let j = 0; j < ifs.val; j++) { const d = readUleb128(p); p += d.len; const a = readUleb128(p); p += a.len; }
    const allMethods = [];
    let mIdx = 0;
    for (let j = 0; j < dms.val; j++) { const d = readUleb128(p); p += d.len; mIdx += d.val; const a = readUleb128(p); p += a.len; allMethods.push({ idx: mIdx, codeOff: readUleb128(p).val }); }
    mIdx = 0;
    for (let j = 0; j < vms.val; j++) { const d = readUleb128(p); p += d.len; mIdx += d.val; const a = readUleb128(p); p += a.len; allMethods.push({ idx: mIdx, codeOff: readUleb128(p).val }); }

    for (const m of allMethods) {
      if (m.codeOff === 0) continue;
      console.log(`\nMethod: ${getMethod(m.idx)} (codeOff: ${m.codeOff})`);
      const insnsSize = buf.readUInt32LE(m.codeOff + 12);
      const insns = buf.slice(m.codeOff + 16, m.codeOff + 16 + insnsSize * 2);
      const byteList = [];
      for (let ip = 0; ip < insns.length; ip += 2) {
        const op = insns[ip];
        if (op === 0x12) byteList.push(`const/4:${insns[ip+1] >> 4}`);
        else if (op === 0x13) byteList.push(`const/16:${insns.readInt16LE(ip + 2)}`);
        else if (op === 0x4f) byteList.push(`aput-byte`);
        else if (op === 0x22) byteList.push(`new-instance`);
        else if (op === 0x70 || op === 0x71) {
          const mid = insns.readUInt16LE(ip + 2);
          if (mid < methodIdsSize) byteList.push(`call:${getString(buf.readUInt32LE(methodIdsOff + mid * 8 + 4))}`);
        }
      }
      console.log(`  Opcodes: ${byteList.join(', ')}`);
    }
  }
}
