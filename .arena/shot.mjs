import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://127.0.0.1:3000';
const out = process.argv[3] || '/tmp/shot.png';
const width = Number(process.argv[4] || 400);
const height = Number(process.argv[5] || 860);

const executablePath = await chromium.executablePath();
const browser = await puppeteer.launch({
  args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'],
  executablePath,
  headless: true,
});
const page = await browser.newPage();
await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: width < 600, hasTouch: true });
const errors = [];
page.on('console', (m) => { if (m.type()==='error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }).catch(e=>errors.push('NAV:'+e.message));
await new Promise(r=>setTimeout(r, 2500));
await page.screenshot({ path: out });
console.log(JSON.stringify({ url, title: await page.title(), errors: errors.slice(0,10) }, null, 2));
await browser.close();
