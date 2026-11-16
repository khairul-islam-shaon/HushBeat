const fs = require('fs');
const buf = fs.readFileSync('official_app/classes2.dex');

const stringIdsSize = buf.readUInt32LE(0x38);
const stringIdsOff = buf.readUInt32LE(0x3c);
const typeIdsSize = buf.readUInt32LE(0x40);
const typeIdsOff = buf.readUInt32LE(0x44);
const methodIdsSize = buf.readUInt32LE(0x58);
const methodIdsOff = buf.readUInt32LE(0x5c);

function getString(idx) {
  if (idx < 0 || idx >= stringIdsSize) return '';
  const off = buf.readUInt32LE(stringIdsOff + idx * 4);
  let p = off;
  while (buf[p] & 0x80) p++;
  p++;
  let end = p;
  while (buf[end] !== 0) end++;
  return buf.toString('utf8', p, end);
}
function getType(idx) {
  if (idx < 0 || idx >= typeIdsSize) return '';
  return getString(buf.readUInt32LE(typeIdsOff + idx * 4));
}
function getMethod(idx) {
  if (idx < 0 || idx >= methodIdsSize) return '';
  const classIdx = buf.readUInt16LE(methodIdsOff + idx * 8);
  const nameIdx = buf.readUInt32LE(methodIdsOff + idx * 8 + 4);
  return `${getType(classIdx)}->${getString(nameIdx)}`;
}

let cp = 0x1e1bb8;
const regSize = buf.readUInt16LE(cp); cp += 2;
const ins = buf.readUInt16LE(cp); cp += 2;
const outs = buf.readUInt16LE(cp); cp += 2;
const tries = buf.readUInt16LE(cp); cp += 2;
const debug = buf.readUInt32LE(cp); cp += 4;
const insns = buf.readUInt32LE(cp); cp += 4;

console.log('b1 insns:', insns);
for (let k = 0; k < insns; k++) {
  const word = buf.readUInt16LE(cp + k * 2);
  const op = word & 0xff;
  if (op >= 0x6e && op <= 0x72) {
    const mid = buf.readUInt16LE(cp + (k + 1) * 2);
    console.log(`  k=${k} invoke: ${getMethod(mid)}`);
  } else if (op === 0x1a || op === 0x1b) {
    const sid = buf.readUInt16LE(cp + (k + 1) * 2);
    console.log(`  k=${k} const-string: "${getString(sid)}"`);
  }
}
