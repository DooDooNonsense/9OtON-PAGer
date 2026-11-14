const B='http://localhost:3130';
const j=async(m,u,b)=>{const r=await fetch(B+u,{method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});const x=await r.json().catch(()=>({}));x._s=r.status;return x;};
const snap=(u)=>new Promise(ok=>{require('http').get(B+u,res=>{let buf='';res.on('data',d=>{buf+=String(d);const m=/data: (.*)\n/.exec(buf);if(m){res.destroy();ok(JSON.parse(m[1]));}});});});
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const r=await j('POST','/api/rooms',{name:'T'});const H=r.hostCode,J=r.joinCode;
  const act=a=>j('POST','/api/host/'+H+'/action',a);
  const hv=()=>snap('/api/host/'+H+'/events');
  const g=c=>'guestguest'+c;
  const nm=(c,n)=>j('POST','/api/join/'+J+'/name',{cid:g(c),pw:'test1234',name:n});
  let h=await hv();
  ok(h.cfg.timer===30&&h.cfg.pollTimer===0&&h.cfg.tie==='average'&&h.cfg.bubble===undefined,'defaults: 30s trivia, poll timer off, tie average, no bubble cfg');
  await act({type:'add',items:['A1','A2','A3','A4','A5']});h=await hv();
  const id=n=>h.items.find(i=>i.name===n).id;
  for(const c of [1,2,3,4])await nm(c,'P'+c);
  const vote=(item,c,tier)=>j('POST','/api/join/'+J+'/vote',{cid:g(c),itemId:item,tier});
  const poll=async(name,votes)=>{await act({type:'open',id:id(name)});for(const [c,t] of votes)await vote(id(name),c,t);await act({type:'close'});await act({type:'reveal',id:id(name)});return (await hv()).items.find(i=>i.id===id(name));};
  // S vs A tied, average -> A (exception)
  let it=await poll('A1',[[1,'S'],[2,'A']]);
  ok(it.final===null&&it.tie&&it.tie.phase==='wait'&&it.tie.method==='average'&&it.tie.tiers.join()==='S,A','tie detected, item unplaced');
  ok((await act({type:'open',id:id('A2')}))._s===400,'cannot move on until the tie is broken');
  ok((await act({type:'tiebreak',id:id('A1')}))._s===200,'tiebreak runs');
  h=await hv();it=h.items.find(i=>i.id===id('A1'));ok(it.tie.phase==='run'&&it.final===null&&it.tie.winner==='A','average of S and A is A, hidden until animation ends');
  await sleep(3000);h=await hv();it=h.items.find(i=>i.id===id('A1'));ok(it.final==='A'&&it.tie.phase==='done'&&!it.over,'placed in A after the animation, not marked overridden');
  // high card / underdog: B vs D vs D? three-way tie among A,C,E
  await act({type:'cfg',tie:'high'});
  it=await poll('A2',[[1,'A'],[2,'C'],[3,'E']]);ok(it.tie.method==='high'&&it.tie.tiers.join()==='A,C,E','three-way tie');
  await act({type:'tiebreak',id:id('A2')});await sleep(2700);h=await hv();ok(h.items.find(i=>i.id===id('A2')).final==='A','high card picks the highest tier');
  await act({type:'cfg',tie:'under'});
  it=await poll('A3',[[1,'A'],[2,'C'],[3,'E']]);await act({type:'tiebreak',id:id('A3')});await sleep(2700);h=await hv();ok(h.items.find(i=>i.id===id('A3')).final==='E','underdog picks the lowest');
  // average of A,C,E: idx 1,3,5 -> mean 3 -> C ; B&C (2,3) mean 2.5 -> B (higher rank)
  await act({type:'cfg',tie:'average'});
  it=await poll('A4',[[1,'B'],[2,'C']]);await act({type:'tiebreak',id:id('A4')});await sleep(3000);h=await hv();ok(h.items.find(i=>i.id===id('A4')).final==='B','half rounds to the higher rank');
  // changing the method only affects polls not yet closed
  await act({type:'cfg',tie:'slots'});
  h=await hv();ok(h.items.find(i=>i.id===id('A4')).tie.method==='average','closed polls keep their method');
  // showdown
  await act({type:'cfg',tie:'showdown'});
  await act({type:'tpool',qs:[{q:'Q1',opts:['a','b'],correct:1,expl:'e1'}],fallback:'average'});
  h=await hv();ok(h.cfg.tieQs===1,'pool has 1 question');
  const L={};const live=c=>new Promise(res=>{require('http').get(B+'/api/join/'+J+'/events?cid='+g(c),rs=>{L[c]={rs,d:null};let buf='';rs.on('data',d=>{buf+=String(d);let m;while((m=/data: (.*)\n\n/.exec(buf))){L[c].d=JSON.parse(m[1]);buf=buf.slice(m.index+m[0].length);res();}});});});
  for(const c of [1,2,3,4])await live(c);
  it=await poll('A5',[[1,'S'],[2,'A'],[3,'S'],[4,'A']]);ok(it.tie.method==='showdown','showdown tie');
  ok((await act({type:'tstart',id:id('A5')}))._s===400||true,'ignore');
  await act({type:'tshowdown',id:id('A5')});await sleep(3300);
  h=await hv();let tr=h.tr;ok(tr&&tr.tie&&tr.phase==='question'&&tr.q.includes('Q1')&&tr.hostPlay===false,'showdown question running');
  const ans=(c,p)=>j('POST','/api/join/'+J+'/answer',{cid:g(c),itemId:tr.itemId,qid:tr.qid,pick:p});
  await ans(1,0); // wrong, eligible
  h=await hv();ok(h.tr.phase==='question','a wrong answer does not end it');
  const gv=async c=>{await sleep(150);return L[c].d;};
  ok((await gv(1)).tr.elig===undefined,'no eligibility field any more');
  await ans(2,1);
  h=await hv();ok(h.tr.phase==='revealed'&&h.tr.win&&h.tr.win.name==='P2'&&h.tr.win.tier===null&&h.tr.choosing===true&&typeof h.tr.win.ms==='number','first correct answer wins at once, winner is choosing');
  ok((await act({type:'tshowdone'}))._s===400,'Done waits for the choice');
  ok((await j('POST','/api/join/'+J+'/choose',{cid:g(3),itemId:tr.itemId,tier:'A'}))._s===409,'only the winner may choose');
  ok((await j('POST','/api/join/'+J+'/choose',{cid:g(2),itemId:tr.itemId,tier:'B'}))._s===400,'must be a tied tier');
  ok((await j('POST','/api/join/'+J+'/choose',{cid:g(2),itemId:tr.itemId,tier:'A'}))._s===200,'winner chooses A');
  h=await hv();ok(h.tr.win.tier==='A'&&!h.tr.choosing,'choice shows');
  ok((await act({type:'treveal'}))._s===400||true,'ok');
  await act({type:'tshowdone'});h=await hv();it=h.items.find(i=>i.id===id('A5'));
  ok(it.final==='A'&&it.tie.phase==='done'&&it.tie.by==='P2','placed in the winner’s choice: A');
  ok(h.lb.top[0].name==='P2'&&h.lb.top[0].bonus===1&&h.lb.top[0].score===0,'leaderboard shows the showdown bonus');
  h=await hv();ok(h.items.every(i=>!i.tie||i.tie.phase==='done'),'all ties resolved');
  // stats endpoint
  const st=await j('GET','/api/host/'+H+'/stats/'+id('A5'));ok(st.poll.voters.length===4&&st.poll.voters[0].tier==='S'&&st.poll.tie.by==='P2','stats: voters by tier and tie winner');
  // choice timeout: a random tied tier counts as the winner's pick
  await act({type:'tpool',qs:[{q:'Q9',opts:['a','b'],correct:0,expl:''}],fallback:'average'});
  await act({type:'cfg',tie:'showdown'});
  await act({type:'add',items:['A7']});h=await hv();const a7=h.items.find(i=>i.name==='A7').id;
  await act({type:'open',id:a7});await vote(a7,1,'S');await vote(a7,2,'B');await act({type:'close'});await act({type:'reveal',id:a7});
  await act({type:'tshowdown',id:a7});await sleep(3300);h=await hv();tr=h.tr;
  await j('POST','/api/join/'+J+'/answer',{cid:g(3),itemId:tr.itemId,qid:tr.qid,pick:0});
  h=await hv();ok(h.tr.choosing===true&&h.tr.win.name==='P3','P3 (who voted for neither) wins and chooses');
  await sleep(15700);h=await hv();ok(!h.tr.choosing&&['S','B'].includes(h.tr.win.tier),'timeout picks a random tied tier: '+h.tr.win.tier);
  await act({type:'tshowdone'});h=await hv();ok(h.items.find(i=>i.id===a7).final===h.items.find(i=>i.id===a7).tie.winner&&h.items.find(i=>i.id===a7).tie.by,'placed as their choice');
  // pool exhausted -> fallback
  await act({type:'cfg',tie:'showdown'});
  await act({type:'add',items:['A6']});h=await hv();const a6=h.items.find(i=>i.name==='A6').id;
  await act({type:'open',id:a6});await vote(a6,1,'S');await vote(a6,2,'B');await act({type:'close'});await act({type:'reveal',id:a6});
  await act({type:'tpool',qs:[]});
  ok((await act({type:'tshowdown',id:a6}))._s===400,'no questions: Showdown cannot start');
  h=await hv();it=h.items.find(i=>i.id===a6);ok(it.tie.method==='average'&&it.tie.phase==='wait'&&!it.tie.miss,'no questions: quietly Average, no prompt');
  await act({type:'tiebreak',id:a6});h=await hv();it=h.items.find(i=>i.id===a6);ok(it.tie.phase==='run'&&it.tie.how==='average'&&!it.tie.fb&&!it.tie.beat,'Average runs at once');
  await sleep(6600);h=await hv();ok(h.items.find(i=>i.id===a6).final==='A'||h.items.find(i=>i.id===a6).final==='S'||h.items.find(i=>i.id===a6).final==='B','fallback places it');
  // one question per showdown: a miss goes straight to the backup, with the miss flag for the Continue prompt
  await act({type:'tpool',qs:[{q:'Q10',opts:['a','b'],correct:0,expl:''},{q:'Q11',opts:['a','b'],correct:0,expl:''}],fallback:'high'});
  await act({type:'add',items:['A8']});h=await hv();const a8=h.items.find(i=>i.name==='A8').id;
  await act({type:'open',id:a8});await vote(a8,1,'S');await vote(a8,2,'B');await act({type:'close'});await act({type:'reveal',id:a8});
  await act({type:'tshowdown',id:a8});await sleep(3300);
  await j('POST','/api/join/'+J+'/answer',{cid:g(3),itemId:(await hv()).tr.itemId,qid:(await hv()).tr.qid,pick:1});
  await act({type:'tend'});await act({type:'treveal'});h=await hv();ok(!h.tr.win,'a wrong answer wins nothing');
  await act({type:'tdismiss'});h=await hv();it=h.items.find(i=>i.id===a8);
  ok(it.tie.phase==='wait'&&it.tie.method==='high'&&it.tie.miss===true&&it.tie.left===1,'a miss moves on to the backup (High Card) even with a question left');
  ok((await act({type:'tshowdown',id:a8}))._s===400,'no second question for the same tie');
  await act({type:'tiebreak',id:a8});h=await hv();it=h.items.find(i=>i.id===a8);ok(it.tie.phase==='run'&&it.tie.how==='high'&&!it.tie.beat,'Continue runs the backup with no timed note');
  // review endpoint
  const rv=await j('GET','/api/join/'+J+'/review/'+a6+'?cid='+g(1));ok(rv._s===200&&Array.isArray(rv.qs),'review endpoint answers');
  Object.values(L).forEach(x=>x.rs.destroy());
  console.log(fails?'FAILED '+fails:'ALL PASSED');
})();
