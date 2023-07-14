const puppeteer = require("puppeteer-core")
const config = require("./config.json")
const { createCursor, installMouseHelper } = require("ghost-cursor")
const readline = require("readline/promises")
const chalk = require("chalk")

const DEBUG = process.argv.includes("-d")
const DEBUG_HEADLESS = DEBUG && process.argv.includes("-H")

const initBrowser = () => {
  return puppeteer.launch({
    headless: !DEBUG || DEBUG_HEADLESS,
    handleSIGINT: true,
    executablePath: config.chrome_path,
  })
}

async function main() {
  let link = config.start_link
  const allowSkip = process.argv.includes("--skip")

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

  // ghost-cursor init
  const cursor = createCursor(page)
  if (DEBUG) await installMouseHelper(page)

  await setCookie(page)
  await page.goto(link)

  let lastLink = link
  while (true) {
    const containerSelector = "div.classroom-container"
    const nextLinkSelector = ".classroom-bottom-nav__next"
    const academyNameSelector = ".classroom-top-nav__title > p"
    const tutorialNameSelector = ".classroom-bottom-nav__title"
    // TODO: skip classroom
    const unvisitedSelector = ".module-list-item__status svg path:only-child"

    if (await page.evaluate(() => window._authed === false)) {
      console.log(`└─ ${chalk.red("EROR")} Not authenticed!`)
      break
    }

    const nextLinkEl = await page.$(nextLinkSelector)
    if (nextLinkEl !== null) console.log(`┌ Found next link!`)
    const isDisabled = await nextLinkEl.evaluate((el) =>
      el.classList.contains("disabled")
    )
    if (isDisabled) break

    const isExam = await page.evaluate(() => window.isExam)
    if (isExam) {
      console.log(
        `└─ ${chalk.yellow(
          "WARN"
        )} This is an exam classroom, you should do manual!`
      )
      break
    }

    const isSubmission = await page.$("#modal-self-review")
    if (isSubmission !== null) {
      console.log(
        `└─ ${chalk.yellow(
          "WARN"
        )} This is a submission classroom, you should do manual!`
      )
      break
    }

    const academyName = await page.$eval(
      academyNameSelector,
      (el) => el.textContent
    )
    const tutorialName = await page.$eval(
      tutorialNameSelector,
      (el) => el.textContent
    )
    const containerEl = await page.$(containerSelector)

    // scroll to end
    await containerEl.evaluate((el) => {
      const duration = 2000 // 2s
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
    console.log(`└─ ${chalk.green("DONE")} ${tutorialName} | ${academyName}`)
    lastLink = page.url()
  }

  console.log(`\nLast link: ${lastLink}`)
  await browser.close()
  process.exit(0)
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
