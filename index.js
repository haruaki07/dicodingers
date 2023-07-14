const puppeteer = require("puppeteer-core")
const config = require("./config.json")
const readline = require("readline/promises")
const chalk = require("chalk")

const containerSelector = "div.classroom-container"
const nextLinkSelector = ".classroom-bottom-nav__next"
const academyNameSelector = ".classroom-top-nav__title > p"
const tutorialNameSelector = ".classroom-bottom-nav__title"
// TODO: skip classroom
const unvisitedSelector = ".module-list-item__status svg path:only-child"
const cache = {}

async function main() {
  try {
    const opts = getOptions()

    let link = opts.link instanceof URL || config.start_link
    // show link prompt
    if (opts.link === true) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      })

      link = await rl.question("Start link: ")
      try {
        const url = new URL(link)
        if (!url.host.includes("dicoding"))
          throw new Error("link is not dicoding's url")
      } catch (e) {
        throw new Error("link is invalid url")
      }
    }

    const browser = await puppeteer.launch({
      headless: !opts.debug || opts.headless_debug,
      handleSIGINT: true,
      executablePath: config.chrome_path,
    })
    const page = await browser.newPage()

    // intercept page request
    await page.setRequestInterception(true)
    page.on("request", async (request) => {
      const url = request.url()
      // block unnecessary request
      if (
        ["image", "stylesheet", "font", "script"].includes(
          request.resourceType()
        ) &&
        // prevent dicoding assets blocking
        !new URL(url).hostname.endsWith("cloudfront.net")
      ) {
        request.abort()
      } else {
        // respond cached response if exist
        if (cache[url] && cache[url].expires > Date.now()) {
          await request.respond(cache[url])
          return
        }
        request.continue()
      }
    })

    // handle caching
    page.on("response", async (response) => {
      const url = response.url()
      const headers = response.headers()
      const cacheControl = headers["cache-control"] || ""
      const maxAgeMatch = cacheControl.match(/max-age=(\d+)/)
      const maxAge =
        maxAgeMatch && maxAgeMatch.length > 1 ? parseInt(maxAgeMatch[1], 10) : 0
      if (maxAge) {
        if (!cache[url] || cache[url].expires > Date.now()) return

        let buffer
        try {
          buffer = await response.buffer()
        } catch {
          return
        }

        cache[url] = {
          status: response.status(),
          headers: response.headers(),
          body: buffer,
          expires: Date.now() + maxAge * 1000,
        }
      }
    })

    await setCookie(page)
    await page.goto(link)

    let count = 0
    let lastLink = link
    while (true) {
      if (count === opts.count) break

      // check auth, if not auth then exit
      if (await page.evaluate(() => window._authed === false)) {
        console.log(`└─ ${chalk.red("EROR")} Not authenticed!`)
        break
      }

      // find next link and check if it is disabled,
      // exit if disabled or not found
      const nextLinkEl = await page.$(nextLinkSelector)
      if (nextLinkEl !== null) console.log(`┌ Found next link!`)
      else {
        console.log("No more link available! exiting...")
        break
      }
      const isDisabled = await nextLinkEl.evaluate((el) =>
        el.classList.contains("disabled")
      )
      if (isDisabled) {
        console.log(`└─ ${chalk.yellow("WARN")} Next link is disabled!`)
        break
      }

      // check if classrom is an exam
      const isExam = await page.evaluate(() => window.isExam)
      if (isExam) {
        console.log(
          `└─ ${chalk.yellow(
            "WARN"
          )} This is an exam classroom, you should do manual!`
        )
        break
      }

      // check if classroom is a submission
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

      // scroll to end. is this even necessary?
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
          const progress = Math.min(elapsed / duration, 1) // clamp progress to 1 after duration is exceeded
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

      // click next link and wait until ready
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }),
        page.click(nextLinkSelector),
        page.waitForSelector(
          [
            containerSelector,
            nextLinkSelector,
            academyNameSelector,
            tutorialNameSelector,
          ].join(", ")
        ),
      ])
      console.log(`└─ ${chalk.green("DONE")} ${tutorialName} | ${academyName}`)
      lastLink = page.url()
      count++
    }

    console.log(`\nLast link: ${lastLink}`)
    await browser.close()
    process.exit(0)
  } catch (e) {
    console.error("An error occurred: ", e)
    process.exitCode = 2
  }
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

function getOptions() {
  const argv = process.argv.slice(2)
  const args = {
    debug: false,
    headless_debug: false,
    quick: false,
    count: null,
    link: null,
  }

  for (const arg of argv) {
    if (arg === "-d") {
      args.debug = true
    } else if (arg === "-H") {
      args.headless_debug = true
    } else if (arg === "-q") {
      args.quick = true
    } else if (arg.startsWith("-c=")) {
      args.count = Number.parseInt(arg.slice(3))
    } else if (arg.startsWith("-l")) {
      if (arg.length > 3) {
        args.link = new URL(arg.slice(3))
      } else {
        args.link = true
      }
    }
  }

  return args
}

main()
