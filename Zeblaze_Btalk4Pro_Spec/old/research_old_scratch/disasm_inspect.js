const fs = require('fs');
const buf = fs.readFileSync('scratch/zc_dex/classes.dex');

const stringIdsOff = buf.readUInt32LE(0x3c);
const typeIdsOff = buf.readUInt32LE(0x44);
const methodIdsOff = buf.readUInt32LE(0x5c);

function getString(idx) {
  const off = buf.readUInt32LE(stringIdsOff + idx * 4);
  let p = off;
  while (buf[p] & 0x80) p++;
  p++;
  let end = p;
  while (buf[end] !== 0) end++;
  return buf.toString('utf8', p, end);
}
function getType(idx) { return getString(buf.readUInt32LE(typeIdsOff + idx * 4)); }
function getMethod(idx) {
  const c = buf.readUInt16LE(methodIdsOff + idx * 8);
  const n = buf.readUInt32LE(methodIdsOff + idx * 8 + 4);
  return getType(c) + '->' + getString(n);
}

const codeOff = 4224732;
const insnsSize = buf.readUInt32LE(codeOff + 12);
const insns = buf.subarray(codeOff + 16, codeOff + 16 + insnsSize * 2);

function dumpRange(startPc, endPc) {
  let ip = startPc * 2;
  while (ip < endPc * 2 && ip < insns.length) {
    const pc = ip / 2;
    const op = insns[ip];
    const b1 = insns[ip + 1];
    let len = 2;
    let text = `[${pc.toString(16).padStart(4, '0')}] op=0x${op.toString(16).padStart(2, '0')}`;
    
    if (op === 0x12) { // const/4
      text += ` const/4 v${b1 & 0xf}, ${b1 >> 4}`;
    } else if (op === 0x13) { // const/16
      const val = insns.readInt16LE(ip + 2);
      text += ` const/16 v${b1}, ${val} (0x${(val & 0xffff).toString(16)})`;
      len = 4;
    } else if (op === 0x14) { // const
      const val = insns.readInt32LE(ip + 2);
      text += ` const v${b1}, ${val}`;
      len = 6;
    } else if (op === 0x1a) { // const-string
      const s = getString(insns.readUInt16LE(ip + 2));
      text += ` const-string v${b1}, "${s}"`;
      len = 4;
    } else if (op >= 0x6e && op <= 0x72) { // invoke
      const m = getMethod(insns.readUInt16LE(ip + 2));
      const count = b1 >> 4;
      const vC = insns[ip + 4] & 0xf;
      const vD = (insns[ip + 4] >> 4) & 0xf;
      const vE = insns[ip + 5] & 0xf;
      const vF = (insns[ip + 5] >> 4) & 0xf;
      const vG = insns[ip + 1] & 0xf;
      const args = [vC, vD, vE, vF, vG].slice(0, count).map(v => 'v' + v).join(', ');
      text += ` invoke op=0x${op.toString(16)} {${args}} ${m}`;
      len = 6;
    } else if (op === 0x0a) { // move-result
      text += ` move-result v${b1}`;
    } else if (op === 0x0c) { // move-result-object
      text += ` move-result-object v${b1}`;
    } else if (op === 0x0e) { // return-void
      text += ` return-void`;
    } else if (op === 0x22) { // new-instance
      text += ` new-instance v${b1}, ${getType(insns.readUInt16LE(ip + 2))}`;
      len = 4;
    } else if (op === 0x38 || op === 0x39) { // if-eqz / if-nez
      const offset = insns.readInt16LE(ip + 2);
      text += ` if-${op === 0x38 ? 'eqz' : 'nez'} v${b1} -> pc=0x${(pc + offset).toString(16)}`;
      len = 4;
    } else if (op === 0x32 || op === 0x33) { // if-eq / if-ne
      const offset = insns.readInt16LE(ip + 2);
      text += ` if-${op === 0x32 ? 'eq' : 'ne'} v${b1 & 0xf}, v${b1 >> 4} -> pc=0x${(pc + offset).toString(16)}`;
      len = 4;
    } else if (op === 0x28) {
      const offset = insns.readInt8(ip + 1);
      text += ` goto -> pc=0x${(pc + offset).toString(16)}`;
    } else if (op === 0x29) {
      const offset = insns.readInt16LE(ip + 2);
      text += ` goto/16 -> pc=0x${(pc + offset).toString(16)}`;
      len = 4;
    } else if (op === 0x2b) { // packed-switch
      const offset = insns.readInt32LE(ip + 2);
      const tablePos = ip + offset * 2;
      const size = insns.readUInt16LE(tablePos + 2);
      const firstKey = insns.readInt32LE(tablePos + 4);
      text += ` packed-switch v${b1} (size=${size}, firstKey=${firstKey}) tablePos=0x${(tablePos/2).toString(16)}`;
      len = 6;
      // print table targets
      for (let k = 0; k < size; k++) {
        const targetOffset = insns.readInt32LE(tablePos + 8 + k * 4);
        console.log(`    key ${firstKey + k} -> target pc=0x${(pc + targetOffset).toString(16)}`);
      }
    }
    console.log(text);
    ip += len;
  }
}

console.log('=== Single Measure 0x84 switch ===');
dumpRange(0x1aa, 0x1f0);

console.log('=== Single Measure Blood Oxygen & Heart Rate (0x340 - 0x410) ===');
dumpRange(0x340, 0x410);
