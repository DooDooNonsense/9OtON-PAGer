const { chromium } = require('playwright');
const B='http://localhost:3143', SP=process.argv[2];
const j=async(m,u,b)=>{const r=await fetch(B+u,{method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});const x=await r.json().catch(()=>({}));x._s=r.status;return x;};
const snap=(u)=>new Promise(ok=>{require('http').get(B+u,res=>{let buf='';res.on('data',d=>{buf+=String(d);const m=/data: (.*)\n/.exec(buf);if(m){res.destroy();ok(JSON.parse(m[1]));}});});});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++;};
(async()=>{
  const r=await j('POST','/api/rooms',{name:'Miss'});const H=r.hostCode,J=r.joinCode;
  const act=a=>j('POST','/api/host/'+H+'/action',a);
  await act({type:'cfg',tie:'showdown',timer:5});
  await act({type:'add',items:['Tie1']});
  const br=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome',args:['--no-sandbox']});
  const errs=[];const mk=async(n,vp)=>{const p=await br.newPage({viewport:vp});p.on('pageerror',e=>errs.push(n+' '+e));p.on('console',m=>{if(m.type()==='error'&&!/40\d/.test(m.text()))errs.push(n+' '+m.text());});return p;};
  const hp=await mk('h',{width:1280,height:800});await hp.goto(B+'/host#'+H);await hp.waitForSelector('.qcircle');
  // ---- gear guard: Showdown selected, no questions
  await hp.click('#gear-btn');await hp.waitForSelector('.gm');await hp.click('.gm-x');
  await hp.waitForSelector('text=Showdown has no questions yet');
  ok((await hp.locator('.modal:has-text("Showdown has no questions yet")').innerText()).includes('decided by Average'),'gear exit prompt says it will default to Average');
  await hp.screenshot({path:SP+'/v_gearguard.png'});
  await hp.click('button:has-text("Add questions")');await hp.waitForSelector('text=Tie-Breaking Questions');ok(true,'Add questions opens the editor');
  await hp.evaluate(()=>closeAll());await sleep(400);
  await hp.click('#gear-btn');await hp.waitForSelector('.gm');await hp.click('.gm-x');await hp.waitForSelector('text=Showdown has no questions yet');ok(true,'prompt shows every time');
  await hp.click('button:has-text("Continue anyway")');await sleep(500);ok(await hp.locator('.gm').count()===0,'Continue anyway leaves the menu');
  // ---- one question, nobody answers
  await act({type:'tpool',qs:[{q:'Capital of France?',opts:['Paris','Rome'],correct:0,expl:''}],fallback:'high'});
  const cids=[];for(const n of ['Pat','Lee']){const c='cidui19-'+n;cids.push(c);await j('POST','/api/join/'+J+'/name',{cid:c,pw:'test1234',name:n});}
  const g=await mk('g',{width:390,height:800});await g.goto(B+'/play#'+J);await g.fill('.gate input[aria-label="Your name"]','Sue');await g.fill('.gate input[aria-label="Password"]','test1234');await g.click('.gate button[type=submit]');await g.waitForSelector('.psub');
  let hv=await snap('/api/host/'+H+'/events');const it=hv.items[0];
  await act({type:'open',id:it.id});
  await j('POST','/api/join/'+J+'/vote',{cid:cids[0],itemId:it.id,tier:hv.tiers[0].id});await j('POST','/api/join/'+J+'/vote',{cid:cids[1],itemId:it.id,tier:hv.tiers[1].id});
  await act({type:'close'});await act({type:'reveal',id:it.id});await sleep(5500);await hp.evaluate(()=>{try{closeAll()}catch(e){}});
  await hp.waitForSelector('.breaktie button:not([hidden])',{timeout:9000});
  await hp.click('.breaktie button');await hp.waitForSelector('.showmsg');
  const sm=await hp.locator('.showmsg div').allTextContents();ok(sm.join('|')==='The tie will be decided by Showdown.|The first to answer correctly chooses the winner.','showdown popup: '+sm.join('|'));
  await hp.screenshot({path:SP+'/v_showpop.png'});
  await hp.click('button:has-text("Commence Showdown?")');await sleep(3600);
  await act({type:'tend'});await act({type:'treveal'});await sleep(600);await act({type:'tdismiss'});
  await hp.waitForSelector('.missprompt',{timeout:8000});
  const mt=await hp.locator('.missprompt .showmsg div').allTextContents();ok(mt.join('|')==='No one got it!|That means we’ll decide this by High Card.','miss prompt: '+mt.join('|'));
  ok(await hp.locator('.missprompt .mb-right button').count()===0,'no X on the prompt');
  await hp.keyboard.press('Escape');await hp.mouse.click(5,400);await sleep(500);ok(await hp.locator('.missprompt').count()===1,'Escape and backdrop do not close it');
  await hp.screenshot({path:SP+'/v_miss.png'});
  const gs=await g.locator('.gstatus').allInnerTexts();ok(/Waiting for the tie-breaker/.test(gs.join())&&/The tie will be decided by High Card\./.test(gs.join()),'guest waits: '+JSON.stringify(gs));
  const lines=await g.locator('.gstatus .gs-sub').allTextContents();ok(lines.length===2&&lines[0]==='The tie will be decided by High Card.'&&lines[1]==='The highest tied tier wins.','guest status is two lines: '+lines.join(' / '));
  await g.screenshot({path:SP+'/v_gs.png'});
  ok(!(await hp.locator('.tie-msg').count()),'no timed note');
  await hp.click('.missprompt button:has-text("Continue")');await sleep(800);
  ok(await hp.locator('.missprompt').count()===0,'Continue closes it');
  await hp.waitForSelector('.res-banner:has-text("Placed in")',{timeout:9000});await sleep(1200);
  const nt=await hp.locator('.tie-note-box div').allTextContents();ok(nt.join('|')==='Tie broken by High Card','result note after the result: '+nt.join('|'));
  // ---- feather: stays soft while the box is still growing
  const f=await hp.evaluate(async()=>{
    const d=document.createElement('div');d.style.cssText='background:#fff;font:700 60px sans-serif;padding:20px;width:400px;position:fixed;top:50px;left:50px;z-index:9';d.textContent='Break the tie!';document.body.append(d);d.hidden=true;
    const full=(()=>{d.hidden=false;const hh=d.getBoundingClientRect().height;d.hidden=true;return hh;})();
    rise(d,{});const out=[];const t0=performance.now();
    while(performance.now()-t0<600){const cs=getComputedStyle(d);out.push({t:performance.now()-t0,rf:parseFloat(cs.getPropertyValue('--rf'))||0,h:d.getBoundingClientRect().height/full});await new Promise(r=>requestAnimationFrame(r));}
    d.remove();return out;});
  const mid=f.filter(x=>x.h>0.1&&x.h<0.8);ok(mid.length>3&&mid.every(x=>x.rf>20),'feather stays full while growing ('+mid.map(x=>x.rf.toFixed(0)).join(',')+')');
  const end=f[f.length-1];ok(end.rf===0&&Math.abs(end.h-1)<0.02,'feather gone at the end, box at full height');
  console.log(errs.length?'ERRS '+errs.join('; '):'ERRS none');
  console.log(fails?'FAILED '+fails:'ALL PASS');await br.close();process.exit(0);
})().catch(e=>{console.log('Error '+e.stack);process.exit(1)});
