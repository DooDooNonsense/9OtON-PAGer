const { chromium } = require('playwright');
const B='http://localhost:3128', SP=process.argv[2];
const j=async(m,u,b)=>{const r=await fetch(B+u,{method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});const x=await r.json().catch(()=>({}));x._s=r.status;return x;};
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++;};
(async()=>{
  const r=await j('POST','/api/rooms',{name:'R8'});const H=r.hostCode,J=r.joinCode;
  const act=a=>j('POST','/api/host/'+H+'/action',a);
  const nm=(cid,name)=>j('POST','/api/join/'+J+'/name',{cid,pw:'test1234',name});
  await act({type:'cfg',hostPlay:true,hostScore:true});
  await act({type:'hostname',name:'Host'});
  // unique names, ignoring case / spacing / punctuation
  let x=await nm('cidaaaaaaaa1','Pat');ok(x._s===200&&x.name==='Pat','first Pat joins');
  x=await nm('cidaaaaaaaa2','pat');ok(x._s===409&&x.error==='That name is already taken. Please try another.','"pat" rejected: '+x.error);
  x=await nm('cidaaaaaaaa2','P a t');ok(x._s===409,'"P a t" rejected');
  x=await nm('cidaaaaaaaa2','P.a-t');ok(x._s===409,'"P.a-t" rejected');
  x=await nm('cidaaaaaaaa2','HOST');ok(x._s===409,'host name counts as taken');
  x=await nm('cidaaaaaaaa1','Pat');ok(x._s===200,'returning guest keeps their own name');
  x=await nm('cidaaaaaaaa1','PAT');ok(x._s===200&&x.name==='PAT','guest may re-case their own name');
  x=await nm('cidaaaaaaaa2','Lee');ok(x._s===200,'distinct name accepted');
  x=await nm('cidaaaaaaaa2','pat');ok(x._s===409,'rename into a taken name is rejected');
  x=await act({type:'hostname',name:'lee'});ok(x._s>=400&&/already taken/.test(x.error||''),'host cannot take a guest name: '+x.error);
  // room has both; Pat leaves (stays reserved)
  const br=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome',args:['--no-sandbox']});
  const errs=[];
  const mk=async(n,vp)=>{const p=await br.newPage({viewport:vp,deviceScaleFactor:1});p.on('pageerror',e=>errs.push(n+' '+e));return p;};
  const g=await mk('g',{width:390,height:800});await g.goto(B+'/play#'+J);await g.fill('.gate input[aria-label="Your name"]','Lee');await g.fill('.gate input[aria-label="Password"]','test1234');await g.click('.gate button[type=submit]');
  await g.waitForSelector('.gate .err, .gate .err-line',{timeout:3000}).catch(()=>{});
  const em=await g.locator('.gate').innerText();ok(/already taken/.test(em),'guest page shows the taken message');
  await g.screenshot({path:SP+'/w1.png'});
  // host page: players list + badge gap + long name expand
  await act({type:'add',items:['Mushy','Soft','Mashed']});
  const p=await mk('host',{width:1100,height:760});await p.goto(B+'/host#'+H);await p.waitForSelector('.qcircle');
  await p.click('#gear-btn');await p.waitForSelector('.modal.gm');await p.click('.gm-tab:has-text("Room")');await p.waitForTimeout(500);
  await p.screenshot({path:SP+'/w2.png'});
  // leaderboard-like name + badge gap (use stats names card substitute: inject)
  const gap=await p.evaluate(()=>{const w=document.createElement('div');w.style.cssText='width:300px';document.body.append(w);const e=nameEl('Host',true);w.append(e);const t=e.querySelector('.nmt').getBoundingClientRect(),b=e.querySelector('.hostchip').getBoundingClientRect();const g=b.left-t.right;const cy=Math.abs((t.top+t.bottom)/2-(b.top+b.bottom)/2);w.remove();return {g,cy};});
  ok(Math.abs(gap.g-10)<1.5,'10px gap between name and HOST badge: '+gap.g);ok(gap.cy<3,'badge vertically centred: '+gap.cy);
  const lg=await p.evaluate(async()=>{const w=document.createElement('div');w.style.cssText='width:90px;position:fixed;left:10px;top:10px;background:#000';document.body.append(w);const e=nameEl('Longname12',true);w.append(e);const t=e.querySelector('.nmt');const a=t.scrollWidth>t.clientWidth;const r0=e.querySelector('.hostchip').getBoundingClientRect().width>0;e.classList.add('open');await new Promise(r=>setTimeout(r,50));const h2=t.getBoundingClientRect().height;const full=t.scrollWidth<=t.clientWidth+1;w.remove();return {a,r0,full,h2};});
  ok(lg.a,'long name ellipsizes by default');ok(lg.full,'long name shows in full when opened');ok(lg.r0,'badge stays visible');
  // stage tile font at narrow widths
  await p.close();
  for(const w of [1100,700,420]){
    const q=await mk('s'+w,{width:w,height:760});await q.goto(B+'/host#'+H);await q.waitForSelector('.qcircle');
    await act({type:'cfg',hostPlay:true});
    await q.close();
  }
  console.log(errs.length?'ERRS '+errs.join('; '):'ERRS none');
  console.log(fails?'FAILED '+fails:'ALL PASS');await br.close();process.exit(0);
})().catch(e=>{console.log('Error '+e.stack);process.exit(1)});
