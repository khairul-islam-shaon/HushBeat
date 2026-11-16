const fs = require('fs');

function findInstantiations(dexPath, targetType) {
  const buf = fs.readFileSync(dexPath);
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

  let targetTypeIdx = -1;
  for (let i = 0; i < typeIdsSize; i++) {
    if (getType(i).includes(targetType)) {
      targetTypeIdx = i;
      break;
    }
  }
  if (targetTypeIdx === -1) return;

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
    const classDataOff = buf.readUInt32LE(cOff + 24);
    if (!classDataOff) continue;

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
      check(codeOff, className, getMethod(mIdx));
    }
    mIdx = 0;
    for (let j = 0; j < vms; j++) {
      r = readUleb128(p); mIdx += r.val; p = r.next;
      r = readUleb128(p); p = r.next;
      r = readUleb128(p); const codeOff = r.val; p = r.next;
      check(codeOff, className, getMethod(mIdx));
    }
  }

  function check(codeOff, cls, mName) {
    if (!codeOff) return;
    const insnsSize = buf.readUInt32LE(codeOff + 12);
    const insnsOff = codeOff + 16;
    for (let k = 0; k < insnsSize; k++) {
      const op = buf.readUInt16LE(insnsOff + k * 2) & 0xff;
      if (op === 0x22) { // new-instance
        const typeIdx = buf.readUInt16LE(insnsOff + (k + 1) * 2);
        if (typeIdx === targetTypeIdx) {
          console.log(`new-instance ${targetType} in ${cls} -> ${mName} (codeOff ${codeOff.toString(16)})`);
        }
      }
    }
  }
}

findInstantiations('official_app/classes.dex', 'SetAppSportDataCmd');
findInstantiations('official_app/classes2.dex', 'SetAppSportDataCmd');
