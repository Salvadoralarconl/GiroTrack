export function seed() {
 const d=new Date(); const date=(offset:number)=>{const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()+offset); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;};
 const payers=[
 {id:'p1',name:'FPL - Lights',category:'Utilities',color:'#e3eee5',initials:'E',autopay:true,portal:'https://example.com',username:'accounts@studio.co',account:'0082 4910 6621',method:'Bank transfer',type:'Business checking',address:'128 Willow Street\nBrooklyn, NY 11201'},
 {id:'p2',name:'NMB - Water',category:'Utilities',color:'#e7e8f7',initials:'A',autopay:true,portal:'',username:'',account:'AT-4821',method:'Credit card',type:'Business',address:''},
 {id:'p3',name:'Notion',category:'Subscriptions',color:'#efebe5',initials:'N',autopay:true,portal:'https://www.notion.so',username:'',account:'NT-103',method:'Credit card',type:'Software',address:''},
 {id:'p4',name:'Willow Properties',category:'Rent & lease',color:'#f4e7df',initials:'W',autopay:false,portal:'',username:'',account:'WP-211',method:'Bank transfer',type:'Lease',address:''},
 {id:'p5',name:'Figma',category:'Subscriptions',color:'#eee5f2',initials:'F',autopay:true,portal:'https://www.figma.com',username:'',account:'FG-086',method:'Credit card',type:'Software',address:''},
 {id:'p6',name:'Clearwater Supply',category:'Office supplies',color:'#e2edf2',initials:'C',autopay:false,portal:'',username:'',account:'CS-470',method:'Bank transfer',type:'Business',address:''}
 ];
 const invoices=[['p1',284.5,-5,'Electricity · October'],['p1',267.8,-32,'Electricity · September'],['p1',251.4,-62,'Electricity · August'],['p1',296.2,12,'Electricity · November'],['p2',89,4,'Water · October'],['p3',48,8,'Workspace subscription'],['p4',2400,7,'Studio rent · November'],['p5',45,-2,'Design team plan'],['p6',176.25,16,'Office essentials']].map((a,n)=>({id:`i${n}`,payer:a[0],amount:a[1],due:date(Number(a[2])),title:a[3],number:`INV-2026-${String(1084-n).padStart(4,'0')}`,group:payers.find(p=>p.id===a[0])!.category,bank:'4821',notes:'',attachments:[],payments:n===1||n===2?[{id:`pay${n}`,amount:a[1],date:date(Number(a[2])-1),method:'Bank transfer',reference:`TRX-820${n}`,receipts:[]}]:[]}));
 return {payers,invoices,views:[{id:'all',name:'All records',kind:'all',value:''},{id:'utilities',name:'Utilities',kind:'group',value:'Utilities'},{id:'subscriptions',name:'Subscriptions',kind:'group',value:'Subscriptions'},{id:'bank',name:'Operating account •4821',kind:'bank',value:'4821'}],activity:[{id:'welcome',time:new Date().toISOString(),text:'Demo workspace created. Edit these sample records or add your own.',invoice:null}]};
}

