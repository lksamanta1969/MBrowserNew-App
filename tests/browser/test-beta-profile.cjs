const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const {resolveBetaProfile}=require('../../server/BetaProfile');
test('development retains existing user profile',()=>{
 const old=path.resolve('fixture-development');assert.equal(resolveBetaProfile({isPackaged:false,currentUserDataPath:old}),old);
});
test('packaged Beta selects dedicated profile independently of development',()=>{
 const base=path.resolve('fixture-app-data');const old=path.join(base,'mbrowser');
 const beta=resolveBetaProfile({isPackaged:true,appDataPath:base,currentUserDataPath:old});
 assert.equal(beta,path.join(base,'MBrowser Beta'));assert.notEqual(beta,old);
});
test('packaged Beta rejects absent or relative app data path',()=>{
 assert.throws(()=>resolveBetaProfile({isPackaged:true}),/valid app data/);
 assert.throws(()=>resolveBetaProfile({isPackaged:true,appDataPath:'relative'}),/valid app data/);
});
