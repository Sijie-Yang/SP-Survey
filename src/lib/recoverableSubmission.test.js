import { submitWithRecovery } from './recoverableSubmission';
import { findPendingSubmission } from './surveyDraft';
const answer = {participant_id:'p',project_id:'study',responses:{q:4},survey_metadata:{completion_code:'same-code'}};
beforeEach(()=>localStorage.clear());
afterEach(()=>jest.useRealTimers());
test('persists the exact payload before an offline send, retaining it for refresh', async()=>{
 const send=jest.fn(async(payload)=>{ expect(findPendingSubmission('study').pending.completeData).toEqual(payload); throw new Error('offline'); });
 const result=await submitWithRecovery('study',answer,{},send);
 expect(result).toMatchObject({success:false,recoverySaved:true});
 expect(findPendingSubmission('study').pending.completeData).toEqual(answer);
});
test('an uncertain timed-out send retries with the same identity and answers', async()=>{
 jest.useFakeTimers();
 const first=submitWithRecovery('study',answer,{},()=>new Promise(()=>{}),100);
 jest.advanceTimersByTime(101); expect((await first).success).toBe(false);
 const restored=findPendingSubmission('study').pending.completeData;
 const send=jest.fn(async()=>({success:true,deduped:true}));
 expect(await submitWithRecovery('study',restored,{},send)).toMatchObject({success:true,deduped:true});
 expect(send).toHaveBeenCalledWith(answer);
});
