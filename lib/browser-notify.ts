// Shared by the notifier and the Notifications view; kept out of component files so Fast Refresh works.
export const NOTIFICATIONS_CHANGED='girotrack-notifications-changed';
export function showNotification(title:string,body:string,tag?:string){
 const note=new Notification(title,{body,tag,icon:'/girotrack-favicon.svg'});
 note.onclick=()=>{window.focus();note.close();};
}
