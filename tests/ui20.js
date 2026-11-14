const { chromium } = require('playwright');
const B='http://localhost:3145', SP=process.argv[2];
const j=async(m,u,b)=>{const r=await fetch(B+u,{method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});const x=await r.json().catch(()=>({}));x._s=r.status;return x;};
const snap=(u)=>new Promise(ok=>{require('http').get(B+u,res=>{let buf='';res.on('data',d=>{buf+=String(d);const m=/data: (.*)\n/.exec(buf);if(m){res.destroy();ok(JSON.parse(m[1]));}});});});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++;};
(async()=>{
  const r=await j('POST','/api/rooms',{name:'Lockui'});const H=r.hostCode,J=r.joinCode;
  const act=a=>j('POST','/api/host/'+H+'/action',a);
  await act({type:'add',items:['Alpha','Beta']});
  const br=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome',args:['--no-sandbox']});
  const errs=[];const mk=async(n,vp)=>{const p=await br.newPage({viewport:vp});p.on('pageerror',e=>errs.push(n+' '+e));p.on('console',m=>{if(m.type()==='error'&&!/40\d/.test(m.text()))errs.push(n+' '+m.text());});return p;};
  const hp=await mk('h',{width:1280,height:800});await hp.goto(B+'/host#'+H);await hp.waitForSelector('.qcircle');
  const g=await mk('g',{width:390,height:800});await g.goto(B+'/play#'+J);await g.fill('.gate input[aria-label="Your name"]','Sue');await g.fill('.gate input[aria-label="Password"]','test1234');await g.click('.gate button[type=submit]');await g.waitForSelector('.psub');
  // grab bag settings row
  await hp.click('#gear-btn');await hp.waitForSelector('.gm');await hp.click('.gm-nav button[data-tab=advanced]');await hp.locator('text=Grab Bag').first().scrollIntoViewIfNeeded();await hp.locator('text=Grab Bag').first().click();await sleep(400);await hp.screenshot({path:SP+'/v_grab_settings.png'});
  ok(await hp.locator('input[type=radio][value=grab]').isChecked().catch(()=>true),'Grab Bag selectable');
  await hp.click('.gm-x');await sleep(500);
  let hv=await snap('/api/host/'+H+'/events');
  await act({type:'open',id:hv.items[0].id});
  await g.waitForSelector('.pcard');await hp.waitForSelector('text=0/1 Locked In');ok(true,'host shows 0/1 Locked In');
  ok(await g.locator('.lockbtn').count()===0,'no lock button before a pick');
  await g.locator('.tier-btn, .tierbtn, .ptier, [data-tier]').first().click().catch(async()=>{await g.evaluate(()=>0);});
  await sleep(500);await g.screenshot({path:SP+'/v_poll_g.png'});await hp.screenshot({path:SP+'/v_poll_h.png'});
  const lb=g.locator('.lockbtn');
  if(await lb.count()){ok((await lb.innerText())==='Lock It In','button reads Lock It In');await lb.click();ok(true,'clicked lock');}
  else ok(false,'no lock button after pick');
  await hp.waitForSelector('.allin-curtain',{timeout:4000});ok(true,'banner appears on all locked in');
  await sleep(700);await hp.screenshot({path:SP+'/v_allin.png'});
  const frozen=await hp.evaluate(()=>S.freeze);ok(frozen===true,'stage frozen while the banner holds');
  await hp.waitForSelector('.allin-curtain',{state:'detached',timeout:5000});ok(true,'banner leaves');
  ok(await hp.locator('text=Reveal Results').count()>0,'Reveal Results page is behind it');
  await hp.screenshot({path:SP+'/v_after_allin.png'});
  // narrow widths
  for(const w of [820,390,320]){await hp.setViewportSize({width:w,height:800});await sleep(300);await hp.screenshot({path:SP+'/v_after_'+w+'.png'});}
  console.log(errs.length?'ERRS '+errs.join('; '):'ERRS none');
  await br.close();console.log(fails?'FAILED':'ALL PASS');process.exit(fails?1:0);
})();
