import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./ios.css";
export const metadata:Metadata={title:"BitchAt",description:"BitchAt",robots:{index:false,follow:false},icons:{icon:"/icon.svg",apple:"/apple-touch-icon.png"},manifest:"/manifest.webmanifest",appleWebApp:{capable:true,statusBarStyle:"black-translucent",title:"BitchAt"}};
export const viewport:Viewport={width:"device-width",initialScale:1,viewportFit:"cover",interactiveWidget:"resizes-content",themeColor:"#0b0e18"};
export default function Layout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}</body></html>;}
