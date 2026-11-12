/* Todo Quest V80 : contrôles en lecture seule, sans appel Firebase. */
(function(global){
  'use strict';
  const arr=v=>Array.isArray(v)?v:[];
  const validDay=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
  const shift=(day,n)=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  const range=(kind,today)=>{
    const d=new Date(today+'T12:00:00Z');let start,end;
    if(kind==='week'||kind==='lastWeek') {const delta=(d.getUTCDay()+6)%7;start=shift(today,-delta-(kind==='lastWeek'?7:0));end=shift(start,6);}
    else {const offset=kind==='lastMonth'?-1:0;const first=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+offset,1,12));start=first.toISOString().slice(0,10);const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0,12));end=last.toISOString().slice(0,10);}
    return {start,end};
  };
  const preceding=({start,end})=>{const days=Math.round((Date.parse(end+'T12:00:00Z')-Date.parse(start+'T12:00:00Z'))/86400000)+1;return {start:shift(start,-days),end:shift(start,-1)};};
  function stats(data,period,today,taskPoints){
    const selected=range(period,today), before=preceding(selected), completed=arr(data.tasks).filter(t=>t&&t.status==='done'&&validDay(t.doneAt));
    const sport=arr(data.sportSessions),habits=arr(data.habits);
    const calc=(r)=>{
      const ts=completed.filter(t=>t.doneAt>=r.start&&t.doneAt<=r.end);
      const valued=ts.filter(t=>t.estimatedMinutes!==null&&t.estimatedMinutes!==''&&Number.isFinite(Number(t.estimatedMinutes))&&Number(t.estimatedMinutes)>0);
      const categories={}; for(const t of ts){const name=(typeof t.category==='string'&&t.category.trim())?t.category.trim():'Sans catégorie';categories[name]=(categories[name]||0)+1;}
      return {tasks:ts.length, estimatedMinutes:Math.round(valued.reduce((s,t)=>s+Number(t.estimatedMinutes),0)*100)/100,estimatedCount:valued.length,unknownCount:ts.length-valued.length,
        points:Math.round(ts.reduce((s,t)=>s+(typeof taskPoints==='function'?Number(taskPoints(t))||0:Number(t.points)||0),0)*100)/100,
        sportSessions:sport.filter(x=>x&&validDay(x.date)&&x.date>=r.start&&x.date<=r.end).length,
        habitValidations:habits.reduce((n,h)=>n+arr(h.history).filter(x=>validDay(typeof x==='string'?x:x?.date)&&(typeof x==='string'?x:x.date)>=r.start&&(typeof x==='string'?x:x.date)<=r.end).length,0),
        categories:Object.entries(categories).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([name,count])=>({name,count}))};
    };
    return {period,range:selected,current:calc(selected),previous:calc(before)};
  }
  function audit(data){
    const findings=[];
    const add=(severity,code,message)=>{if(findings.length<250)findings.push({severity,code,message});};
    if(!data||typeof data!=='object'||Array.isArray(data))return {checked:0,errors:1,warnings:0,findings:[{severity:'error',code:'format',message:'Racine JSON invalide'}]};
    const collections=['tasks','projects','habits','appointments','sportExercises','sportSessions','randomNotes','projectMilestones','shoppingSessions'];
    for(const k of collections){if(data[k]!==undefined&&!Array.isArray(data[k]))add('error','schema',k+' doit être une liste');}
    const ids={};for(const k of collections){const seen=new Set();for(const x of arr(data[k])){if(!x||typeof x!=='object'){add('error','item',k+' contient un élément non valide');continue;}if(!x.id){add('warning','missing-id',k+' : objet sans identifiant');continue;}if(seen.has(String(x.id)))add('error','duplicate-id',k+' : identifiant répété '+String(x.id));seen.add(String(x.id));}ids[k]=seen;}
    const projectIds=ids.projects||new Set(),taskIds=ids.tasks||new Set(),milestoneIds=ids.projectMilestones||new Set();
    for(const t of arr(data.tasks)){
      if(!t||typeof t!=='object')continue;
      const label=String(t.title||t.id||'Tâche sans titre').slice(0,75);
      if(t.projectId&&!projectIds.has(String(t.projectId)))add('error','project-ref','Tâche « '+label+' » : projet introuvable');
      if(t.milestoneId&&!milestoneIds.has(String(t.milestoneId)))add('error','milestone-ref','Tâche « '+label+' » : jalon introuvable');
      if(t.dependsOn){for(const id of (Array.isArray(t.dependsOn)?t.dependsOn:[t.dependsOn])){if(id&&!taskIds.has(String(id)))add('error','dependency-ref','Tâche « '+label+' » : dépendance introuvable');if(id&&id===t.id)add('error','dependency-self','Tâche « '+label+' » dépend d’elle-même');}}
      if(t.estimatedMinutes!==null&&t.estimatedMinutes!==undefined&&t.estimatedMinutes!==''&&(!Number.isFinite(Number(t.estimatedMinutes))||Number(t.estimatedMinutes)<=0))add('warning','duration','Tâche « '+label+' » : durée invalide');
      if(t.estimatedEffort&&!['light','medium','high'].includes(t.estimatedEffort))add('warning','effort','Tâche « '+label+' » : effort non reconnu');
      if(t.due&&!validDay(t.due))add('warning','task-date','Tâche « '+label+' » : échéance invalide');
      if(t.doneAt&&!validDay(t.doneAt))add('warning','done-date','Tâche « '+label+' » : date de fin invalide');
    }
    for(const m of arr(data.projectMilestones)){if(m?.projectId&&!projectIds.has(String(m.projectId)))add('error','milestone-project','Jalon sans projet valide : '+String(m.title||m.name||m.id));}
    const apptCat=new Set(arr(data.appointmentCategories).map(x=>String(x.id)));
    for(const a of arr(data.appointments)){
      if(!a||typeof a!=='object')continue;
      if(a.start&&!validDay(a.start)||a.end&&!validDay(a.end))add('warning','appointment-date','Rendez-vous : date invalide (« '+String(a.title||a.id)+' »)');
      else if(a.start&&a.end&&a.end<a.start)add('error','appointment-order','Rendez-vous : fin avant début (« '+String(a.title||a.id)+' »)');
      if(a.categoryId&&!apptCat.has(String(a.categoryId)))add('warning','appointment-category','Rendez-vous sans catégorie existante : '+String(a.title||a.id));
    }
    const errors=findings.filter(f=>f.severity==='error').length,warnings=findings.filter(f=>f.severity==='warning').length;
    return {checked:collections.reduce((n,k)=>n+arr(data[k]).length,0),errors,warnings,findings,truncated:findings.length>=250};
  }
  global.TQMaintenanceV80=Object.freeze({audit,stats,range,preceding});
})(window);
