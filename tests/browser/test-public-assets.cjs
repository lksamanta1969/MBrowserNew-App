const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const express=require('express');const http=require('node:http');
const {mountPublicAssets}=require('../../server/PublicAssets');
function get(port,url){return new Promise((resolve,reject)=>{http.get({hostname:'127.0.0.1',port,path:url},r=>{let body='';r.on('data',d=>body+=d);r.on('end',()=>resolve({status:r.statusCode,body}));}).on('error',reject);});}
test('public app assets work while repository data and source stay inaccessible',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mbrowser-assets-test-'));
 fs.mkdirSync(path.join(root,'apps','mmail'),{recursive:true});
 fs.writeFileSync(path.join(root,'apps','mmail','index.html'),'<h1>Test app</h1>');
 fs.writeFileSync(path.join(root,'apps','mmail','style.css'),'body {}');
 fs.writeFileSync(path.join(root,'maildb.json'),'PRIVATE_FIXTURE');
 fs.writeFileSync(path.join(root,'server.js'),'PRIVATE_SOURCE_FIXTURE');
 fs.writeFileSync(path.join(root,'mbrowser-logo.ico'),'TEST_ICON');
 const app=express();mountPublicAssets(app,root);const server=app.listen(0,'127.0.0.1');
 await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
 try {
  const port=server.address().port;
  assert.equal((await get(port,'/apps/mmail/index.html?v=123')).status,200);
  assert.equal((await get(port,'/apps/mmail/style.css')).status,200);
  assert.equal((await get(port,'/mbrowser-logo.ico')).status,200);
  for(const url of ['/maildb.json','/server.js','/package.json','/.env','/mdrive/private.pdf','/apps/../maildb.json','/apps/%2e%2e/maildb.json']){
   const r=await get(port,url);assert.ok(r.status>=400,url);assert.ok(!r.body.includes('PRIVATE_FIXTURE'),url);
  }
 } finally {await new Promise(resolve=>server.close(resolve));
  const tmpRoot=fs.realpathSync(os.tmpdir());const actual=fs.realpathSync(root);
  assert.ok(actual.startsWith(tmpRoot+path.sep) && path.basename(actual).startsWith('mbrowser-assets-test-'));
  fs.rmSync(actual,{recursive:true,force:true});
 }
});
