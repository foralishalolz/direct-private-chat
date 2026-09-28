"use client";
import {CheckCheck,Clock3,Eye,MessageCircleMore,RotateCcw} from "lucide-react";
import {usePrivacy,type PrivacySettings} from "@/hooks/usePrivacy";
import {ErrorNote,Modal,Spinner} from "./UI";
const controls:[keyof PrivacySettings,string,typeof Eye][]=[
 ["share_online","Online status",Eye],
 ["share_last_active","Last active",Clock3],
 ["share_typing","Typing indicator",MessageCircleMore],
 ["share_receipts","Read receipts",CheckCheck]
];
export default function PrivacyModal({onClose}:{onClose:()=>void}){
 const {settings,ready,busy,error,refresh,update}=usePrivacy();
 return <Modal title="Privacy" onClose={onClose}><div className="panel-pad privacy-controls">
  {controls.map(([key,title,Icon])=><button key={key} className="privacy-row" role="switch" aria-label={title} aria-checked={ready&&settings[key]} disabled={!ready||busy} onClick={()=>void update({[key]:!settings[key]})}><span className="privacy-icon"><Icon size={21}/></span><span>{title}</span><span className={"switch "+(ready&&settings[key]?"on":"")} aria-hidden="true"/></button>)}
  {!ready&&!error&&<div className="center pad"><Spinner/></div>}<ErrorNote text={error}/>{error&&<button className="menu-item" onClick={()=>void refresh()}><RotateCcw size={18}/>Retry</button>}
 </div></Modal>;
}
