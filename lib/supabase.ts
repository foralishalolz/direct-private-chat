import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "./config";
let client: SupabaseClient | undefined;
export function db() {
  if (client) return client;
  if (SUPABASE_KEY.startsWith("sb_secret_")) throw new Error("Invalid public configuration.");
  client = createClient(SUPABASE_URL,SUPABASE_KEY,{
    auth:{ persistSession:true,autoRefreshToken:true,detectSessionInUrl:false },
    realtime:{ params:{ eventsPerSecond:10 } },
    global:{ fetch:(input,init) => {
      const signal=init?.signal ? AbortSignal.any([init.signal,AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
      return fetch(input,{...init,signal});
    }}
  });
  return client;
}
export async function rpc<T=unknown>(name: string,args?: Record<string,unknown>):Promise<T> {
  const {data,error}=await db().rpc(name,args);
  if(error) throw error;
  return data as T;
}
export async function endpoint(name: string,body: unknown,authenticated=true) {
  const {data:{session}}=await db().auth.getSession();
  if(authenticated&&!session) throw new Error("Sign in again.");
  const response=await fetch(SUPABASE_URL+"/functions/v1/"+name,{
    method:"POST",headers:{"Content-Type":"application/json",apikey:SUPABASE_KEY,...(authenticated&&session?{Authorization:"Bearer "+session.access_token}:{})},
    body:JSON.stringify(body),cache:"no-store",signal:AbortSignal.timeout(30000)
  });
  if(!response.ok){const data=await response.json().catch(()=>({error:"Please try again."}));throw new Error(data.error??"Please try again.");}
  return response;
}

