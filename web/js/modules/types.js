/** @typedef {'useful'|'not_relevant'|'neutral'|null} FeedbackState */
/** @typedef {{id:string, title:string, headline?:string, kind:string, helper:string, feedback_state:FeedbackState, has_insight:boolean, areas:Array<{id:string,label:string}>}} FeedItem */
/** @typedef {{id:string,name:string,watch:string,frequency:'off'|'now'|'day'|'week',timezone:string,next_run_at:string|null}} TeamMember */
/** @typedef {{members:TeamMember[],available:TeamMember[],selecting:boolean,max:number}} Team */
/** @typedef {{triage_running:boolean,team_selecting:boolean,ingest_running:boolean,ingest_interval_min:number,ingest:{finished:string,new:number,sources:number}|null}} FeedStatus */
/** @typedef {FeedStatus & {items:FeedItem[],team:Team,total:number,offset:number,limit:number,has_more:boolean,version:string}} FeedResponse */
/** @typedef {{demo:boolean,roles:Record<string,{label:string,focus:string}>}} MetaResponse */
/** @typedef {{run_id:string,kind:'insight'|'chat',status:'running'|'done'|'error',outcome:string,news_id:string|null,started:string,finished:string|null,last_seq:number,result:Object|null}} RunState */
export {};
