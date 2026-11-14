const { chromium } = require('playwright');
const B='http://localhost:3125', SP=process.argv[2];
const j=async(m,u,b)=>{const r=await fetch(B+u,{method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});const x=await r.json().catch(()=>({}));x._s=r.status;return x;};
const snap=(u)=>new Promise(ok=>{require('http').get(B+u,res=>{let buf='';res.on('data',d=>{buf+=String(d);const m=/data: (.*)\n/.exec(buf);if(m){res.destroy();ok(JSON.parse(m[1]));}});});});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++;};
(async()=>{
  const r=await j('POST','/api/rooms',{name:'Alpha'});const H=r.hostCode,J=r.joinCode;
  const act=a=>j('POST','/api/host/'+H+'/action',a);
  await act({type:'cfg',shuffle:false,hostPlay:false,hideNext:true,timer:20,desc:'We gotta rank all this stuff! Stat!'});
  await act({type:'add',items:['Really Long Name Item','Normal Name','Plain','Seth the Extremely Long Named Candidate']});
  let hv=await snap('/api/host/'+H+'/events');const id=n=>hv.items.find(b=>b.name===n).id;
  await act({type:'edit',id:id('Really Long Name Item'),rc:{kind:'trivia',qs:[{id:'q1',q:'One',opts:['a','b'],correct:0,expl:'e'},{id:'q2',q:'Two',opts:['a','b'],correct:1,expl:'e'},{id:'q3',q:'Three',opts:['a','b'],correct:0,expl:'e'}]}});
  await act({type:'edit',id:id('Normal Name'),rc:{kind:'text',title:'',text:'Pretty wacky guy!'}});
  const br=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome',args:['--no-sandbox']});
  const errs=[];
  const mk=async(n,vp)=>{const p=await br.newPage({viewport:vp,deviceScaleFactor:1});p.on('pageerror',e=>errs.push(n+' '+e));p.on('console',m=>{if(m.type()==='error'&&!/40\d/.test(m.text()))errs.push(n+' '+m.text());});return p;};
  const p=await mk('host',{width:1000,height:700});await p.goto(B+'/host#'+H);await p.waitForSelector('.qcircle');
  const g=await mk('guest',{width:390,height:800});await g.goto(B+'/play#'+J);
  await g.fill('.gate input[aria-label="Your name"]','Pat');await g.fill('.gate input[aria-label="Password"]','test1234');await g.click('.gate button[type=submit]');await g.waitForSelector('.pcard.center');
  ok((await g.locator('.pcard h2:has-text("Alpha")').count())===0,'room name not repeated in the guest card');
  const cid=await g.evaluate(()=>localStorage.getItem('btp_cid')||'');
  // first item via the UI: reveal, start, vote, close, reveal results
  await p.click('button:has-text("Reveal Item")');await p.waitForSelector('.qskip');
  ok((await g.locator('text=Polls open soon for').count())===1,'guest sees "Polls open soon for…"');
  await g.screenshot({path:SP+'/s1.png'});
  await p.screenshot({path:SP+'/s1h.png'});
  await p.click('button:has-text("Start Poll")');await g.waitForSelector('.tier-btn');await g.click('.tier-btn >> nth=1');
  ok((await g.locator('.infobox').count())===0,'no bubble on voting card');
  await p.click('button:has-text("Close poll")');await p.click('button:has-text("Reveal Results?")');await p.waitForSelector('.res-bars');
  await p.waitForTimeout(3200);await p.screenshot({path:SP+'/s2h.png'});
  await p.click('button:has-text("Continue")');
  await p.waitForSelector('.tprompt');await p.waitForTimeout(500);await p.screenshot({path:SP+'/s3h.png'});
  const pr=await p.locator('.tprompt').boundingBox();ok(pr.height<300,'compact prompt height '+Math.round(pr.height));
  const rowOk=await p.locator('.tp-row').evaluate(e=>{const k=[...e.children].map(c=>c.getBoundingClientRect());return k.length===2&&k.every(r=>Math.abs(r.top-k[0].top)<2);});
  ok(rowOk,'Yes and Not Now share one row');
  await p.hover('.tprompt .sqb.stats');
  await p.click('.tprompt .sqb.stats');await p.waitForSelector('.overlay.stacked >> nth=1');ok(true,'icon stacks the results popup');await p.screenshot({path:SP+'/s3b.png'});
  await p.click('.overlay.stacked >> nth=1 >> .sqb.back');await p.waitForTimeout(200);ok((await p.locator('.tprompt').count())===1,'back returns to the prompt');
  await p.click('.tprompt button:has-text("Not Now")');
  // later items through the API
  const cvote=async(item,tier)=>{await j('POST','/api/join/'+J+'/vote',{cid,itemId:item,tier});};
  await act({type:'open',id:id('Normal Name')});await cvote(id('Normal Name'),'B');await act({type:'close'});await act({type:'reveal',id:id('Normal Name')});
  await act({type:'open',id:id('Plain')});await cvote(id('Plain'),'C');await act({type:'close'});await act({type:'reveal',id:id('Plain')});
  // trivia: Pat answers q1 right, misses q2, q3 skipped by the host
  await act({type:'tstart',id:id('Really Long Name Item')});await sleep(3300);
  hv=await snap('/api/host/'+H+'/events');
  await j('POST','/api/join/'+J+'/answer',{cid,itemId:hv.tr.itemId,qid:hv.tr.qid,pick:0,lock:true});
  await p.waitForSelector('button:has-text("Reveal Answer")',{timeout:6000});
  // timer label is centered in the bar
  await act({type:'treveal'});await act({type:'tstart',id:id('Really Long Name Item')});await sleep(3300);
  const lab=await g.locator('.tbar2').evaluate(e=>{const b=e.getBoundingClientRect(),l=e.querySelector('.tl').getBoundingClientRect();return Math.abs((l.left+l.width/2)-(b.left+b.width/2));}).catch(()=>999);
  ok(lab<3,'timer label sits in the middle of the bar ('+lab+'px off)');
  await g.screenshot({path:SP+'/s4.png'});
  // a returning guest gets the hold prompt, another chooses to wait
  const g2=await mk('guest2',{width:390,height:800});await g2.goto(B+'/play#'+J);await g2.waitForSelector('.gate input');
  await g2.fill('.gate input[aria-label="Your name"]','Lee');await g2.fill('.gate input[aria-label="Password"]','test1234');await g2.click('.gate button[type=submit]');await g2.waitForSelector('.hold-msg');
  ok((await g2.textContent('.hold-msg')).includes('timed question currently happening')&&(await g2.locator('.hold-msg b').count())===1,'hold prompt for a late joiner');
  const s1=await g2.textContent('.hold-msg b');await sleep(1500);const s2=await g2.textContent('.hold-msg b');ok(Number(s2)<Number(s1),'seconds count down '+s1+' -> '+s2);
  await g2.screenshot({path:SP+'/s5.png'});
  await g2.click('button:has-text("I’ll Wait")');await g2.waitForSelector('text=Waiting to join room');
  ok((await g2.locator('.desc').count())===1,'waiting screen shows the description');
  await g2.screenshot({path:SP+'/s6.png'});
  await p.waitForSelector('button:has-text("Reveal Answer")',{timeout:25000});
  await act({type:'treveal'});await act({type:'tdismiss'});
  await g2.waitForFunction(()=>!document.body.textContent.includes('Waiting to join room'),null,{timeout:5000});ok(true,'waiting guest joins when the host moves on');
  // host hold card
  const g3=await mk('guest3',{width:390,height:800});await g3.goto(B+'/play#'+J);await g3.waitForSelector('.gate input');
  await act({type:'tstart',id:id('Really Long Name Item')});
  await p.waitForSelector('text=Holding for Joining Players');await p.screenshot({path:SP+'/s7h.png'});
  ok((await p.locator('.holdbody .qlink:has-text("Proceed")').count())===1,'subtle Proceed link');
  await p.click('.holdbody .qlink');await p.waitForSelector('text=Get ready to answer');
  await g3.close();
  await sleep(23000);
  await p.waitForSelector('button:has-text("Reveal Answer")',{timeout:6000});await act({type:'treveal'});await act({type:'tdismiss'});
  // lobby: reveal the 4th item (long name) and look at both screens
  await p.waitForTimeout(900);if(await p.locator('button:has-text("Continue")').count())await p.click('button:has-text("Continue")');
  await p.waitForSelector('.qcircle');await p.click('button:has-text("Reveal Item")');await p.waitForSelector('button:has-text("Start Poll")');await p.waitForTimeout(600);
  await p.screenshot({path:SP+'/s8h.png'});
  await g.waitForSelector('text=Polls open soon for');await g.waitForTimeout(400);
  await g.screenshot({path:SP+'/s9.png',fullPage:true});
  const rows=await g.locator('.pcard .lr-row').count();ok(rows===3,'three result rows: '+rows);
  ok((await g.locator('.pcard .lr-row').first().innerText()).includes('Plain'),'newest on top');
  ok((await g.locator('.pcard .tcap i').count())===3,'trivia capsule has one segment per question');
  ok((await g.locator('.pcard .ipill .ibtn').count())===1,'text item shows the i');
  const trunc=await g.locator('.ipn').evaluateAll(a=>a.map(e=>e.scrollWidth>e.clientWidth));ok(trunc.some(Boolean),'long names truncate in pills');
  const tile=await g.locator('.pcard .tile .tt').evaluate(e=>{const t=e.closest('.tile').getBoundingClientRect(),x=e.getBoundingClientRect();return {l:Math.round(x.left-t.left),r:Math.round(t.right-x.right),t:Math.round(x.top-t.top),b:Math.round(t.bottom-x.bottom)};});
  ok(tile.l>14&&tile.r>14&&tile.t>10&&tile.b>10,'tile text has margin all round '+JSON.stringify(tile));
  const qc=await p.locator('.qcircle .qt').evaluate(e=>{const t=e.closest('.qcircle').getBoundingClientRect(),x=e.getBoundingClientRect();return {l:Math.round(x.left-t.left),r:Math.round(t.right-x.right)};});
  ok(qc.l>10&&qc.r>10,'host circle text has margin '+JSON.stringify(qc));
  // the 'i' opens the bubble
  await g.click('.pcard .ipill.tap:has(.ibtn)');await g.waitForSelector('.info-pop');ok((await g.textContent('.info-pop')).includes('Pretty wacky guy'),'i opens the bubble');
  await g.screenshot({path:SP+'/s10.png'});
  console.log('ERRS',JSON.stringify(errs));console.log(fails?'FAILED '+fails:'ALL PASS');
  await br.close();
})();
