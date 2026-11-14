const { chromium } = require('playwright');
const B='http://localhost:3124', SP=process.argv[2];
const j=async(m,u,b)=>{const r=await fetch(B+u,{method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});return r.json().catch(()=>({}));};
const snap=(u)=>new Promise(ok=>{require('http').get(B+u,res=>{let buf='';res.on('data',d=>{buf+=String(d);const m=/data: (.*)\n/.exec(buf);if(m){res.destroy();ok(JSON.parse(m[1]));}});});});
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++;};
(async()=>{
  const r=await j('POST','/api/rooms',{name:'Alpha'});const H=r.hostCode,J=r.joinCode;
  const act=a=>j('POST','/api/host/'+H+'/action',a);
  await act({type:'cfg',shuffle:false,hostPlay:true,hideNext:true});
  await act({type:'add',items:['Aa','Bb']});
  let hv=await snap('/api/host/'+H+'/events');const id=n=>hv.items.find(b=>b.name===n).id;
  await act({type:'edit',id:id('Aa'),rc:{kind:'trivia',title:'',qs:[{id:'q1',q:'Pick B',opts:['x','y','z','w'],correct:1,expl:'because'},{id:'q2',q:'Pick A',opts:['p','q'],correct:0,expl:'second'}]}});
  const br=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome',args:['--no-sandbox']});
  const errs=[];
  const mk=async(n,vp)=>{const p=await br.newPage({viewport:vp});p.on('pageerror',e=>errs.push(n+' '+e));p.on('console',m=>{if(m.type()==='error'&&!/40\d/.test(m.text()))errs.push(n+' '+m.text());});return p;};
  const p=await mk('host',{width:1000,height:700});global.PP=p;await p.goto(B+'/host#'+H);await p.waitForSelector('.qcircle');
  const g=await mk('guest',{width:390,height:800});await g.goto(B+'/play#'+J);
  await g.fill('.gate input[aria-label="Your name"]','Pat');await g.fill('.gate input[aria-label="Password"]','test1234');await g.click('.gate button[type=submit]');await g.waitForSelector('.pcard.center');

  /* flat buttons, one-line Reveal Item */
  const st=await p.locator('.qgo').evaluate(e=>{const c=getComputedStyle(e);return {img:c.backgroundImage,sh:c.boxShadow,h:e.getBoundingClientRect().height,fs:parseFloat(c.fontSize),sw:e.scrollWidth,cw:e.clientWidth};});
  ok(st.img==='none'&&/rgb\(10, 29, 56\)/.test(st.sh),'primary button is flat with a darker bottom edge '+JSON.stringify(st));
  ok(st.sw<=st.cw+1&&st.h<st.fs*3,'Reveal Item stays on one line');
  await p.click('button:has-text("Reveal Item")');await p.click('button:has-text("Start Poll")');
  await g.waitForSelector('.tier-btn');await g.click('.tier-btn >> nth=1');
  await p.click('button:has-text("Close poll")');await p.click('button:has-text("Reveal Results?")');await p.waitForSelector('.res-bars');
  const pos=await p.locator('.card.res .actions.right button').evaluate(e=>{const r=e.getBoundingClientRect(),c=e.closest('.card.res').getBoundingClientRect();return {gap:Math.round(c.right-r.right),left:Math.round(r.left-c.left),w:Math.round(c.width)};});
  ok(pos.gap<60&&pos.left>pos.w/2,'Continue sits bottom-right '+JSON.stringify(pos));
  await p.click('button:has-text("Continue")');await p.waitForSelector('.rchip');

  /* trivia: guest wrong + locked, host right */
  await p.waitForSelector('.tprompt');await p.click('.tprompt button:has-text("Yes")');
  await g.waitForSelector('.opt-btn');await p.waitForSelector('.tcard .opt-btn');
  await g.click('.opt-btn >> nth=0');await g.click('.lockbtn');
  await g.waitForFunction(()=>{const b=document.querySelector('.lockbtn');return b&&b.disabled;});
  const lk=await g.locator('.lockbtn').evaluate(e=>({t:e.textContent.trim(),d:e.disabled}));
  ok(lk.t==='Locked In'&&lk.d,'Lock In turns into a pressed, disabled "Locked In" '+JSON.stringify(lk));
  await g.screenshot({path:SP+'/r1.png'});
  await p.click('.tcard .opt-btn >> nth=1');
  await p.click('button:has-text("End timer early")');await p.waitForSelector('button:has-text("Reveal Answer")');
  await p.click('button:has-text("Reveal Answer")');await p.waitForTimeout(1500);
  ok((await p.locator('.bar-opt.ok:not(.bad)').count())===1&&(await p.locator('.bar-opt.bad').count())===0,'host right: correct bar plain green');
  ok((await p.locator('.fb').count())===0&&!(await p.content()).includes('You got it'),'no host right/wrong line');
  await p.screenshot({path:SP+'/r2.png'});
  await g.waitForTimeout(1500);
  ok((await g.locator('.opt-btn.ok.bad').count())===1&&(await g.locator('.opt-btn.miss').count())===1,'guest wrong: correct is green with red outline, pick is red');
  ok(!(await g.content()).includes('Correct!'),'no Correct! text');
  ok((await g.locator('.infobox').count())===0,'guests do not see the follow-up before the host opens it');
  await p.click('.morepill');await g.waitForSelector('.infobox');await g.waitForTimeout(700);
  const ib=await g.locator('.infobox').evaluate(e=>({bg:getComputedStyle(e).backgroundColor,bl:getComputedStyle(e).borderLeftWidth}));
  ok(ib.bg==='rgb(56, 139, 143)'&&ib.bl==='0px','follow-up is the lighter info card '+JSON.stringify(ib));
  await g.screenshot({path:SP+'/r3.png'});
  /* q2: host wrong, guest unanswered */
  await (async()=>{const m=p.locator('.morepill');if(await m.count())await m.click();await p.waitForTimeout(1500);})();
  await p.click('button:has-text("Next Question")');await p.waitForSelector('.tcard .opt-btn');
  await p.click('.tcard .opt-btn >> nth=1');await p.click('button:has-text("End timer early")');
  await p.waitForSelector('button:has-text("Reveal Answer")');await p.click('button:has-text("Reveal Answer")');await p.waitForTimeout(1500);
  ok((await p.locator('.bar-opt.ok.bad').count())===1,'host wrong: correct bar green with red outline');
  await g.waitForTimeout(1500);
  ok((await g.locator('.opt-btn.ok.bad').count())===1&&(await g.locator('.opt-btn.miss').count())===0,'guest unanswered: correct green with red outline');
  await p.screenshot({path:SP+'/r4.png'});
  await (async()=>{const m=p.locator('.morepill');if(await m.count())await m.click();await p.waitForTimeout(1500);})();
  await p.click('button:has-text("Done")');

  /* reset bug: reset Aa from the gear menu and play it again */
  await p.click('#gear-btn');await p.click('.gm-tab:has-text("Items")');
  await p.screenshot({path:SP+'/r5.png'});
  await p.locator('.item-row').filter({hasText:'Aa'}).first().locator('button[aria-label^="Reset"]').click({timeout:5000});
  await p.click('.overlay.stacked >> nth=1 >> button:has-text("Reset")');
  await p.mouse.click(941,52);await p.waitForSelector('.qcircle');
  await p.click('button:has-text("Reveal Item")');await p.click('button:has-text("Start Poll")');
  await g.waitForSelector('.tier-btn');await g.click('.tier-btn >> nth=2');
  await p.click('button:has-text("Close poll")');await p.click('button:has-text("Reveal Results?")');
  await p.waitForSelector('.res-bars',{timeout:5000});ok(true,'re-polled item shows its results screen again');
  console.log('ERRS',errs);console.log(fails?'FAILS '+fails:'ALL PASS');await br.close();
})().catch(async e=>{console.error('ERR',e.message.split('\n')[0]);try{await global.PP.screenshot({path:SP+'/r6.png'});}catch(_){}process.exit(1);});
