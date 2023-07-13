const puppeteer = require("puppeteer-core")
const config = require("./config.json")
const { createCursor, installMouseHelper } = require("ghost-cursor")
const readline = require("readline/promises")

const initBrowser = () => {
  return puppeteer.launch({
    headless: true,
    handleSIGINT: true,
    executablePath:
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  })
}

async function main() {
  const isDebug = process.argv.includes("-d")
  let link = config.start_link

  if (process.argv.includes("-n")) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    link = await rl.question("Start link: ")
    try {
      const url = new URL(link)
      if (!url.host.includes("dicoding"))
        throw new Error("the url is not dicoding's url")
    } catch (e) {
      console.error("invalid link: ", e)
      process.exitCode = 2
      return
    }
  }

  const browser = await initBrowser()

  const page = await browser.newPage()
  if (isDebug) await installMouseHelper(page)
  const cursor = createCursor(page)
  await setCookie(page)
  await page.goto(link)

  while (true) {
    const containerSelector = "div.classroom-container"
    const nextLinkSelector = ".classroom-bottom-nav__next"

    await Promise.all([
      page.waitForSelector(containerSelector),
      page.waitForSelector(nextLinkSelector),
    ])

    const isDisabled = await page.evaluate((selector) => {
      const nextBtn = document.querySelector(selector)
      return nextBtn.classList.contains("disabled")
    }, nextLinkSelector)

    if (isDisabled) break

    const containerEl = await page.$(containerSelector)

    // scroll to end
    await containerEl.evaluate((el) => {
      const duration = 1000 // 1s
      const startScrollY = el.scrollTop
      const targetScrollY = startScrollY + el.scrollHeight
      let startTime

      function scrollDown(timestamp) {
        if (!startTime) {
          startTime = timestamp
        }
        const elapsed = timestamp - startTime
        const progress = Math.min(elapsed / duration, 1) // Clamp progress to 1 after duration is exceeded
        const easedProgress = easeOutBack(progress)
        const deltaY = (targetScrollY - startScrollY) * easedProgress
        el.scrollTo(0, startScrollY + deltaY)
        if (progress < 1) {
          window.requestAnimationFrame(scrollDown)
        }
      }

      function easeOutBack(x) {
        const c1 = 1.70158
        const c3 = c1 + 1

        return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
      }

      window.requestAnimationFrame(scrollDown)
    })

    await cursor.click(nextLinkSelector)
    console.log("✅ " + (await page.title()))
  }

  await browser.close()
}

/**
 * @param {import('puppeteer-core').Page} page
 */
async function setCookie(page) {
  /** @type {import('puppeteer-core').Protocol.Network.CookieParam[]}  */
  const cookies = [
    {
      name: "laravel_session",
      value: config.laravel_session,
      domain: "www.dicoding.com",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      priority: "Medium",
    },
  ]

  // delete all cookies
  await (async function () {
    const client = await page.target().createCDPSession()
    await client.send("Network.clearBrowserCookies")
    await client.detach()
  })()

  await page.setCookie(...cookies)
}

main()
