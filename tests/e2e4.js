const B='http://localhost:3114';
const j=async(m,u,b)=>{const r=await fetch(B+u,{method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});const x=await r.json().catch(()=>({}));x._s=r.status;return x;};
const snap=(u)=>new Promise(ok=>{require('http').get(B+u,res=>{let buf='';res.on('data',d=>{buf+=String(d);const m=/data: (.*)\n/.exec(buf);if(m){res.destroy();ok(JSON.parse(m[1]));}});});});
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const r=await j('POST','/api/rooms',{name:'T'});const H=r.hostCode,J=r.joinCode;
  const act=a=>j('POST','/api/host/'+H+'/action',a);
  const g=c=>'guestguest'+c;
  const nm=(c,n)=>j('POST','/api/join/'+J+'/name',{cid:g(c),pw:'test1234',name:n});
  const L={};
  const live=c=>new Promise(res=>{require('http').get(B+'/api/join/'+J+'/events?cid='+g(c),rs=>{L[c]={rs,d:null};let buf='';rs.on('data',d=>{buf+=String(d);let m;while((m=/data: (.*)\n\n/.exec(buf))){L[c].d=JSON.parse(m[1]);buf=buf.slice(m.index+m[0].length);res();}});});});
  const gv=async c=>{await sleep(120);return L[c].d;};
  const hv=()=>snap('/api/host/'+H+'/events');
  await act({type:'add',items:['Tacos','Pizza']});
  let h0=await hv();const id=h0.items.find(i=>i.name==='Tacos').id,id2=h0.items.find(i=>i.name==='Pizza').id;
  await act({type:'edit',id,rc:{kind:'trivia',qs:[{q:'Q1',opts:['a','b','c'],correct:1,expl:'bb'},{q:'Q2',opts:['x','y'],correct:0,expl:'ex'}]}});
  await act({type:'edit',id:id2,rc:{kind:'text',title:'T2',text:'hello'}});
  await act({type:'cfg',timer:5});
  await nm(1,'Ann');await nm(2,'Bob');await nm(3,'Cy');await nm(5,'Eve');await nm(6,'Gil');await nm(7,'Hal');
  await live(1);await live(2);await live(3);
  await act({type:'open',id});
  for(const c of [1,2,3])await j('POST','/api/join/'+J+'/vote',{cid:g(c),itemId:id,tier:'A'});
  await act({type:'close'});await act({type:'reveal',id});
  // a stranger is still on the name screen when the host starts trivia
  await live(4);
  ok((await act({type:'tstart',id}))._s===200,'tstart ok');
  let h=await hv();
  ok(h.tr&&h.tr.phase==='hold'&&h.tr.joining===1,'host sees hold with 1 joining');
  ok((await gv(1)).tr===null,'guests have no trivia during hold');
  await nm(4,'Dee');
  await sleep(200);
  h=await hv();ok(h.tr.phase==='countdown','naming in releases the hold');
  ok(!(await gv(4)).hold,'name-screen joiner during the hold is not held');
  // host override
  await act({type:'tdismiss'});
  await live(8); // unnamed
  await act({type:'tstart',id});h=await hv();ok(h.tr.phase==='hold','hold again');
  ok((await act({type:'tgo'}))._s===200,'host proceeds');
  h=await hv();ok(h.tr.phase==='countdown','tgo starts the countdown');
  L[8].rs.destroy();
  await act({type:'tdismiss'});
  await act({type:'treset',id});
  // clean run of question 1
  await act({type:'tstart',id});
  await sleep(3300);
  h=await hv();const qid=h.tr.qid;ok(h.tr.phase==='question','question running');
  const A=(c,p,lock)=>j('POST','/api/join/'+J+'/answer',{cid:g(c),itemId:id,qid,pick:p,lock:!!lock});
  await A(1,1,true);await A(2,0,true);
  h=await hv();ok(h.tr.phase==='question'&&h.tr.ready===4&&h.tr.lockedN===2,'2 of 4 locked: '+h.tr.lockedN+'/'+h.tr.ready);
  await A(3,1,true);
  h=await hv();ok(h.tr.phase==='question','still waiting on Dee');
  await A(4,1,true);
  h=await hv();ok(h.tr.phase==='results','all locked in ends the timer early');
  ok((await gv(1)).tr.phase==='results','guests see results phase');
  await act({type:'treveal'});
  // Eve (named, not connected) arrives while the answer is showing -> wait screen
  await live(5);
  let e=await gv(5);ok(e.hold&&e.hold.state==='wait'&&e.tr===null,'arrival during reveal waits');
  // question 2
  await act({type:'tstart',id});
  await sleep(3300);
  h=await hv();const qid2=h.tr.qid;ok(h.tr.qi===1&&h.tr.phase==='question','Q2 running');
  e=await gv(5);ok(!e.hold&&e.tr&&e.tr.phase==='question','waiting guest joins on next question');
  await live(6);await live(7);
  let gl=await gv(6);ok(gl.hold&&gl.hold.state==='ask'&&gl.tr===null,'returning guest gets the hold prompt');
  const A2=(c,p,lock)=>j('POST','/api/join/'+J+'/answer',{cid:g(c),itemId:id,qid:qid2,pick:p,lock:!!lock});
  ok((await A2(6,0,true))._s===409,'held guest cannot answer');
  ok((await j('POST','/api/join/'+J+'/proceed',{cid:g(6)}))._s===200,'proceed');
  gl=await gv(6);ok(!gl.hold&&gl.tr&&gl.tr.phase==='question','proceeding puts them in the question');
  ok((await j('POST','/api/join/'+J+'/wait',{cid:g(7)}))._s===200,'wait');
  let hl=await gv(7);ok(hl.hold&&hl.hold.state==='wait','I\'ll Wait shows the waiting screen');
  h=await hv();ok(h.tr.ready===6,'Hal is not counted: ready '+h.tr.ready);
  for(const c of [1,2,3,4,5])await A2(c,0,true);
  h=await hv();ok(h.tr.phase==='question','Gil has not locked');
  await A2(6,1,true);
  h=await hv();ok(h.tr.phase==='results','everyone who can answer locked: timer ends');
  await act({type:'treveal'});
  // result strips
  const lr1=(await gv(1)).lr[0],lr6=(await gv(6)).lr[0],lr7=(await gv(7)).lr[0];
  ok(lr1.kind==='trivia'&&lr1.votes===3&&JSON.stringify(lr1.segs)==='["right","right"]','Ann: '+JSON.stringify(lr1.segs));
  ok(JSON.stringify((await gv(2)).lr[0].segs)==='["wrong","right"]','Bob: wrong then right');
  ok(JSON.stringify(lr6.segs)==='["miss","wrong"]','Gil: not there for Q1, wrong on Q2: '+JSON.stringify(lr6.segs));
  ok(JSON.stringify(lr7.segs)==='["miss","miss"]','Hal waited out: gray');
  // an unanswered question is red for someone who was in
  await act({type:'treset',id});await act({type:'tstart',id});await sleep(3300);
  await sleep(5300);
  h=await hv();ok(h.tr.phase==='results','timer runs out');
  await act({type:'treveal'});
  ok(JSON.stringify((await gv(1)).lr[0].segs)==='["wrong","miss"]','unanswered in time is red, undone question is gray: '+JSON.stringify((await gv(1)).lr[0].segs));
  await act({type:'tdismiss'});
  // text bubble: shows with the placement for anyone, no vote needed
  await act({type:'open',id:id2});await j('POST','/api/join/'+J+'/vote',{cid:g(1),itemId:id2,tier:'B'});
  let t1=await gv(1);ok(!t1.info[id2],'no bubble while polling');
  await act({type:'close'});t1=await gv(1);ok(!t1.info[id2],'no bubble while closed');
  await act({type:'reveal',id:id2});t1=await gv(1);ok(t1.info[id2]&&t1.info[id2].title==='T2','bubble after reveal');
  const t5=await gv(5);ok(t5.info[id2]&&t5.lr[0].kind==='text','non-voter gets it too, row has i');
  Object.values(L).forEach(x=>x.rs.destroy());
  console.log(fails?'FAILED '+fails:'ALL PASSED');
})();
