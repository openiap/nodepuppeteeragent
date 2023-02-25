const { openiap } = require("@openiap/nodeapi")
const fs = require('fs');
var client = new openiap();
const puppeteer = require('puppeteer');

async function ProcessWorkitem(workitem) {
    console.log(`Processing workitem id ${workitem._id} retry #${workitem.retries}`);
    if(workitem.payload == null) workitem.payload = {};
    try {
        if(typeof workitem.payload == "string") workitem.payload = JSON.parse(workitem.payload)
    } catch (error) {
    }
    workitem.name = "Hello kitty"
    let browser = null;
    try {
      browser = await puppeteer.launch({executablePath: 'google-chrome', args: ['--no-sandbox', '--disable-setuid-sandbox']}); // headless: true
      const page = await browser.newPage();
    
      await page.goto('https://developer.chrome.com/');
    
      // Set screen size
      await page.setViewport({width: 1080, height: 1024});
    
      // Type into search box
      await page.type('.search-box__input', 'automate beyond recorder');
    
      // Wait and click on first result
      const searchResultSelector = '.search-box__link';
      await page.waitForSelector(searchResultSelector);
      await page.click(searchResultSelector);
    
      // Locate the full title with a unique string
      const textSelector = await page.waitForSelector(
        'text/Customize and automate'
      );
      const fullTitle = await textSelector.evaluate(el => el.textContent);

      var filename = "screenshot.png"
      var url = process.env.url;
      if(url == null || url == "") {
        if (workitem.payload) {
            url = workitem.payload.url;
        }
      }
      if(url != null && url != "") {
        console.log("goto page:", url)
        await page.goto(url, {
            waitUntil: "domcontentloaded",
          });
        var crypto = require('crypto');
        filename = crypto.randomBytes(4).readUInt32LE(0)+'.png';
      }
      

      await page.screenshot({                      // Screenshot the website using defined options
        path: filename,                            // Save the screenshot in current directory
        fullPage: false                            // take a fullpage screenshot
      });
    
      // Print the full title
      console.log(`The title of this blog post is "${fullTitle}".'.`);
      workitem.name = fullTitle
      if(workitem.name.length > 43) workitem.name = workitem.name.substring(0,43)
    } finally {
      if(browser != null) {
        await browser.close();
      }
    }


  
    
}
async function ProcessWorkitemWrapper(workitem) {
    var currentfiles = fs.readdirSync(".");
    try {
        for(var i = 0; i < workitem.files.length; i++) {
            const file = workitem.files[i];
            await client.DownloadFile({id: file._id});
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
    for(var i = 0; i < files.length; i++) {
        var filename = files[i]
        if(currentfiles.indexOf(filename) == -1 && fs.lstatSync(filename).isFile() ) {
            console.log("Adding " + filename + " to workitem")
            workitem.files.push({  filename,
                compressed:false,
                file: new Uint8Array(fs.readFileSync(filename))
              })
            _files.push(filename);
        }
    }
    await client.UpdateWorkitem({workitem})
    for(var i = 0; i < files.length; i++) {
        var filename = files[i]
        if(currentfiles.indexOf(filename) == -1 && fs.lstatSync(filename).isFile() ) {
            console.log("Removing " + filename)
            fs.unlinkSync(filename);
        }
    }
}
async function onConnected(client) {
    var queue = process.env.queue;
    var wiq = process.env.wiq;
    if(queue == null || queue == "") queue = wiq;
    const queuename = await client.RegisterQueue({queuename: queue}, async (message)=> {
        try {
            let workitem = null;
            let counter = 0;
            do {
                workitem = await client.PopWorkitem({ wiq })
                if(workitem != null) {
                    counter++;
                    await ProcessWorkitemWrapper(workitem);
                }    
            } while(workitem != null)
            if(counter > 0) {
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
    if(wiq == null || wiq == "") throw new Error("wiq environment variable is mandatory")
    if(queue == null || queue == "") queue = wiq;
    client.onConnected = onConnected;
    await client.connect();
    if(queue != null && queue != ""){
    } else {
        let counter = 1;
        do {
            let workitem = null;
            do {
                workitem = await client.PopWorkitem({ wiq })
                if(workitem != null) {
                    counter++;
                    await ProcessWorkitemWrapper(workitem);
                }    
            } while(workitem != null)
            if(counter > 0) {
                counter = 0;
                console.log(`No more workitems in ${wiq} workitem queue`)
            }
            await new Promise(resolve => { setTimeout(resolve, 30000) }); // wait 30 seconds
        } while ( true)
    }
}
main()
