const {test}=require('node:test');const assert=require('node:assert/strict');
const express=require('express');const http=require('node:http');
const {listenLocal}=require('../../server/LocalServer');
test('backend listener binds IPv4 loopback and serves local requests',async()=>{
 const app=express();app.get('/test',(_req,res)=>res.send('fixture'));
 const server=listenLocal(app,0);
 await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
 try{
  assert.equal(server.address().address,'127.0.0.1');
  const body=await new Promise((resolve,reject)=>http.get({hostname:'127.0.0.1',port:server.address().port,path:'/test'},r=>{let body='';r.on('data',d=>body+=d);r.on('end',()=>resolve(body));}).on('error',reject));
  assert.equal(body,'fixture');
 }finally{await new Promise(resolve=>server.close(resolve));}
});
