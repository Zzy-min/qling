import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validatePackaging } from '../../scripts/validate-packaging.mjs';
const source = new URL('../../', import.meta.url);
async function fixture() {
  const dir=await mkdtemp(join(tmpdir(),'qling-packaging-fixture-'));
  await cp(new URL('packaging/',source),join(dir,'packaging'),{recursive:true});
  await cp(new URL('package.json',source),join(dir,'package.json'));
  return dir;
}
async function jsonEdit(dir,path,edit) {
  const file=join(dir,path), value=JSON.parse(await readFile(file,'utf8'));edit(value);await writeFile(file,JSON.stringify(value));
}
test('source validation preserves published 1.4.1 while release gate rejects unpublished 1.5.0',async()=>{
  const dir=await fixture();const result=await validatePackaging(dir);
  assert.equal(result.sourceVersion,'1.5.0');assert.equal(result.publishedVersion,'1.4.1');assert.deepEqual(result.errors,[]);
  assert.match((await validatePackaging(dir,{release:true})).errors.join(' '),/release pending/);
  await jsonEdit(dir,'package.json',p=>p.version='1.4.1');assert.match((await validatePackaging(dir,{release:true})).errors.join(' '),/missing release artifact/);
});
test('source version cannot trail published installer state',async()=>{
  const dir=await fixture();await jsonEdit(dir,'package.json',p=>p.version='1.4.0');assert.match((await validatePackaging(dir)).errors.join(' '),/older than published/);
});
for(const field of ['version','url','hash']) test(`source validation still rejects mismatched bucket ${field}`,async()=>{
  const dir=await fixture();await jsonEdit(dir,'packaging/scoop-bucket/qling.json',p=>{
    if(field==='version')p.version='1.4.0';else p.architecture['64bit'][field]=field==='hash'?'a'.repeat(64):'https://example.invalid/v1.4.1.zip';
  });assert.ok((await validatePackaging(dir)).errors.length);
});
test('source validation rejects WinGet artifact/hash mismatch and invalid Scoop URL pin',async()=>{
  const dir=await fixture();const path=join(dir,'packaging/winget/Zzy-min.qling.yaml');
  await writeFile(path,(await readFile(path,'utf8')).replace(/InstallerSha256: [a-f0-9]+/,'InstallerSha256: '+'a'.repeat(64)));
  assert.match((await validatePackaging(dir)).errors.join(' '),/hash differs/);
  await jsonEdit(dir,'packaging/scoop/qling.json',p=>p.architecture['64bit'].url='https://example.invalid/1.4.1');
  assert.match((await validatePackaging(dir)).errors.join(' '),/url does not pin/);
});
import { createHash } from 'node:crypto';
async function equalVersionArtifactFixture() {
  const dir=await fixture();await jsonEdit(dir,'package.json',p=>p.version='1.4.1');
  const bytes=Buffer.from('504b05060000000000000000000000000000000000000000','hex'),hash=createHash('sha256').update(bytes).digest('hex');
  for(const path of ['packaging/scoop/qling.json','packaging/scoop-bucket/qling.json'])await jsonEdit(dir,path,p=>p.architecture['64bit'].hash=hash);
  for(const path of ['packaging/winget/Zzy-min.qling.yaml','packaging/winget/manifests/Zzy-min/qling/1.4.1/Zzy-min.qling.installer.yaml']){
    const file=join(dir,path);await writeFile(file,(await readFile(file,'utf8')).replace(/InstallerSha256: [a-f0-9]+/,'InstallerSha256: '+hash));
  }
  await mkdir(join(dir,'dist-portable'));
  await writeFile(join(dir,'dist-portable/qling-win-x64.zip'),bytes);
  await writeFile(join(dir,'dist-portable/portable-meta.json'),JSON.stringify({version:'1.4.1',zip:'qling-win-x64.zip',size:bytes.length,sha256:hash}));
  return dir;
}
test('equal version release hashes actual artifact bytes, source validation needs no artifact',async()=>{
  const dir=await equalVersionArtifactFixture();assert.deepEqual((await validatePackaging(dir,{release:true})).errors,[]);
  await writeFile(join(dir,'dist-portable/qling-win-x64.zip'),'different actual ZIP bytes');
  assert.match((await validatePackaging(dir,{release:true})).errors.join(' '),/artifact SHA-256/);assert.deepEqual((await validatePackaging(dir)).errors,[]);
  const missing=await fixture();await jsonEdit(missing,'package.json',p=>p.version='1.4.1');assert.match((await validatePackaging(missing,{release:true})).errors.join(' '),/missing release artifact/);assert.deepEqual((await validatePackaging(missing)).errors,[]);
});
test('equal version release requires metadata matching version filename size and digest',async()=>{
  for(const [field,value] of [['version','1.4.0'],['zip','wrong.zip'],['size',1],['sha256','a'.repeat(64)]]){
    const dir=await equalVersionArtifactFixture();await jsonEdit(dir,'dist-portable/portable-meta.json',p=>p[field]=value);assert.match((await validatePackaging(dir,{release:true})).errors.join(' '),/portable metadata/);
  }
});
