import puppeteer from './node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';
import { writeFileSync, mkdirSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url   = process.argv[2] || 'http://localhost:3000';
const label = process.argv[3] || '';
const dir   = path.join(__dirname, 'temporary screenshots');

mkdirSync(dir, { recursive: true });

// Auto-increment N
const existing = readdirSync(dir).filter(f => f.startsWith('screenshot-'));
const nums = existing.map(f => parseInt(f.replace('screenshot-','').split('-')[0])).filter(n => !isNaN(n));
const N = nums.length ? Math.max(...nums) + 1 : 1;
const filename = label ? `screenshot-${N}-${label}.png` : `screenshot-${N}.png`;
const filepath = path.join(dir, filename);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
const page    = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
await page.screenshot({ path: filepath, fullPage: false });
await browser.close();

console.log('Saved:', filepath);
