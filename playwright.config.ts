
import {defineConfig,devices} from "@playwright/test";
// CI sandboxes sometimes cannot reach cdn.playwright.dev. Supplying an existing
// Chromium binary keeps the visual/browser suite reproducible without changing
// the default Playwright installation for normal development.
const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const launchOptions=executablePath?{executablePath,args:["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--headless=shell"]}:undefined;
export default defineConfig({testDir:"./tests/browser",fullyParallel:true,retries:executablePath?0:1,workers:executablePath?1:2,timeout:30000,use:{baseURL:"http://127.0.0.1:3000",trace:"retain-on-failure",launchOptions},webServer:{command:"npm start",url:"http://127.0.0.1:3000",reuseExistingServer:!process.env.CI},projects:[{name:"desktop",use:{...devices["Desktop Chrome"]}},{name:"mobile",use:{...devices["iPhone 13"],defaultBrowserType:"chromium"}}],reporter:[["list"],["html",{open:"never"}]]});
