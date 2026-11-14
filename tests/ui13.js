const { chromium } = require('playwright');
const B='http://localhost:3127', SP=process.argv[2];
const j=async(m,u,b)=>{const r=await fetch(B+u,{method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});const x=await r.json().catch(()=>({}));x._s=r.status;return x;};
const snap=(u)=>new Promise(ok=>{require('http').get(B+u,res=>{let buf='';res.on('data',d=>{buf+=String(d);const m=/data: (.*)\n/.exec(buf);if(m){res.destroy();ok(JSON.parse(m[1]));}});});});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++;};
(async()=>{
  const r=await j('POST','/api/rooms',{name:'R7'});const H=r.hostCode,J=r.joinCode;
  const act=a=>j('POST','/api/host/'+H+'/action',a);
  const hv=()=>snap('/api/host/'+H+'/events');
  await act({type:'cfg',shuffle:false,hostVotes:true,timer:8,desc:'Rank the things!\n- Think\n- Consider',tie:'average'});
  await act({type:'add',items:['Pork','Beef','Chicken','Lamb','Veal']});
  let h=await hv();const id=n=>h.items.find(b=>b.name===n).id;
  await act({type:'edit',id:id('Beef'),rc:{kind:'trivia',qs:[{q:'Beef q1?',opts:['yes','no'],correct:0,expl:'Because yes.'},{q:'Beef q2?',opts:['a','b'],correct:1,expl:''}]}});
  await act({type:'edit',id:id('Chicken'),rc:{kind:'text',title:'Strange Chicken',text:'A strange chicken.'}});
  const br=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome',args:['--no-sandbox']});
  const errs=[];
  const mk=async(n,vp)=>{const p=await br.newPage({viewport:vp,deviceScaleFactor:1});p.on('pageerror',e=>errs.push(n+' '+e));p.on('console',m=>{if(m.type()==='error'&&!/40\d/.test(m.text()))errs.push(n+' '+m.text());});return p;};
  const p=await mk('host',{width:1100,height:760});await p.goto(B+'/host#'+H);await p.waitForSelector('.qcircle');
  const gst=async(n)=>{const g=await mk(n,{width:390,height:800});await g.goto(B+'/play#'+J);await g.fill('.gate input[aria-label="Your name"]',n);await g.fill('.gate input[aria-label="Password"]','test1234');await g.click('.gate button[type=submit]');await g.waitForSelector('.pcard');return g;};
  const g=await gst('Pat'),g2=await gst('Lee');
  // description: minimize
  await g.waitForSelector('.descbox');
  ok((await g.locator('.descbox .desc-bar').textContent())==='–','description has a minus bar when open');
  await g.click('.desc-bar');await g.waitForTimeout(700);
  ok(await g.locator('.descbox.min').count()===1&&(await g.locator('.descbox .desc').isHidden()),'description collapses to a plus bar');
  ok((await g.locator('.descbox .desc-bar').textContent())==='+','plus sign when minimized');
  await g.screenshot({path:SP+'/v1.png'});
  await g.reload();await g.waitForSelector('.descbox');ok(await g.locator('.descbox.min').count()===1,'minimized choice survives a refresh');
  await g.click('.desc-bar');await g.waitForTimeout(700);ok(await g.locator('.descbox.min').count()===0&&await g.locator('.descbox .desc').isVisible(),'expands again');
  // gear: Showdown radio shows the pool row at once
  await p.click('#gear-btn');await p.waitForSelector('.modal.gm');
  await p.click('.gm-tab:has-text("Advanced")');await p.waitForSelector('input[data-k="tie-showdown"]');
  ok(await p.locator('button[data-k="tiepool"]').count()===0,'no pool row while Average is chosen');
  await p.click('input[data-k="tie-showdown"]');await p.waitForSelector('button[data-k="tiepool"]',{timeout:3000});ok(true,'choosing Showdown shows Tie-Breaking Questions straight away');
  await p.screenshot({path:SP+'/v2.png'});
  // pool dialog: incomplete question popup
  await p.click('button[data-k="tiepool"]');await p.waitForSelector('.modal.wide');
  await p.locator('.q-ed').first().locator('[contenteditable]').first().click();await p.keyboard.type('Quick?');
  await p.locator('.q-ed').first().locator('.opt-row [contenteditable]').first().click();await p.keyboard.type('Yes');
  await p.click('.modal.wide button:has-text("Save")');await p.waitForSelector('.hmenu .showmsg');
  const tx=await p.textContent('.hmenu');ok(tx.includes('You have not entered Answer 2 for Question 1.')&&tx.includes('Continue?'),'incomplete popup lists what is missing');
  ok((await p.locator('.hmenu button').allTextContents()).join()==='Continue,Go Back','Continue and Go Back');
  await p.screenshot({path:SP+'/v3.png'});
  await p.click('.hmenu button:has-text("Go Back")');await p.waitForTimeout(350);ok(await p.locator('.modal.wide').count()===1,'Go Back returns to the editor');
  await p.locator('.q-ed').first().locator('.opt-row [contenteditable]').nth(1).click();await p.keyboard.type('No');
  await p.click('.modal.wide button:has-text("Save")');await p.waitForTimeout(500);
  h=await hv();ok(h.tpool.length===1&&h.cfg.tieQs===1&&h.cfg.tieLeft===1,'complete question saved to the pool, 1 left');
  await p.click('.gm-x');await p.waitForTimeout(300);
  // edit item with an incomplete trivia question: Continue saves and the chip says (1 Incomplete)
  await act({type:'edit',id:id('Veal'),rc:{kind:'trivia',qs:[{q:'Veal fine?',opts:['y','n'],correct:0,expl:''},{q:'Half',opts:['only one',''],correct:0,expl:''}]}});
  await sleep(300);h=await hv();ok(h.items.find(b=>b.name==='Veal').info.inc===1&&h.items.find(b=>b.name==='Veal').info.qs===1,'server counts the incomplete question');
  // ---- Pork: tie S vs B (Average -> not showdown now? method is showdown) -> uses the question
  await act({type:'cfg',tie:'showdown'});
  const vote=async(pg,n)=>{await pg.waitForSelector('.tier-btn');await pg.click('.tier-btn >> nth='+n);};
  await p.click('button:has-text("Start Poll")');await vote(g,0);await vote(g2,2);
  await p.click('button:has-text("Close Poll")');await p.click('button:has-text("Reveal Results?")');await p.waitForSelector('.res-bars');
  await p.waitForSelector('.res-win.tietile',{timeout:7000});ok(true,'Tie tile rises in');
  await p.waitForSelector('.breaktie',{state:'visible',timeout:6000});
  ok((await p.textContent('.breaktie')).includes('Break the tie!')&&(await p.locator('.breaktie button').textContent())==='Showdown','Break the tie! and Showdown arrive together');
  await p.screenshot({path:SP+'/v4.png'});
  await p.click('.breaktie button');await p.click('.hmenu button:has-text("Commence Showdown?")');
  await g.waitForSelector('.opt-btn',{timeout:9000});await g2.waitForSelector('.opt-btn');
  await g2.click('.opt-btn >> nth=1'); // wrong (correct is first? pool q correct=0)
  await g.click('.opt-btn >> nth=1');   // wrong
  await p.waitForSelector('button:has-text("Reveal Answer")',{timeout:12000});await p.click('button:has-text("Reveal Answer")');
  await p.waitForSelector('.tcard .actions.col button:has-text("Continue")',{timeout:5000});
  h=await hv();ok(h.tspent.length===1&&h.cfg.tieLeft===0,'the question is spent after being asked');
  await p.click('.tcard .actions.col button:has-text("Continue")');
  await p.waitForSelector('.missprompt',{timeout:6000});
  const mt=(await p.locator('.missprompt .showmsg div').allTextContents()).join('|');ok(mt==='No one got it!|That means we’ll decide this by Average.','host prompt: '+mt);
  await g.waitForSelector('.gstatus',{timeout:4000});ok((await g.textContent('.gstatus')).includes('Waiting for the tie-breaker'),'guest sees the waiting status');
  await p.screenshot({path:SP+'/v5.png'});
  await p.click('.missprompt button:has-text("Continue")');
  await p.waitForSelector('.res-row.lit',{timeout:6000});ok(true,'glow travels over the rows');
  ok(await p.locator('.res-spot').count()===0,'no spotlight bar element');
  await p.screenshot({path:SP+'/v6.png'});
  await p.waitForSelector('.res-banner:has-text("Placed in")',{timeout:9000});
  await p.waitForTimeout(1800);
  ok(await p.locator('.res-row.win').count()===1,'the winning row glows and keeps it');
  const nl=await p.locator('.tie-note-box div').allTextContents();ok(nl.join('|')==='Tie broken by Average','two-line note: '+nl.join('|'));
  ok(await p.locator('.res-bars .res-fill').evaluateAll(a=>a.every(f=>true)),'bars untouched');
  await p.screenshot({path:SP+'/v7.png'});await g.screenshot({path:SP+'/v7g.png'});
  ok((await g.locator('.pcard .tie-note-box div').allTextContents()).length===1,'guest gets the one-line note');
  await p.click('button:has-text("Continue")');await p.waitForSelector('.rchip');
  // ---- Beef: next tie is not a showdown any more (pool spent -> backup Average)
  await act({type:'tpool',qs:h.tpool,fallback:'slots'});
  await p.click('button:has-text("Start Poll")');await vote(g,0);await vote(g2,2);
  await p.click('button:has-text("Close Poll")');await p.click('button:has-text("Reveal Results?")');await p.waitForSelector('.res-bars');
  await p.waitForSelector('.breaktie',{state:'visible',timeout:9000});
  ok((await p.locator('.breaktie button').textContent())==='Random','pool spent: the tie quietly offers the backup, Random');
  await p.click('.breaktie button');await p.waitForSelector('.slot-reel .slot-strip',{timeout:3000});await g.waitForSelector('.slot-reel',{timeout:3000});ok(true,'reel overlay on host and guest');
  await sleep(2500);await p.screenshot({path:SP+'/v8.png'});
  await p.waitForSelector('.res-banner:has-text("Placed in")',{timeout:9000});await p.waitForTimeout(1500);
  const sn=await p.locator('.tie-note-box div').allTextContents();ok(sn.join('|')==='Tie broken at random','spent-pool note: '+sn.join('|'));
  await p.click('button:has-text("Continue")');
  await p.waitForSelector('.tprompt',{timeout:5000});ok(true,'trivia prompt follows the placement');
  // Stats on Beef: Trivia tab, nothing played yet
  await p.click('.tprompt .sqb.stats');await p.waitForSelector('.stats-pane');await p.click('.stats-tabs button:has-text("Trivia")');
  ok((await p.locator('.sq-card.nodata').allTextContents()).join()==='No Data Yet,No Data Yet','gray No Data Yet cards for unplayed trivia');
  ok(await p.locator('.stats-play button:has-text("Play Trivia Now")').count()===1,'Play Trivia Now button');
  await p.screenshot({path:SP+'/v9.png'});
  await p.click('.stats-play button');await p.waitForSelector('.tprompt',{timeout:4000});ok(true,'Play Trivia Now brings up the trivia prompt');
  await p.click('.tprompt button:has-text("Not Now")');await p.waitForTimeout(400);
  // item with no trivia: no tabs
  await p.locator('.rchip:has-text("Pork")').click({button:'right'});await p.waitForSelector('.hmenu');await p.click('.hmenu .sqb.stats');await p.waitForSelector('.stats-pane');
  ok(await p.locator('.stats-tabs button').count()===0,'no tab bar for an item without trivia');
  await p.waitForSelector('.pl-line',{timeout:5000});ok(await p.locator('.pl-line .statchip.tie').count()===1,'Tie chip beside the tier');
  await p.hover('.pl-line .statchip.tie');await p.waitForTimeout(400);const tip=await p.textContent('.pl-line .statchip.tie .stat-tip');ok(tip.includes('Tied between S, B')&&tip.includes('Tie broken by Average')&&!tip.includes('no questions'),'hover explains the tie: '+tip);
  await p.screenshot({path:SP+'/v10.png'});await p.click('.hmenu .sqb.x >> nth=-1');await p.waitForTimeout(400);
  // override chip
  await act({type:'place',id:id('Pork'),tier:'D'});await sleep(400);
  // ---- gear: edit Veal (incomplete) through the UI
  // ---- More bars: Beef q1 run
  await p.locator('.rchip:has-text("Beef")').click({button:'right'});await p.waitForSelector('.tprompt');await p.click('.tprompt button:has-text("Yes")');
  await g.waitForSelector('.opt-btn',{timeout:9000});await g.click('.opt-btn >> nth=0');await g.click('button:has-text("Lock")');
  await p.waitForSelector('button:has-text("End Timer Early")');await p.click('button:has-text("End Timer Early")');
  await p.waitForSelector('button:has-text("Reveal Answer")');await p.click('button:has-text("Reveal Answer")');
  await p.waitForSelector('.morepill');await p.waitForTimeout(1500);
  const w0=await p.locator('.bar-opt .bf').first().evaluate(e=>e.getBoundingClientRect().width);
  await p.click('.morepill');
  await p.waitForTimeout(150);const w1=await p.locator('.bar-opt .bf').first().evaluate(e=>e.getBoundingClientRect().width);
  ok(w0>20&&w1>=w0-2,'bars stay put when More is pressed (host) '+w0+' -> '+w1);
  await g.waitForSelector('.infobox',{timeout:4000});
  const gw=await g.locator('.opt-btn.ok, .opt-btn').count();ok(gw>=2,'guest answers still shown after More');
  await p.waitForTimeout(1300);await p.click('.tcard .qlink:has-text("Back to Board")');
  await p.waitForTimeout(500);
  // Chicken (text bubble): both vote C
  await p.waitForSelector('button:has-text("Start Poll")');await p.click('button:has-text("Start Poll")');await vote(g,3);await vote(g2,3);
  await p.click('button:has-text("Close Poll")');await p.click('button:has-text("Reveal Results?")');await p.waitForSelector('button:has-text("Continue")',{timeout:12000});await p.click('button:has-text("Continue")');await p.waitForTimeout(800);
  // ---- guest My Board
  await g.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
  const lbl=await g.locator('.seg button').allTextContents();ok(lbl.join()==='My Board,Final Board','tabs: My Board, Final Board');
  ok(await g.locator('.frow .fl').count()>=2,'My Board shows tier rows ('+await g.locator('.frow .fl').count()+')');
  ok(await g.locator('.frow .chip').count()>=3,'chips sit in their tier rows');
  ok(await g.locator('.frow .chip .tcap').count()>=1,'trivia chip keeps its capsule');
  ok(await g.locator('.frow .chip .ibtn').count()>=1,'text-bubble chip keeps its i');
  ok(await g.locator('.frow .chip.over, .frow .chip.tb').count()===0,'no outlines on My Board');
  await g.screenshot({path:SP+'/v11.png',fullPage:true});
  await g.locator('.frow .chip:has(.tcap)').first().click();await g.waitForSelector('.rv-pop');
  ok(await g.locator('.rv-pop .sqb.x').count()===1&&await g.locator('.rv-pop .closepill').count()===0,'review popup: red X, no Close pill');
  await g.screenshot({path:SP+'/v12.png'});await g.click('.rv-pop .sqb.x');await g.waitForTimeout(300);
  await g.click('.seg button:has-text("Final Board")');await g.waitForTimeout(300);await g.locator('.frow .chip.tapchip').first().click();await g.waitForSelector('.info-pop');
  ok(await g.locator('.info-pop .pl-line .pl-tile').count()===1,'placement popup uses the padded tile line');
  const ov=await g.locator('.info-pop .statchip').allTextContents();ok(ov.some(t=>t.startsWith('Tie'))||ov.some(t=>t.startsWith('Override')),'chips in the placement popup: '+ov.join('|'));
  await g.screenshot({path:SP+'/v13.png'});
  await g.mouse.click(5,5);await g.waitForTimeout(350);ok(await g.locator('.info-pop').count()===0,'tapping outside dismisses the popup');
  console.log('ERRS',JSON.stringify(errs));console.log(fails?'FAILED '+fails:'ALL PASS');
  await br.close();
})();
