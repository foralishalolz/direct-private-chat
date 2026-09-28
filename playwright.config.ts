
import {defineConfig,devices} from "@playwright/test";
export default defineConfig({testDir:"./tests/browser",fullyParallel:true,retries:1,workers:2,timeout:30000,use:{baseURL:"http://127.0.0.1:3000",trace:"retain-on-failure"},webServer:{command:"npm start",url:"http://127.0.0.1:3000",reuseExistingServer:!process.env.CI},projects:[{name:"desktop",use:{...devices["Desktop Chrome"]}},{name:"mobile",use:{...devices["iPhone 13"],defaultBrowserType:"chromium"}}],reporter:[["list"],["html",{open:"never"}]]});

