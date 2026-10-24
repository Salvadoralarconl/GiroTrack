export function normalizeScheduleAutopay(data,now){
 const schedules=(data.paymentSchedules||[]).map(s=>({...s,autopay:typeof s.autopay==='boolean'?s.autopay:s.autopay==='on'?true:!!data.payers.find(p=>p.id===s.payer)?.autopay}));
 return {...data,paymentSchedules:schedules,payers:data.payers.map(p=>({...p,autopay:schedules.some(s=>s.payer===p.id&&s.autopay&&!s.paused&&(!s.end||s.end>=now))}))};
}
