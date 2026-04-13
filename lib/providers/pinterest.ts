import type { ImageResult } from "../types";
import puppeteer, { type Browser } from "puppeteer-core";

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.connected) return browserInstance;

  browserInstance = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--window-size=1280,900",
    ],
  });

  browserInstance.on("disconnected", () => { browserInstance = null; });
  return browserInstance;
}

export async function searchPinterest(query: string, maxResults = 12): Promise<ImageResult[]> {
  let browser: Browser;
  try {
    browser = await getBrowser();
  } catch {
    return [];
  }

  let page;
  try {
    page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    );
    await page.setViewport({ width: 1280, height: 900 });

    const searchUrl = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}&rs=typed`;
    await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 20000 });

    // Wait for pin images to render
    await page.waitForSelector("img[src*='pinimg.com']", { timeout: 8000 }).catch(() => {});

    // Small extra wait for lazy-loaded images
    await new Promise(r => setTimeout(r, 1500));

    const pins = await page.evaluate((max: number) => {
      const results: Array<{
        src: string;
        alt: string;
        link: string;
      }> = [];

      const seen = new Set<string>();
      const imgs = document.querySelectorAll("img[src*='pinimg.com']");

      for (const img of imgs) {
        if (results.length >= max) break;
        const el = img as HTMLImageElement;
        let src = el.src || "";

        // Skip tiny thumbnails, avatars, logos
        if (src.includes("/30x30/") || src.includes("/75x75/") || src.includes("/46x46/")) continue;
        if (src.includes("/60x60/") || src.includes("/140x140/")) continue;
        if (el.width < 100 || el.height < 100) continue;

        // Upgrade to 736px width for good quality
        src = src.replace(/\/\d+x\d*\//, "/736x/");

        if (seen.has(src)) continue;
        seen.add(src);

        const anchor = el.closest("a[href*='/pin/']");
        const link = anchor ? (anchor as HTMLAnchorElement).href : "";

        results.push({ src, alt: el.alt || "", link });
      }
      return results;
    }, maxResults);

    return pins.map((p, i): ImageResult => ({
      id: `pinterest-${i}-${Date.now()}`,
      provider: "pinterest" as ImageResult["provider"],
      thumbUrl: p.src.replace("/736x/", "/236x/"),
      fullUrl: p.src,
      width: 736,
      height: 736,
      author: "Pinterest",
      sourceUrl: p.link || `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`,
      alt: p.alt || query,
    }));
  } catch {
    return [];
  } finally {
    if (page) {
      try { await page.close(); } catch { /* ok */ }
    }
  }
}
