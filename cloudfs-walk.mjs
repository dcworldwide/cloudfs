import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--disable-gpu", "--window-size=1280,800"],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR", error.message));
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("CONSOLE", msg.text());
});
await page.goto("http://127.0.0.1:5173/?preview=1", { waitUntil: "networkidle0" });
await page.waitForSelector("text/This Computer".replace("text/", "") ).catch(() => {});
await new Promise((r) => setTimeout(r, 500));
const text = await page.evaluate(() => document.body.innerText);
console.log("---EXPLORER---\n" + text.slice(0, 800));
await page.screenshot({ path: "/tmp/cloudfs-desktop.png" });

await page.click("a[href='#/stores/new']");
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: "/tmp/cloudfs-wizard.png" });
const azure = await page.evaluate(() => {
  const buttons = [...document.querySelectorAll("button")];
  const target = buttons.find((button) => button.textContent?.includes("Azure"));
  target?.click();
  return buttons.map((button) => button.textContent);
});
console.log("providers", azure);
await new Promise((r) => setTimeout(r, 300));
const dialog = await page.evaluate(() => document.body.innerText);
console.log("---DIALOG---\n" + dialog.slice(0, 600));
await page.screenshot({ path: "/tmp/cloudfs-azure.png" });
await page.keyboard.press("Escape");

await page.goto("http://127.0.0.1:5173/?preview=1#/settings", { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 300));
console.log("---SETTINGS---\n" + (await page.evaluate(() => document.body.innerText)).slice(0, 900));
await page.screenshot({ path: "/tmp/cloudfs-settings.png" });

await page.setViewport({ width: 390, height: 800 });
await page.goto("http://127.0.0.1:5173/?preview=1#/", { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: "/tmp/cloudfs-mobile.png" });
await browser.close();
