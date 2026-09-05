import type { Notice } from './notices.ts';
export interface Brief {notices:Notice[]; fetchedAt:string; sourceDate:string; stale:boolean; error?:string; rows:number}
