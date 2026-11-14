const http=require('http');
const B='http://localhost:'+(process.env.P||3144);
const j=async(m,u,b)=>{const r=await fetch(B+u,{method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});const x=await r.json().catch(()=>({}));x._s=r.status;return x;};
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const snap=(u)=>new Promise(res=>{http.get(B+u,r=>{let buf='';r.on('data',d=>{buf+=String(d);const m=/data: (.*)\n/.exec(buf);if(m){r.destroy();res(JSON.parse(m[1]));}});});});
const conn=(u)=>new Promise(res=>{const q=http.get(B+u,r=>{r.on('data',()=>{});res(q);});});
(async()=>{
  const r=await j('POST','/api/rooms',{name:'Lock'});const H=r.hostCode,J=r.joinCode;
  const act=a=>j('POST','/api/host/'+H+'/action',a);
  const hv=()=>snap('/api/host/'+H+'/events');
  const cids=['cidlk000001','cidlk000002','cidlk000003'];
  for(const [i,c] of cids.entries())await j('POST','/api/join/'+J+'/name',{cid:c,pw:'test1234',name:'P'+(i+1)});
  const streams=[];for(const c of cids)streams.push(await conn('/api/join/'+J+'/events?cid='+c));
  await sleep(200);
  await act({type:'add',items:['I1','I2','I3','I4']});let h=await hv();const ids=h.items.map(i=>i.id);const T=h.tiers.map(t=>t.id);
  const vote=(c,id,tier,lock)=>j('POST','/api/join/'+J+'/vote',{cid:c,itemId:id,tier,lock});
  // ---- lock-in basics
  await act({type:'open',id:ids[0]});
  ok((await vote(cids[0],ids[0],T[0]))._s===200,'a pick counts at once');
  h=await hv();ok(h.lockN.x===0&&h.lockN.y===3,'0/3 Locked In after an unlocked pick: '+JSON.stringify(h.lockN));
  ok((await vote(cids[0],ids[0],T[1]))._s===200,'an unlocked pick can change');
  ok((await vote(cids[0],ids[0],T[1],true))._s===200,'lock it in');
  ok((await vote(cids[0],ids[0],T[2]))._s===409,'a locked vote is final');
  h=await hv();ok(h.lockN.x===1,'1/3 after one lock');
  await vote(cids[1],ids[0],T[1],true);h=await hv();ok(h.lockN.x===2&&h.live.open,'2/3, still open');
  const g3=await snap('/api/join/'+J+'/events?cid='+cids[2]);ok(g3.locked===false,'guest view: not locked');
  await vote(cids[2],ids[0],T[1],true);
  h=await hv();ok(!h.live.open&&h.live.allIn>0,'everyone locked in: the poll closed at once');
  const it=h.items.find(i=>i.id===ids[0]);ok(it.final===T[1]&&it.votes===3,'all three picks counted');
  // ---- unlocked picks count when the host closes
  await act({type:'reset',id:ids[0]});
  await act({type:'open',id:ids[1]});
  await vote(cids[0],ids[1],T[0]);await vote(cids[1],ids[1],T[0],true);
  h=await hv();ok(h.live.open,'one unlocked, one not: still open');
  await act({type:'close'});h=await hv();ok(h.items.find(i=>i.id===ids[1]).votes===2,'unlocked picks count at close');
  // ---- a disconnect can complete the lock-in
  await act({type:'reset',id:ids[1]});
  await act({type:'open',id:ids[2]});
  await vote(cids[0],ids[2],T[0],true);await vote(cids[1],ids[2],T[0],true);
  h=await hv();ok(h.live.open&&h.lockN.y===3,'two of three: open');
  streams[2].destroy();await sleep(400);
  h=await hv();ok(!h.live.open,'the last unlocked guest disconnecting closes it (only connected guests count)');
  // ---- host voting joins the count
  await act({type:'reset',id:ids[2]});
  await act({type:'cfg',hostVotes:true});
  streams[2]=await conn('/api/join/'+J+'/events?cid='+cids[2]);await sleep(200);
  await act({type:'open',id:ids[3]});
  for(const c of cids)await vote(c,ids[3],T[0],true);
  h=await hv();ok(h.live.open&&h.lockN.x===3&&h.lockN.y===4,'host counts when host voting is on: '+JSON.stringify(h.lockN));
  await act({type:'hvote',id:ids[3],tier:T[0]});h=await hv();ok(h.live.open&&!h.hlock,'host pick without a lock does not close');
  await act({type:'hvote',id:ids[3],tier:T[0],lock:true});h=await hv();ok(!h.live.open&&h.live.allIn>0,'host locking last closes it');
  ok((await act({type:'hvote',id:ids[3],tier:T[1]}))._s===400,'the host can no longer vote on a closed poll');
  await act({type:'reset',id:ids[3]});await act({type:'cfg',hostVotes:false});
  // ---- Grab Bag
  await act({type:'cfg',tie:'grab'});
  const methods=new Set();
  const tieOnce=async()=>{await act({type:'open',id:ids[0]});await vote(cids[0],ids[0],T[0]);await vote(cids[1],ids[0],T[1]);await act({type:'close'});const x=await hv();const m=x.items.find(i=>i.id===ids[0]).tie.method;await act({type:'reset',id:ids[0]});return m;};
  for(let i=0;i<40;i++)methods.add(await tieOnce());
  ok(!methods.has('showdown')&&!methods.has('grab')&&['average','high','under','slots'].every(m=>methods.has(m)),'no questions: Grab Bag picks the four others, never Showdown: '+[...methods]);
  await act({type:'tpool',qs:[{q:'Q',opts:['a','b'],correct:0,expl:''}],fallback:'average'});
  const m2=new Set();for(let i=0;i<70;i++)m2.add(await tieOnce());
  ok(m2.has('showdown'),'with an unspent question Showdown is in the bag: '+[...m2]);
  // grab bag as the backup never lands on Showdown
  await act({type:'cfg',tie:'showdown'});await act({type:'tpool',qs:[{q:'Q',opts:['a','b'],correct:0,expl:''}],fallback:'grab'});
  ok((await act({type:'cfg'}))._s!==500,'config round trips');
  const m3=new Set();
  for(let i=0;i<30;i++){await act({type:'tpool',qs:[{q:'Q',opts:['a','b'],correct:0,expl:''}],fallback:'grab'});await act({type:'open',id:ids[0]});await vote(cids[0],ids[0],T[0]);await vote(cids[1],ids[0],T[1]);await act({type:'close'});
    await act({type:'tshowdown',id:ids[0]});await sleep(60);await act({type:'treveal'}).catch(()=>{});await act({type:'tdismiss'});
    const x=await hv();const t=x.items.find(i=>i.id===ids[0]).tie;if(t)m3.add(t.method);await act({type:'reset',id:ids[0]});await act({type:'treset',id:ids[0]});}
  ok(m3.size>0&&!m3.has('showdown')&&!m3.has('grab'),'Grab Bag backup never picks Showdown: '+[...m3]);
  streams.forEach(s=>s.destroy());
  console.log(fails?'FAILED '+fails:'ALL PASSED');process.exit(fails?1:0);
})();
