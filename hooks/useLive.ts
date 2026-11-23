
"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {db} from "@/lib/supabase";
import {errorText} from "@/lib/types";
export function useLive<T>(name:string,tables:string[],query:()=>Promise<T>,initial:T){
 const [data,setData]=useState<T>(initial),[error,setError]=useState(""),[loading,setLoading]=useState(true);
 const generation=useRef(0),initialValue=useRef(initial);
 const ref=useRef(query),active=useRef(false),flight=useRef(false),again=useRef(false);ref.current=query;
 const refresh=useCallback(async()=>{if(flight.current){again.current=true;return;}flight.current=true;const n=generation.current;try{const result=await ref.current();if(active.current&&n===generation.current){setData(result);setError("");}}catch(e){if(active.current&&n===generation.current)setError(errorText(e));}finally{flight.current=false;if(active.current){setLoading(false);if(again.current){again.current=false;void refresh();}}}},[]);
 const tableKey=tables.join(",");
 useEffect(()=>{generation.current++;active.current=true;setLoading(true);setData(initialValue.current);setError("");let timer:ReturnType<typeof setTimeout>;const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>void refresh(),150);};
 const c=db(),ch=c.channel(name+":"+crypto.randomUUID(),{config:{postgres_changes_options:{wait:true}}});
 for(const table of tableKey.split(","))if(table)ch.on("postgres_changes",{event:"*",schema:"public",table},schedule);
 ch.subscribe(status=>{if(status==="SUBSCRIBED")schedule();});schedule();
 const visible=()=>{if(document.visibilityState==="visible")schedule();};document.addEventListener("visibilitychange",visible);window.addEventListener("online",visible);
 return()=>{active.current=false;generation.current++;clearTimeout(timer);void c.removeChannel(ch);document.removeEventListener("visibilitychange",visible);window.removeEventListener("online",visible);};},[name,tableKey,refresh]);
 return{data,error,loading,refresh,setData};
}

