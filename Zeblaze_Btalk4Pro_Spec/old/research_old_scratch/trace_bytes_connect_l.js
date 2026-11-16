const fs = require('fs');

const buf = fs.readFileSync('d:/Zeblaze/scratch/zc_dex/classes.dex');

const stringIdsSize = buf.readUInt32LE(0x38);
const stringIdsOff = buf.readUInt32LE(0x3c);
const typeIdsSize = buf.readUInt32LE(0x40);
const typeIdsOff = buf.readUInt32LE(0x44);
const methodIdsSize = buf.readUInt32LE(0x58);
const methodIdsOff = buf.readUInt32LE(0x5c);

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
  return `${getType(classIdx)}->${getString(nameIdx)}`;
}

// In BytesDataConnect::L (codeOff: 4172420)
const codeOff = 4172420;
const insnsSize = buf.readUInt32LE(codeOff + 12);
const insns = buf.slice(codeOff + 16, codeOff + 16 + insnsSize * 2);

console.log('BytesDataConnect::L insnsSize:', insnsSize);
for (let ip = 0; ip < insns.length; ip += 2) {
  const pc = ip / 2;
  const op = insns[ip];
  if (op >= 0x6e && op <= 0x72) {
    const mid = insns.readUInt16LE(ip + 2);
    if (mid < methodIdsSize) {
      const callee = getMethod(mid);
      console.log(`[${pc.toString(16)}] invoke ${callee}`);
    }
  } else if (op === 0x1a) {
    const sid = insns.readUInt16LE(ip + 2);
    if (sid < stringIdsSize) console.log(`[${pc.toString(16)}] string: "${getString(sid)}"`);
  }
}
