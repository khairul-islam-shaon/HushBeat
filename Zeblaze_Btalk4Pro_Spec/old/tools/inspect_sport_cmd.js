const fs = require('fs');

function inspectSetAppSportDataCmd(dexPath) {
  const buf = fs.readFileSync(dexPath);
  const stringIdsSize = buf.readUInt32LE(0x38);
  const stringIdsOff = buf.readUInt32LE(0x3c);
  const typeIdsSize = buf.readUInt32LE(0x40);
  const typeIdsOff = buf.readUInt32LE(0x44);
  const fieldIdsSize = buf.readUInt32LE(0x50);
  const fieldIdsOff = buf.readUInt32LE(0x54);
  const methodIdsSize = buf.readUInt32LE(0x58);
  const methodIdsOff = buf.readUInt32LE(0x5c);
  const classDefsSize = buf.readUInt32LE(0x60);
  const classDefsOff = buf.readUInt32LE(0x64);

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

  function getField(idx) {
    if (idx < 0 || idx >= fieldIdsSize) return '';
    const classIdx = buf.readUInt16LE(fieldIdsOff + idx * 8);
    const typeIdx = buf.readUInt16LE(fieldIdsOff + idx * 8 + 2);
    const nameIdx = buf.readUInt32LE(fieldIdsOff + idx * 8 + 4);
    return `${getType(classIdx)}->${getString(nameIdx)}:${getType(typeIdx)}`;
  }

  function readUleb128(p) {
    let result = 0;
    let shift = 0;
    while (true) {
      let b = buf[p++];
      result |= (b & 0x7f) << shift;
      shift += 7;
      if (!(b & 0x80)) break;
    }
    return { val: result, next: p };
  }

  for (let i = 0; i < classDefsSize; i++) {
    const cOff = classDefsOff + i * 32;
    const classIdx = buf.readUInt32LE(cOff);
    const className = getType(classIdx);
    if (!className.includes('SetAppSportDataCmd')) continue;

    console.log('Class:', className);
    const classDataOff = buf.readUInt32LE(cOff + 24);
    let p = classDataOff;
    let r = readUleb128(p); const sfs = r.val; p = r.next;
    r = readUleb128(p); const ifs = r.val; p = r.next;
    r = readUleb128(p); const dms = r.val; p = r.next;
    r = readUleb128(p); const vms = r.val; p = r.next;

    for (let j = 0; j < sfs + ifs; j++) {
      r = readUleb128(p); p = r.next;
      r = readUleb128(p); p = r.next;
    }

    let mIdx = 0;
    for (let j = 0; j < dms; j++) {
      r = readUleb128(p); mIdx += r.val; p = r.next;
      r = readUleb128(p); p = r.next;
      r = readUleb128(p); const codeOff = r.val; p = r.next;
      dumpMethod(codeOff, getMethod(mIdx));
    }
    mIdx = 0;
    for (let j = 0; j < vms; j++) {
      r = readUleb128(p); mIdx += r.val; p = r.next;
      r = readUleb128(p); p = r.next;
      r = readUleb128(p); const codeOff = r.val; p = r.next;
      dumpMethod(codeOff, getMethod(mIdx));
    }
  }

  function dumpMethod(codeOff, mName) {
    if (!codeOff) return;
    const insnsSize = buf.readUInt32LE(codeOff + 12);
    const insnsOff = codeOff + 16;
    console.log(`Method: ${mName} (insns: ${insnsSize})`);
    for (let k = 0; k < insnsSize; k++) {
      const op = buf.readUInt16LE(insnsOff + k * 2) & 0xff;
      if (op >= 0x6e && op <= 0x72) {
        const mid = buf.readUInt16LE(insnsOff + (k + 1) * 2);
        console.log(`  k=${k} invoke: ${getMethod(mid)}`);
      } else if (op === 0x1a || op === 0x1b) {
        const sid = buf.readUInt16LE(insnsOff + (k + 1) * 2);
        console.log(`  k=${k} const-string: "${getString(sid)}"`);
      } else if (op >= 0x52 && op <= 0x5f) {
        const fid = buf.readUInt16LE(insnsOff + (k + 1) * 2);
        console.log(`  k=${k} field: ${getField(fid)}`);
      }
    }
  }
}

inspectSetAppSportDataCmd('official_app/classes.dex');
inspectSetAppSportDataCmd('official_app/classes2.dex');
