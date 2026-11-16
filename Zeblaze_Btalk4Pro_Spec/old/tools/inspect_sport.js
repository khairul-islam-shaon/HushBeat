const fs = require('fs');

function inspectClass(dexPath, targetClassName) {
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
    const off = classDefsOff + i * 32;
    const classIdx = buf.readUInt32LE(off);
    const name = getType(classIdx);
    if (name.includes(targetClassName)) {
      console.log('=== Class:', name, '===');
      const classDataOff = buf.readUInt32LE(off + 24);
      if (classDataOff === 0) continue;
      let p = classDataOff;
      let r = readUleb128(p); const staticFieldsSize = r.val; p = r.next;
      r = readUleb128(p); const instanceFieldsSize = r.val; p = r.next;
      r = readUleb128(p); const directMethodsSize = r.val; p = r.next;
      r = readUleb128(p); const virtualMethodsSize = r.val; p = r.next;

      // skip fields
      for (let j = 0; j < staticFieldsSize + instanceFieldsSize; j++) {
        r = readUleb128(p); p = r.next;
        r = readUleb128(p); p = r.next;
      }

      let methodIdx = 0;
      for (let j = 0; j < directMethodsSize + virtualMethodsSize; j++) {
        r = readUleb128(p); methodIdx += r.val; p = r.next;
        r = readUleb128(p); const accessFlags = r.val; p = r.next;
        r = readUleb128(p); const codeOff = r.val; p = r.next;
        console.log('  Method:', getMethod(methodIdx), 'codeOff:', codeOff.toString(16));
      }
    }
  }
}

inspectClass('official_app/classes2.dex', 'SportFragment_ViewBinding');
inspectClass('official_app/classes2.dex', 'SportFragment');
