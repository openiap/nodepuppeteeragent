const { openiap } = require("@openiap/nodeapi")
const fs = require('fs');
var client = new openiap();
const puppeteer = require('puppeteer');

async function ProcessWorkitem(workitem) {
    console.log(`Processing workitem id ${workitem._id} retry #${workitem.retries}`);
    if (workitem.payload == null) workitem.payload = {};
    try {
        if (typeof workitem.payload == "string") workitem.payload = JSON.parse(workitem.payload)
    } catch (error) {
    }
    workitem.name = "Hello kitty " + (new Date()).toISOString(); // timestamp name, to show we updated the workitem
    let browser = null;
    try {
        browser = await puppeteer.launch({
            executablePath: 'google-chrome', // for some reason we NEED to set executablePath when running in docker.
            headless: true, // set to false to see the browser in action
            args: ['--no-sandbox', '--disable-setuid-sandbox'] // if running with root, you must also add , 
        }); // 
        const page = await browser.newPage();

        await page.goto('https://developer.chrome.com/');
        // Set screen size
        await page.setViewport({ width: 1080, height: 1024 });

        var crypto = require('crypto');
        filename = crypto.randomBytes(4).readUInt32LE(0) + '.png';
        await page.goto("https://news.ycombinator.com/");
        let urls = await page.evaluate(() => {
            let results = [];
            let items = document.querySelectorAll('.titleline a');
            items.forEach((item) => {
                results.push({
                    url: item.getAttribute('href'),
                    text: item.innerText,
                });
            });
            return results;
        })
        workitem.payload.urls = urls;
        await page.screenshot({                      // Screenshot the website using defined options
            path: filename,                            // Save the screenshot in current directory
            fullPage: false                            // take a fullpage screenshot
        });
    } finally {
        if (browser != null) {
            await browser.close();
        }
    }
}
async function ProcessWorkitemWrapper(workitem) {
    var currentfiles = fs.readdirSync(".");
    try {
        for (var i = 0; i < workitem.files.length; i++) {
            const file = workitem.files[i];
            await client.DownloadFile({ id: file._id });
        }
        await ProcessWorkitem(workitem);
        workitem.state = "successful"
    } catch (error) {
        workitem.state = "retry"
        workitem.errortype = "application" // business rule will never retry / application will retry as mamy times as defined on the workitem queue"
        workitem.errormessage = error.message ? error.message : error
        workitem.errorsource = error.stack.toString()
    }
    var _files = [];
    workitem.files = [];
    var files = fs.readdirSync(".");
    for (var i = 0; i < files.length; i++) {
        var filename = files[i]
        if (currentfiles.indexOf(filename) == -1 && fs.lstatSync(filename).isFile()) {
            console.log("Adding " + filename + " to workitem")
            workitem.files.push({
                filename,
                compressed: false,
                file: new Uint8Array(fs.readFileSync(filename))
            })
            _files.push(filename);
        }
    }
    await client.UpdateWorkitem({ workitem })
    for (var i = 0; i < files.length; i++) {
        var filename = files[i]
        if (currentfiles.indexOf(filename) == -1 && fs.lstatSync(filename).isFile()) {
            console.log("Removing " + filename)
            fs.unlinkSync(filename);
        }
    }
}
async function onConnected(client) {
    var queue = process.env.queue;
    var wiq = process.env.wiq;
    if (wiq == null || wiq == "") wiq = "nodepuppeteertest"
    if (queue == null || queue == "") queue = wiq;
    const queuename = await client.RegisterQueue({ queuename: queue }, async (message) => {
        try {
            let workitem = null;
            let counter = 0;
            do {
                workitem = await client.PopWorkitem({ wiq })
                if (workitem != null) {
                    counter++;
                    await ProcessWorkitemWrapper(workitem);
                }
            } while (workitem != null)
            if (counter > 0) {
                console.log(`No more workitems in ${wiq} workitem queue`)
            }
        } catch (error) {
            console.error(error)
        }
    })
    console.log("Consuming queue " + queuename);
}
async function main() {
    var wiq = process.env.wiq;
    var queue = process.env.queue;
    if (wiq == null || wiq == "") wiq = "nodepuppeteertest"
    if (wiq == null || wiq == "") throw new Error("wiq environment variable is mandatory")
    if (queue == null || queue == "") queue = wiq;
    client.onConnected = onConnected;
    await client.connect();
    if (queue != null && queue != "") {
    } else {
        let counter = 1;
        do {
            let workitem = null;
            do {
                workitem = await client.PopWorkitem({ wiq })
                if (workitem != null) {
                    counter++;
                    await ProcessWorkitemWrapper(workitem);
                }
            } while (workitem != null)
            if (counter > 0) {
                counter = 0;
                console.log(`No more workitems in ${wiq} workitem queue`)
            }
            await new Promise(resolve => { setTimeout(resolve, 30000) }); // wait 30 seconds
        } while (true)
    }
}
main()
