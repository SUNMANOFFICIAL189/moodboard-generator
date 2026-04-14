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

export async function searchCosmos(query: string, maxResults = 12): Promise<ImageResult[]> {
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

    const searchUrl = `https://www.cosmos.so/search/elements/${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 20000 });

    // Wait for CDN images to render
    await page.waitForSelector("img[src*='cdn.cosmos.so']", { timeout: 8000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));

    const images = await page.evaluate((max: number) => {
      const results: Array<{ src: string; alt: string }> = [];
      const seen = new Set<string>();
      const imgs = document.querySelectorAll("img[src*='cdn.cosmos.so']");

      for (const img of imgs) {
        if (results.length >= max) break;
        const el = img as HTMLImageElement;
        const src = el.src || "";

        if (el.width < 80 || el.height < 80) continue;
        if (seen.has(src)) continue;
        seen.add(src);

        results.push({ src, alt: el.alt || "" });
      }
      return results;
    }, maxResults);

    return images.map((img, i): ImageResult => {
      // Extract author from alt text like "An image uploaded by Name on Date."
      const authorMatch = img.alt.match(/uploaded by (.+?) on /);
      const author = authorMatch?.[1] ?? "Cosmos";

      // Upgrade thumbnail (w=400) to full size (w=1200)
      const fullUrl = img.src.replace(/w=\d+/, "w=1200");

      return {
        id: `cosmos-${i}-${Date.now()}`,
        provider: "cosmos",
        thumbUrl: img.src,
        fullUrl,
        width: 0,
        height: 0,
        author,
        sourceUrl: `https://www.cosmos.so/search/elements/${encodeURIComponent(query)}`,
        alt: img.alt || query,
      };
    });
  } catch {
    return [];
  } finally {
    if (page) {
      try { await page.close(); } catch { /* ok */ }
    }
  }
}
