// Regenerates the README screenshots in this folder. Puppeteer is a tooling-only
// dependency: the app itself stays dependency-free and this is never shipped.
//
//   python3 -m http.server 8000 &          # from the repo root
//   npm i puppeteer                        # or point CHROME_PATH at an existing Chrome
//   node docs/screenshots.mjs docs "http://localhost:8000/?tab=datacite&kind=clientId&q=dryad.dryad&n=25"
//
// Dryad at n=25 is the reference sample: large enough to show spread, small enough
// to run in seconds. Change it and the README alt text needs updating too.

import puppeteer from 'puppeteer'
import { mkdirSync } from 'node:fs'

const OUT = process.argv[2]
const URL = process.argv[3]
mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: process.env.CHROME_PATH || undefined,
  defaultViewport: { width: 1180, height: 1000, deviceScaleFactor: 2 },
})
const page = await browser.newPage()
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90000 })

// the analysis fires on load from the URL params; wait for the score card to appear
await page.waitForFunction(
  () => document.body.innerText.includes('CONCEPT COMPLETENESS'),
  { timeout: 90000 },
)
await new Promise(r => setTimeout(r, 2500))

// the sticky command bar would overlap the top of any element shot
await page.evaluate(() => {
  document.querySelectorAll('*').forEach(el => {
    const cs = getComputedStyle(el)
    const h = el.getBoundingClientRect().height
    if ((cs.position === 'sticky' || cs.position === 'fixed') && h > 20 && h < 200) {
      el.style.visibility = 'hidden'
    }
  })
})

const shots = [
  ['fair-profile.png', 'FAIR PROFILE'],
  ['concept-completeness.png', 'CONCEPT COMPLETENESS'],
  ['per-record-heatmap.png', 'PER-RECORD HEATMAP'],
]

for (const [file, heading] of shots) {
  const handle = await page.evaluateHandle(h => {
    const card = [...document.querySelectorAll('.card')].find(c => c.innerText.startsWith(h))
    card?.scrollIntoView({ block: 'center' })
    return card
  }, heading)
  const el = handle.asElement()
  if (!el) { console.log(`SKIP ${file}, no card starting with "${heading}"`); continue }
  await new Promise(r => setTimeout(r, 400))
  await el.screenshot({ path: `${OUT}/${file}` })
  console.log(`OK   ${file}`)
}

// the headline score card has no stable heading: match it by content
const scored = await page.evaluateHandle(() => {
  const card = [...document.querySelectorAll('.card')]
    .find(c => /EXCELLENT|GOOD|FAIR|POOR/.test(c.innerText) && /\d+(\.\d+)?\/14/.test(c.innerText))
  card?.scrollIntoView({ block: 'center' })
  return card
})
if (scored.asElement()) {
  await new Promise(r => setTimeout(r, 400))
  await scored.asElement().screenshot({ path: `${OUT}/score.png` })
  console.log('OK   score.png')
} else {
  console.log('SKIP score.png, headline card not found')
}

await browser.close()
