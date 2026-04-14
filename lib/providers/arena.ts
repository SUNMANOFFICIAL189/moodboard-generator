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

export async function searchArena(query: string, maxResults = 12): Promise<ImageResult[]> {
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

    // Are.na uses a JSON-encoded query param for search
    const searchQuery = JSON.stringify({ term: { facet: query } });
    const searchUrl = `https://www.are.na/search?q=${encodeURIComponent(searchQuery)}`;
    await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 20000 });

    // Wait for images to render (Are.na hosts on images.are.na)
    await page.waitForSelector("img[src*='images.are.na']", { timeout: 8000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    const images = await page.evaluate((max: number) => {
      const results: Array<{ src: string; alt: string; link: string }> = [];
      const seen = new Set<string>();
      const imgs = document.querySelectorAll("img[src*='images.are.na']");

      for (const img of imgs) {
        if (results.length >= max) break;
        const el = img as HTMLImageElement;
        const src = el.src || "";

        // Skip tiny thumbnails
        if (el.width < 80 || el.height < 80) continue;
        if (seen.has(src)) continue;
        seen.add(src);

        // Try to find the closest link to a block
        const anchor = el.closest("a[href*='/block/']");
        const link = anchor ? (anchor as HTMLAnchorElement).href : "";

        results.push({ src, alt: el.alt || "", link });
      }
      return results;
    }, maxResults);

    return images.map((img, i): ImageResult => ({
      id: `arena-${i}-${Date.now()}`,
      provider: "arena",
      thumbUrl: img.src,
      fullUrl: img.src,
      width: 0,
      height: 0,
      author: "Are.na",
      sourceUrl: img.link || `https://www.are.na/search?q=${encodeURIComponent(searchQuery)}`,
      alt: img.alt || query,
    }));
  } catch {
    return [];
  } finally {
    if (page) {
      try { await page.close(); } catch { /* ok */ }
    }
  }
}
