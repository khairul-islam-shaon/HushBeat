const fs=require('fs');const L=fs.readFileSync(process.argv[2],'utf8').split('\n').filter(l=>/h=0x001[68]/.test(l));
const crc=b=>{let c=0xffff;for(const x of b){c^=x<<8;for(let i=0;i<8;i++)c=c&0x8000?((c<<1)^0x1021)&0xffff:(c<<1)&0xffff}return c};
const fr=L.map(l=>{const m=l.match(/^(\S+) \S+ (\S+) .*\] ([0-9a-f]+)$/);return {t:m[1],dir:m[2],b:Buffer.from(m[3],'hex')}});
let ok=0,bad=0;for(const f of fr){if(f.b[0]!==0xaa)continue;const n=f.b.length;const c=crc(f.b.subarray(0,n-2));const s=f.b[n-2]|f.b[n-1]<<8;c===s?ok++:(bad++,console.log('CRC BAD',f.t,f.b.toString('hex')))}
console.log(`AA frames CRC ok=${ok} bad=${bad}`);
// length check for groups 00-05,80
let lb=[];for(const f of fr){const g=f.b[0];if(g<=5||g==0x80){if(f.b[2]!==f.b.length&&!(g==3&&f.b[1]==0x84))lb.push(`${f.t} ${f.dir} ${f.b.toString('hex')} len=${f.b.length} b2=${f.b[2]}`)}}
console.log('Frames where byte2 != frame length:\n '+lb.join('\n '));
// reassemble AA 05 responses
let parts=[];const recs=[];for(const f of fr){const b=f.b;if(b[0]!==0xaa||b[1]!==5)continue;
 if(b[3]&0x80){const tot=b[4]|b[5]<<8,idx=b[6]|b[7]<<8;parts.push(b.subarray(8,b.length-2));if(idx===tot){recs.push({t:f.t,p:Buffer.concat(parts),declared:b[2]|(b[3]&0x7f)<<8});parts=[]}}
 else recs.push({t:f.t,p:b.subarray(4,b.length-2),declared:b[2]|b[3]<<8});}
for(const r of recs){const p=r.p;console.log(`\n${r.t} type=${p[0]} count=${p[1]} payloadLen=${p.length} declared=${r.declared}`);
 if(p[0]==1){const day=p[2],len=p[3],d=p.subarray(4,4+len);const half=[];for(let i=0;i<48;i++)half.push(d.readUInt16LE(i*2));
  console.log(` steps day=${day} len=${len} halfhours nonzero=${JSON.stringify(half.map((v,i)=>v?`${i}:${v}`:null).filter(Boolean))} total=${d.readUInt32LE(96)} kcal=${d.readUInt32LE(100)} dist=${d.readUInt32LE(104)}`)}
 if(p[0]==2){const day=p[2],len=p[3]|p[4]<<8,d=p.subarray(5,5+len);const v=[...d].map((x,i)=>x>0&&x<255?`${String(Math.floor(i*5/60)).padStart(2,'0')}:${String(i*5%60).padStart(2,'0')}=${x}`:null).filter(Boolean);
  console.log(` HR day=${day} len=${len} valid=${v.length} min=${Math.min(...d.filter(x=>x>0&&x<255))} max=${Math.max(...d.filter(x=>x>0&&x<255))} avg=${(d.filter(x=>x>0&&x<255).reduce((a,b)=>a+b,0)/v.length).toFixed(1)}\n  ${v.join(' ')}`)}
 if(p[0]==3)console.log(' sleep raw',p.toString('hex'));
 if(p[0]==4)console.log(' exercise raw',p.toString('hex'));}
