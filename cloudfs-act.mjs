import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--disable-gpu"],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.goto("http://127.0.0.1:5173/?preview=1", { waitUntil: "networkidle0" });
await page.evaluate(() => {
  const row = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("notes.txt"));
  row?.click();
});
await page.evaluate(() => {
  const button = [...document.querySelectorAll("button")].find((item) => item.textContent === "Copy to right");
  button?.click();
});
await new Promise((r) => setTimeout(r, 200));
const afterCopy = await page.evaluate(() => document.body.innerText.includes("upload · notes.txt"));
await page.screenshot({ path: "/tmp/cloudfs-queue.png" });

await page.goto("http://127.0.0.1:5173/?preview=1#/stores/new", { waitUntil: "networkidle0" });
await page.evaluate(() => {
  const button = [...document.querySelectorAll("button")].find((item) => item.textContent === "Amazon S3");
  button?.click();
});
await new Promise((r) => setTimeout(r, 200));
const form = await page.evaluate(() => document.body.innerText);
await page.screenshot({ path: "/tmp/cloudfs-s3form.png" });

await page.goto("http://127.0.0.1:5173/?preview=1#/settings", { waitUntil: "networkidle0" });
await page.evaluate(() => {
  const input = document.querySelector('input[type="color"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, "#16a34a");
  input?.dispatchEvent(new Event("input", { bubbles: true }));
  input?.dispatchEvent(new Event("change", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 200));
const primary = await page.evaluate(() => getComputedStyle(document.querySelector("button") ?? document.body).backgroundColor);
await page.screenshot({ path: "/tmp/cloudfs-green.png" });
console.log(JSON.stringify({ afterCopy, formHasSecret: form.includes("Secret"), formHasEndpoint: form.includes("Endpoint"), primary, errors }, null, 2));
await browser.close();
