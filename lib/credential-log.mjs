// Who retrieved or changed each vendor's saved portal password: employee,
// vendor, action, time and outcome — never the password. One row per event
// (append-only, so simultaneous requests never overwrite each other), kept in
// the workspace table beside the encrypted password.
//
// A retrieval only proves the server sent the password. The browser then
// confirms a successful clipboard write separately (confirmCopy), so the
// history can tell "copied" from "requested for copying".

const prefix=payer=>`credential-log:${payer}:`;
const ACTIONS=['retrieve','change'],PURPOSES=['view','copy'],OUTCOMES=['ok','none','failed'];
const CONFIRM_WINDOW_MS=5*60*1000;

/** Record one event and return its id; throws when it can't be stored (callers withhold the password then). */
export async function recordCredentialEvent(db,payer,user,{action,purpose='',outcome},now=new Date()){
 if(!ACTIONS.includes(action)||!OUTCOMES.includes(outcome)||(action==='retrieve'&&!PURPOSES.includes(purpose)))throw Error('Unknown credential event.');
 const at=now.toISOString(),eventId=at+':'+crypto.randomUUID().slice(0,8);
 await db.prepare('INSERT INTO workspace (id,data,version) VALUES (?,?,0)').bind(prefix(payer)+eventId,JSON.stringify({at,userId:user.id,name:user.name,payer,action,...(purpose?{purpose}:{}),outcome})).run();
 return eventId;
}

/** Mark a copy retrieval as written to the clipboard: only by the same person, soon after, once. */
export async function confirmCopy(db,payer,user,eventId,now=Date.now()){
 if(typeof eventId!=='string'||!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z:[a-f0-9-]{8}$/.test(eventId))return false;
 const id=prefix(payer)+eventId,row=await db.prepare('SELECT data FROM workspace WHERE id=?').bind(id).first();
 const event=row&&JSON.parse(row.data);
 if(!event||event.userId!==user.id||event.action!=='retrieve'||event.purpose!=='copy'||event.outcome!=='ok'||event.confirmedAt||now-Date.parse(event.at)>CONFIRM_WINDOW_MS)return false;
 await db.prepare('UPDATE workspace SET data=?,version=version+1 WHERE id=?').bind(JSON.stringify({...event,confirmedAt:new Date(now).toISOString()}),id).run();
 return true;
}

/** Newest first. */
export async function credentialHistory(db,payer,limit=50){
 const rows=(await db.prepare('SELECT data FROM workspace WHERE substr(id,1,?)=? ORDER BY id DESC LIMIT ?').bind(prefix(payer).length,prefix(payer),limit).all()).results;
 return rows.map(row=>JSON.parse(row.data));
}
