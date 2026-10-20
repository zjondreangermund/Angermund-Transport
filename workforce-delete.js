'use strict';
function removeWorker(state,id,{users=[],actor='Admin'}={}){
 const fail=(message,status=400)=>{const e=Error(message);e.status=status;throw e};
 const employee=(state.employees||[]).find(x=>x.id===id),driver=(state.drivers||[]).find(x=>x.id===id);if(!employee&&!driver)fail('Worker not found. Refresh the page.',404);
 if(users.some(u=>(u.staffId||u.staff_id)===id||(u.driverId||u.driver_id)===id))fail('This worker has an app login. Delete the linked login under App access first, or set the worker to Inactive.');
 const refs=['trips','payroll','loans','advances','diesel','expenses','inspections','incidents','tripIssues','payments'];
 for(const key of refs)if((state[key]||[]).some(x=>x.employeeId===id||x.driverId===id||x.staffId===id||x.workerId===id))fail('This worker has linked '+key+' records. Set the worker to Inactive to preserve their history.');
 if((state.tasks||[]).some(x=>x.assignedDriverId===id||x.employeeId===id||x.assignedStaffId===id||(['driver','employee','staff','worker'].includes(x.linkedType)&&x.linkedId===id)))fail('Remove or reassign this worker’s tasks first.');
 if((state.trucks||[]).some(x=>x.defaultDriverId===id))fail('Remove this worker’s default truck assignment first.');
 if((state.permits||[]).some(x=>['driver','employee','staff','worker'].includes(x.ownerType)&&x.ownerId===id))fail('Remove this worker’s linked document records first.');
 const snapshot={employee,driver,payProfiles:(state.payProfiles||[]).filter(x=>(x.employeeId||x.driverId)===id)},at=new Date().toISOString(),crypto=require('node:crypto');
 state.recordHistory??=[];state.recordHistory.unshift({id:crypto.randomUUID(),kind:'workers',record:structuredClone(snapshot),actor,action:'Delete worker',at});
 state.employees=(state.employees||[]).filter(x=>x.id!==id);state.drivers=(state.drivers||[]).filter(x=>x.id!==id);state.payProfiles=(state.payProfiles||[]).filter(x=>(x.employeeId||x.driverId)!==id);
 state.recordDeletionVersion=crypto.randomUUID();state.audit??=[];state.audit.unshift({id:crypto.randomUUID(),at,actor,action:'Worker removed: '+(employee||driver).name,linkedType:'employee',linkedId:id});state.audit=state.audit.slice(0,100);
 return{id,name:(employee||driver).name};
}
module.exports={removeWorker};
