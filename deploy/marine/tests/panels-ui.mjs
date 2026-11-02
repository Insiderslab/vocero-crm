import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';

const repo = 'C:/Users/stefa/vocero-bambola-arm';
const outDir = 'C:/Users/stefa/bambola-runtime/qa/panels-calendar-ui-evidence';
const require = createRequire(path.join(repo, 'package.json'));
const { chromium } = require('playwright');
const baseURL = process.env.PANELS_QA_BASE_URL || 'http://127.0.0.1:3140/nautica';
const results = { runAt: new Date().toISOString(), baseURL: new URL(baseURL).origin, scenarios: [], failures: [], api: { reads: 0, writes: 0, authReads: 0 }, screenshots: [] };
const redacted = (s) => String(s).replace(/https?:\/\/[^\s"']+/g, '[url]').replace(/(?:token|secret|password|authorization|cookie)[=: ]+[^\s,;]+/gi, '$1=[redacted]').slice(0, 1200);
const assert = (cond, message) => { if (!cond) throw new Error(message); };
const stamp = (day, hour='14:30') => `${day}T${hour}:00-04:00`;
function trip(i, startAt=stamp('2026-11-02'), status='planned') {
  return { id:`qa-trip-${i}`, title:`Paseo de prueba ${i}`, startAt, endAt:new Date(new Date(startAt).getTime()+3*3600000).toISOString(), mode:'public', capacity:24, status, revision:1, totals:{reserved:5,registered:3,aboard:0,away:0,deboarded:0,waiting:0,capacity:24} };
}
const fullTrip = (summary, requiresReview=false) => ({ ...summary, bookings:[], passengers:[], services:[], incidents:[], reconciliationRequired:requiresReview, reconciliationNote:requiresReview?'Synthetic QA reconciliation fixture':'', drafts:{preTrip:'',followUp:'',cancellation:''} });
function payload(role='owner', summaries=[trip(1),trip(2,stamp('2026-11-18','09:15'),'cancelled'),trip(3,stamp('2026-12-01'),'completed')], selectedId=summaries[0]?.id || '', requiresReview=false) {
 const selected=summaries.find(x=>x.id===selectedId) || summaries[0] || null;
 return { role, organizationId:'qa-org', trips:summaries, trip:selected ? fullTrip(selected,requiresReview) : null };
}
async function main() {
 await fs.mkdir(outDir,{recursive:true});
 const browser=await chromium.launch({headless:true});
 const run=async (name, {role='owner',trips=[trip(1),trip(2,stamp('2026-11-18','09:15'),'cancelled'),trip(3,stamp('2026-12-01'),'completed')], viewport={width:1280,height:900}, exercise, reconciliation=false, holdTripId='', errorTripId=''}={})=>{
  const context=await browser.newContext({viewport, timezoneId:'Pacific/Honolulu'});
  const page=await context.newPage();
  const writes=[]; let abortOneWrite=false; let releaseHeldGet=null; let holdGetOnce=true; let errorGetArmed=false;
  await page.route('**/api/auth/get-session**', async route=>{ results.api.authReads++; await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({user:{id:'qa-user',name:'QA Admin',email:'qa@example.invalid',role},session:{id:'qa-session',userId:'qa-user',expiresAt:'2099-01-01T00:00:00.000Z',token:'synthetic-session-token'}})}); });
  await page.route('**/api/marine**', async route=>{
    const req=route.request();
    if(req.method()!=='GET'){results.api.writes++; writes.push({method:req.method(),url:'/api/marine'}); if(abortOneWrite){abortOneWrite=false; return route.abort('failed');} return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic read-only QA: writes blocked'})});}
    results.api.reads++;
    const url=new URL(req.url()); const id=url.searchParams.get('tripId') || '';
    if(errorGetArmed && id===errorTripId) return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic detail GET failure'})});
    if(holdTripId && id===holdTripId && holdGetOnce){ holdGetOnce=false; await new Promise(resolve=>{releaseHeldGet=resolve;}); }
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload(role,trips,id,reconciliation && id===(trips[0]?.id || '')))});
  });
  const sc=`${name.replace(/[^a-z0-9-]/gi,'-')}.png`;
  try {
   await page.goto(baseURL,{waitUntil:'domcontentloaded',timeout:30000});
   await page.getByText(role==='member'?'Rol: Tripulación':'Resumen',{exact:true}).first().waitFor({state:'visible',timeout:20000});
   await page.waitForTimeout(400);
   if(exercise) await exercise(page,{armRetry:()=>{abortOneWrite=true;},writeCount:()=>writes.length,releaseHeldGet:()=>releaseHeldGet?.(),armGetError:()=>{errorGetArmed=true;}});
   await page.screenshot({path:path.join(outDir,sc),fullPage:true}); results.screenshots.push(sc);
   results.scenarios.push({name,status:'passed',viewport,writeRequests:writes.length});
  } catch(e){
   const debug=redacted(e?.stack||e); results.failures.push({scenario:name,debug});
   try{await page.screenshot({path:path.join(outDir,sc),fullPage:true});results.screenshots.push(sc);}catch{}
   results.scenarios.push({name,status:'failed',viewport,writeRequests:writes.length,debug});
  } finally { releaseHeldGet?.(); await context.close(); }
 };
 try {
  await run('admin-panels-calendar',{exercise:async (page,{armRetry,writeCount})=>{
   const nav=page.getByRole('navigation',{name:'Paneles de administración'});
   assert(await nav.isVisible(),'Admin panel navigation missing');
   const body=await page.locator('body').innerText();
   assert(body.includes('Rol: Administración'),'Admin role label missing');
   for(const label of ['Resumen','Calendario','Operaciones','Administración','Clientes y ARM','Agencias','Equipo y accesos']) assert(await nav.getByRole('button',{name:label,exact:true}).count()===1,`Missing admin panel button: ${label}`);
   assert(body.includes('50 paseos disponibles'), 'Missing limited-view disclaimer');
   const beforePreviewWrites=writeCount();
   for(const label of ['Clientes y ARM','Agencias','Equipo y accesos']) { await nav.getByRole('button',{name:label,exact:true}).click(); const t=await page.locator('body').innerText(); assert(/Pendiente|No conectado/.test(t),`${label} lacks explicit pending/offline label`); assert(writeCount()===beforePreviewWrites,`Preview panel caused a write: ${label}`); }
   await nav.getByRole('button',{name:'Calendario',exact:true}).click();
   assert(await page.getByRole('button',{name:'Mes anterior'}).isDisabled(),'Previous month should be bounded at earliest returned month');
   await page.getByRole('button',{name:'Mes siguiente'}).click();
   assert((await page.locator('body').innerText()).includes('diciembre 2026'),'Next month did not advance to December 2026');
   assert(await page.getByRole('button',{name:'Mes siguiente'}).isDisabled(),'Next month should be bounded at latest returned month');
   const dec1=page.getByRole('button',{name:/2026-12-01/}); await dec1.focus(); await page.keyboard.press('Enter');
   assert((await page.locator('body').innerText()).includes('Paseo de prueba 3'),'Keyboard calendar navigation did not select matching completed trip');
   await page.getByRole('button',{name:'Mes anterior'}).click();
   const nov2=page.getByRole('button',{name:/2026-11-02/}); await nov2.focus(); await page.keyboard.press('Enter');
   const calText=await page.locator('body').innerText();
   assert(calText.includes('Paseo de prueba 1')&&calText.includes('Planificado'),'Caracas day grouping did not show matching planned trip');
   assert(calText.includes('Capacidad 24')&&calText.includes('5 reservados'),'Day list is missing capacity or reserved count');
   const nov18=page.getByRole('button',{name:/2026-11-18/}); await nov18.focus(); await page.keyboard.press('Enter');
   const cancelledText=await page.locator('body').innerText(); assert(cancelledText.includes('Paseo de prueba 2')&&cancelledText.includes('Cancelado'),'Cancelled trip is missing from calendar day list');
   await page.getByRole('button',{name:/2026-11-02/}).focus(); await page.keyboard.press('Enter');
   assert(writeCount()===beforePreviewWrites,'Calendar navigation created a write');
   await page.getByRole('button',{name:'Abrir paseo'}).first().click();
   await page.getByRole('button',{name:'Volver a paneles',exact:true}).click();
   await page.getByRole('navigation',{name:'Paneles de administración'}).getByRole('button',{name:'Administración',exact:true}).click();
   await page.getByRole('button',{name:'Abrir abordaje',exact:true}).waitFor({state:'visible',timeout:8000});
   armRetry(); await page.getByRole('button',{name:'Abrir abordaje',exact:true}).click();
   await page.getByRole('button',{name:'Reintentar misma operación'}).waitFor({state:'visible',timeout:8000});
   assert(await page.getByRole('button',{name:'Volver a paneles'}).isDisabled(),'Admin should not switch panels with a retryable operation pending');
   assert(await page.getByLabel('Paseo seleccionado').isDisabled(),'Trip selector should be disabled with a retryable operation pending');
   assert(writeCount()===beforePreviewWrites+1,'Expected one synthetic aborted write probe after visiting read-only panels');
  }});  await run('member-no-admin-menu',{role:'member',exercise:async page=>{
   const text=await page.locator('body').innerText(); assert(text.includes('Tripulación'),'Member role label missing'); assert(!text.includes('Clientes y ARM')&&!text.includes('Equipo y accesos'),'Member sees admin-only panel');
   for(const label of ['Hoy','Pasajeros','Servicios']) assert(await page.getByRole('navigation').getByRole('button',{name:label,exact:true}).count()===1,`Missing crew navigation: ${label}`);
  }});
  await run('truncated-50',{trips:Array.from({length:50},(_,i)=>trip(i+1,stamp(`2026-${String(7+(i%6)).padStart(2,'0')}-${String(1+(i%27)).padStart(2,'0')}`))),exercise:async page=>{
   const text=await page.locator('body').innerText(); assert(text.includes('Paseos: 50')&&text.includes('En esta vista'),'Counters do not label the truncated 50-row view'); assert(text.includes('50 paseos disponibles'),'Truncation disclaimer missing for 50 rows');
  }});  await run('empty-calendar',{trips:[],exercise:async page=>{
   await page.getByText('Calendario',{exact:true}).first().click(); assert((await page.locator('body').innerText()).includes('Sin paseos en esta vista'),'Empty calendar wording missing');
  }});
  await run('reconciliation-entry',{trips:[trip(1)],reconciliation:true,exercise:async(page,{writeCount})=>{
   await page.getByRole('button',{name:'Abrir paseo',exact:true}).click();
   await page.getByRole('button',{name:'Abrir revisión',exact:true}).waitFor({state:'visible',timeout:8000});
   assert((await page.locator('body').innerText()).includes('Revisión pendiente con Rosanni'),'Reconciliation detail view did not open');
   await page.getByRole('button',{name:'Abrir revisión',exact:true}).click();
   await page.getByRole('button',{name:'Confirmar revisión',exact:true}).waitFor({state:'visible',timeout:8000});
   assert(writeCount()===0,'Opening reconciliation review should not write');
  }});
  await run('detail-race-and-error',{holdTripId:'qa-trip-2',errorTripId:'qa-trip-2',exercise:async(page,{releaseHeldGet,armGetError,writeCount})=>{
   await page.getByRole('navigation',{name:'Paneles de administración'}).getByRole('button',{name:'Operaciones',exact:true}).click();
   await page.getByText('Paseo de prueba 1',{exact:true}).waitFor({state:'visible',timeout:8000});
   const tripSelect=page.getByLabel('Paseo seleccionado');
   await tripSelect.selectOption('qa-trip-2');
   await page.getByText('Cargando paseo…',{exact:true}).waitFor({state:'visible',timeout:5000});
   await tripSelect.selectOption('qa-trip-3');
   await page.getByText('Paseo de prueba 3',{exact:true}).waitFor({state:'visible',timeout:8000});
   releaseHeldGet();
   await page.waitForTimeout(500);
   assert(await tripSelect.inputValue()==='qa-trip-3','A late detail response changed the selected trip');
   assert(await page.getByText('Paseo de prueba 3',{exact:true}).count()>0&&!await page.getByText('Paseo de prueba 2',{exact:true}).count(),'Late stale detail overwrote the latest selected trip');
   armGetError(); await tripSelect.selectOption('qa-trip-2');
   await page.getByRole('alert').filter({hasText:'Synthetic detail GET failure'}).waitFor({state:'visible',timeout:8000});
   assert(await page.getByRole('button',{name:'Volver a paneles',exact:true}).isVisible(),'Back to panels control disappeared after detail error');
   await page.getByRole('button',{name:'Volver a paneles',exact:true}).click();
   assert(await page.getByRole('navigation',{name:'Paneles de administración'}).isVisible(),'Could not return to admin panels after detail error');
   await page.getByRole('navigation',{name:'Paneles de administración'}).getByRole('button',{name:'Operaciones',exact:true}).click();
   await page.getByLabel('Paseo seleccionado').selectOption('qa-trip-1');
   await page.getByText('Paseo de prueba 1',{exact:true}).waitFor({state:'visible',timeout:8000});
   assert(await page.getByText('Synthetic detail GET failure',{exact:true}).count()===0,'Successful selection did not clear the visible GET error'); assert((await page.locator('body').innerText()).includes('Con conexión'),'Successful selection did not restore the connected status');
   assert(writeCount()===0,'Detail error/recovery scenario must not write');
  }});  await run('mobile-360',{viewport:{width:360,height:800},exercise:async page=>{
   const dims=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth})); assert(dims.scroll<=dims.client,`Horizontal overflow ${dims.scroll}px > ${dims.client}px`);
   await page.getByRole('button',{name:'Calendario',exact:true}).click();
   const dayButtons=page.getByRole('button',{name:/2026-/}); assert(await dayButtons.count()>0,'Mobile calendar has no accessible day buttons');
   const sizes=await dayButtons.evaluateAll(buttons=>buttons.map(button=>{const r=button.getBoundingClientRect(); return {w:r.width,h:r.height};})); assert(sizes.every(({w,h})=>w>=44&&h>=44),`Calendar day targets below 44px: ${JSON.stringify(sizes)}`);
   const mobileCal=path.join(outDir,'mobile-360-calendar.png'); await page.screenshot({path:mobileCal,fullPage:true}); results.screenshots.push('mobile-360-calendar.png');
   const calDims=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth})); assert(calDims.scroll<=calDims.client,`Calendar horizontal overflow ${calDims.scroll}px > ${calDims.client}px`);
  }}); } catch(e){ results.failures.push({scenario:'harness',debug:redacted(e?.stack||e)}); }
 await browser.close();
 results.finishedAt=new Date().toISOString();
 const resultPath=path.join(outDir,'panels-calendar-ui.json');
 try { const prior=JSON.parse(await fs.readFile(resultPath,'utf8')); results.previousRuns=[...(prior.previousRuns||[]),{runAt:prior.runAt,finishedAt:prior.finishedAt,scenarios:prior.scenarios,failures:prior.failures,api:prior.api}]; } catch {}
 await fs.writeFile(resultPath,JSON.stringify(results,null,2),'utf8');
 console.log(JSON.stringify({output:path.join(outDir,'panels-calendar-ui.json'),scenarios:results.scenarios,failures:results.failures.length,api:results.api},null,2));
 if(results.failures.length) process.exitCode=1;
}
main().catch(async e=>{results.failures.push({scenario:'harness-fatal',debug:redacted(e?.stack||e)}); await fs.mkdir(outDir,{recursive:true}); await fs.writeFile(path.join(outDir,'panels-calendar-ui.json'),JSON.stringify(results,null,2)); console.error(redacted(e?.stack||e)); process.exitCode=1;});


















