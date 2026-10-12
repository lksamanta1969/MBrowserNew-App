const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const {resolveMDriveRoot}=require('../../server/MDriveDataPath');
test('development MDrive retains existing source folder',()=>{
 const root=path.resolve('fixture-app');assert.equal(resolveMDriveRoot(root),path.join(root,'mdrive'));
});
test('installed MDrive selects user folder and rejects missing user data path',()=>{
 const root=path.resolve('fixture-install'),user=path.resolve('fixture-user');
 assert.equal(resolveMDriveRoot(root,{isPackaged:true,userDataPath:user}),path.join(user,'mdrive'));
 assert.throws(()=>resolveMDriveRoot(root,{isPackaged:true}),/valid user data path/);
 assert.throws(()=>resolveMDriveRoot(root,{isPackaged:true,userDataPath:'relative'}),/valid user data path/);
});
