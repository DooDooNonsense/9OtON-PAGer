const B='http://localhost:'+(process.env.P||3140);
const j=async(m,u,b)=>{const r=await fetch(B+u,{method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});const x=await r.json().catch(()=>({}));x._s=r.status;return x;};
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const r=await j('POST','/api/rooms',{name:'PW'});const H=r.hostCode,J=r.joinCode;
  const act=a=>j('POST','/api/host/'+H+'/action',a);
  const nm=(cid,name,pw,claim)=>j('POST','/api/join/'+J+'/name',{cid,name,pw,claim});
  const snap=(u)=>new Promise(ok=>{require('http').get(B+u,res=>{let buf='';res.on('data',d=>{buf+=String(d);const m=/data: (.*)\n/.exec(buf);if(m){res.destroy();ok(JSON.parse(m[1]));}});});});
  // password rules
  ok((await nm('cidpw000001','Ann'))._s===400,'password required');
  ok((await nm('cidpw000001','Ann','abc'))._s===400,'3 characters is too short');
  ok((await nm('cidpw000001','Ann','x'.repeat(65)))._s===400,'65 characters is too long');
  ok((await nm('cidpw000001','Ann','abcd'))._s===200,'4 characters ok');
  // same device re-enters, rename needs no password
  ok((await nm('cidpw000001','Annie'))._s===200,'rename without password');
  // empty-key names compare by text
  ok((await nm('cidpw000002','...','pass1'))._s===200,'dots name joins');
  ok((await nm('cidpw000003','...','pass1'))._s===409,'same dots name is taken');
  ok((await nm('cidpw000003','___','pass1'))._s===200,'a different symbol-only name is fine');
  // claim
  let x=await nm('cidpw000009','annie','wrong',true);ok(x._s===403&&/doesn.t match/.test(x.error),'wrong password: '+x.error);
  for(let i=0;i<8;i++)x=await nm('cidpw000009','annie','wrong',true);ok(x._s===403,'no lock-out after repeated tries');
  // give Annie a vote so we can watch it move
  await act({type:'add',items:['I1','I2']});
  x=await nm('cidpw000009','annie','abcd',true);ok(x._s===200&&x.claimed,'right password claims');
  x=await nm('cidpw000001','Annie','abcd');ok(x._s===409,'old device no longer owns the name');
  // old device is signed out: its state has no name
  const st=await snap('/api/join/'+J+'/events?cid=cidpw000001');
  ok(!st||!st.me||!st.me.name,'old device signed out');
  // claiming a name without a password-on-file is refused, and unknown names are free
  x=await nm('cidpw000010','Nobody','abcd',true);ok(x._s===409,'claim of a free name says it is free');
  console.log(fails?'FAILED '+fails:'ALL PASSED');process.exit(fails?1:0);
})();
