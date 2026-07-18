import { chromium } from 'playwright'

const out = 'C:/Users/anike/Desktop/HELM/screenshots'
import { mkdirSync } from 'node:fs'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

async function shot(path, file) {
  await page.goto('http://localhost:3000' + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600) // let fonts/paint settle
  await page.screenshot({ path: `${out}/${file}`, fullPage: true })
  console.log('captured', file)
}

await shot('/analytics', 'analytics-dark.png')
await shot('/agents', 'agents-dark.png')

await browser.close()
console.log('done')
