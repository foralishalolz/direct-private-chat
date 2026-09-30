import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata:Metadata={title:"BitchAt",description:"BitchAt",robots:{index:false,follow:false},manifest:"/manifest.webmanifest",appleWebApp:{capable:true,statusBarStyle:"black-translucent",title:"BitchAt"}};
export const viewport:Viewport={width:"device-width",initialScale:1,viewportFit:"cover",interactiveWidget:"resizes-content",themeColor:"#0d0f14"};
export default function Layout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}</body></html>;}

