// Each person's signature image (PNG or JPEG, up to 300 KB), printed on the
// payment requests they create or approve. Stored per person as
// "signature:<userId>". A person's signature is only handed out for their own
// account, or for a payment request it legitimately belongs on: the
// requester's on any request, the approver's once approved.

export const SIGNATURE_MAX_BYTES=300*1024;
const PREFIX=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;

/** A checked data URL, or an error message. The bytes must really be a PNG or JPEG of the declared type. */
export function checkSignature(value){
 const m=typeof value==='string'&&value.length<=SIGNATURE_MAX_BYTES*1.4+64?value.match(PREFIX):null;
 if(!m)return {error:'Upload a PNG or JPG image of your signature, up to 300 KB.'};
 let bytes;try{bytes=Uint8Array.from(atob(m[2]),c=>c.charCodeAt(0));}catch{return {error:'That image could not be read.'};}
 if(bytes.length>SIGNATURE_MAX_BYTES)return {error:'The image is larger than 300 KB. Crop it or save it smaller.'};
 const png=bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47,jpeg=bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
 if(m[1]==='png'?!png:!jpeg)return {error:'That file is not a real PNG or JPG image.'};
 return {image:value};
}

/** Whose signatures a payment request may show: {requested, approved} user ids. */
export function signersOf(request){
 if(!request)return {};
 return {requested:request.requestedById,approved:request.status==='approved'?request.approvedById:undefined};
}

/** Where the signature sits on its line: x and y as % of the signature area, size as a multiple (1 = fits the area). */
export const DEFAULT_PLACEMENT={x:0,y:0,size:1};
export function checkPlacement(p){
 if(!p||typeof p!=='object')return {error:'Invalid signature position.'};
 const x=Number(p.x),y=Number(p.y),size=Number(p.size);
 if(![x,y,size].every(Number.isFinite)||Math.abs(x)>60||Math.abs(y)>80||size<0.4||size>2.5)return {error:'Invalid signature position.'};
 return {placement:{x:Math.round(x*10)/10,y:Math.round(y*10)/10,size:Math.round(size*100)/100}};
}
