//gemini scraper
export default async function handler(req, res) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');

    try {
        let prompt = '';
        const system = req.query.system || '';
        const sessionId = req.query.sessionId || null;

        if (req.method === 'GET') {
            prompt = req.query.text || req.query.prompt || '';
        } else if (req.method === 'POST') {
            if (req.body) {
                if (typeof req.body === 'string') {
                    prompt = req.body;
                } else if (Buffer.isBuffer(req.body)) {
                    prompt = req.body.toString('utf-8');
                } else if (typeof req.body === 'object' && req.body !== null) {
                    prompt = req.body.text || req.body.prompt || Object.keys(req.body)[0] || '';
                }
            }

           
            if (!prompt) {
                prompt = await new Promise((resolve) => {
                    let bodyData = '';
                    req.on('data', chunk => { bodyData += chunk; });
                    req.on('end', () => resolve(bodyData.trim()));
                    req.on('error', () => resolve(''));
                });
            }

            if (!prompt) {
                prompt = req.query.text || req.query.prompt || '';
            }
        } else {
            return res.status(405).send('Method Not Allowed.');
        }

        prompt = prompt.trim();

        if (!prompt && !system) {
            return res.status(400).send('Error: Prompt kosong. Kirim teks via Body POST atau parameter ?text=');
        }

        const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const clientIp = rawIp.split(',')[0].trim();

        const result = await gemini({ prompt, system, sessionId }, clientIp);

        return res.status(200).send(result.text);

    } catch (err) {
        return res.status(500).send(`*[SCRAPER ERROR]*\n\n${err.message || String(err)}`);
    }
}

async function gemini({ prompt, system = '', sessionId = null }, clientIp = '') {
    if (!prompt && !system) throw new Error("Parameter required: { prompt, system, sessionId }");
    
    let data, cookie, promptsystem = system;
    
    if (sessionId) {
        let session = JSON.parse(Buffer.from(sessionId, 'base64').toString());
        data = session.data;
        cookie = session.cookie;
        promptsystem ||= session.system || '';
    }

    const forwardedHeaders = {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };

    if (clientIp) {
        forwardedHeaders['X-Forwarded-For'] = clientIp;
        forwardedHeaders['X-Real-IP'] = clientIp;
        forwardedHeaders['CF-Connecting-IP'] = clientIp;
    }

    if (!cookie) {
        let res = await fetch("https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=maGuAc&source-path=%2F&bl=boq_assistant-bard-web-server_20250814.06_p1&f.sid=-7816331052118000090&hl=en-US&_reqid=173780&rt=c", {
            method: "POST",
            headers: forwardedHeaders,
            body: "f.req=%5B%5B%5B%22maGuAc%22%2C%22%5B0%5D%22%2Cnull%2C%22generic%22%5D%5D%5D&"
        });
        cookie = res.headers.get('set-cookie')?.split(';')[0] || '';
    }

    let res = await fetch("https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=boq_assistant-bard-web-server_20250729.06_p0&f.sid=4206607810970164620&hl=en-US&_reqid=2813378&rt=c", {
        method: 'POST',
        headers: {
            ...forwardedHeaders,
            "x-goog-ext-525001261-jspb": "[1,null,null,null,\"9ec249fc9ad08861\",null,null,null,[4]]",
            cookie
        },
        body: new URLSearchParams({ 
            "f.req": JSON.stringify([
                null, 
                JSON.stringify([
                    [prompt, 0, null, null, null, null, 0],
                    ["en-US"],
                    data || ["", "", "", null, null, null, null, null, null, ""],
                    null, null, null, [1], 1, null, null, 1, 0, null, null, null, null, null, [[0]], 1, null, null, null, null, null,
                    ["", "", promptsystem, null, null, null, null, null, 0, null, 1, null, null, null, []],
                    null, null, 1, null, null, null, null, null, null, null, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], 1, null, null, null, null, [1]
                ])
            ]) 
        })
    });

    let result = await res.text();
    result = result.replace(/^\)\]\}'\n?/, '');
    if (!result) throw new Error("Response dari Google Gemini kosong / terblokir");

    let rmatch = [...result.matchAll(/^\d+\n(.+?)\n/gm)].reverse().find(chunk => {
        try {
            let outer = JSON.parse(chunk[1]);
            if (!outer[0] || !outer[0][2]) return false;
            let inner = JSON.parse(outer[0][2]);
            return inner[4];
        } catch { return false }
    });

    if (!rmatch) throw new Error("Format response invalid (RPC/Endpoint Gemini telah berubah)");

    let rparser = JSON.parse(JSON.parse(rmatch[1])[0][2]);

    return { 
        text: rparser[4][0][1][0].replace(/\*\*(.+?)\*\*/g, '*$1*'), 
        sessionId: Buffer.from(JSON.stringify({ 
            data: [...rparser[1], rparser[4][0][0]], 
            cookie, 
            system: promptsystem 
        })).toString('base64') 
    };
}
