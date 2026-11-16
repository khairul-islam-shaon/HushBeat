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
    const classDataOff = buf.readUInt32LE(cOff + 24);
    let p = classDataOff;
    const sfs = readUleb128(p); p += sfs.len;
    const ifs = readUleb128(p); p += ifs.len;
    const dms = readUleb128(p); p += dms.len;
    const vms = readUleb128(p); p += vms.len;
    for (let j = 0; j < sfs.val; j++) { const d = readUleb128(p); p += d.len; const a = readUleb128(p); p += a.len; }
    for (let j = 0; j < ifs.val; j++) { const d = readUleb128(p); p += d.len; const a = readUleb128(p); p += a.len; }
    
    let mIdx = 0;
    for (let j = 0; j < dms.val; j++) {
      const d = readUleb128(p); p += d.len; mIdx += d.val;
      readUleb128(p); readUleb128(p);
    }
    mIdx = 0;
    for (let j = 0; j < vms.val; j++) {
      const d = readUleb128(p); p += d.len; mIdx += d.val;
      const access = readUleb128(p);
      const codeOff = readUleb128(p).val;
      if (codeOff === 0) continue;
      
      const insnsSize = buf.readUInt32LE(codeOff + 12);
      const insns = buf.slice(codeOff + 16, codeOff + 16 + insnsSize * 2);
      // check if it has 29 (0x1d)
      let has29 = false;
      for (let ip = 0; ip < insns.length; ip += 2) {
        if (insns[ip] === 0x13 && insns.readInt16LE(ip + 2) === 41) has29 = true;
      }
      if (has29) {
        console.log(`Method with 29: ${getMethod(mIdx)} (codeOff: ${codeOff})`);
        for (let ip = 0; ip < insns.length; ip += 2) {
          const pc = ip / 2;
          console.log(`  [${pc.toString(16).padStart(3, '0')}] op=${insns[ip].toString(16)} hex=${insns.slice(ip, ip + 4).toString('hex')}`);
        }
      }
    }
  }
}
