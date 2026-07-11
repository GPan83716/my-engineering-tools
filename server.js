const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const DB_FILE = path.join(__dirname, 'users.json');

// ==================== 【Brevo Web API 配置】 ====================
// 我们不再需要端口、host等配置，只需要 API Key 和发信邮箱即可！
const BREVO_API_KEY = process.env.EMAIL_PASS || '';  // 在 Render 配置为您新生成的 API Key (xkeysib-...)
const SENDER_EMAIL = process.env.SENDER_EMAIL || ''; // 在 Render 配置为您注册 Brevo 的个人邮箱
// ===============================================================

const verificationCodes = {};

if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify([]));
}

function getUsers() {
    try {
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
        return [];
    }
}

function saveUsers(users) {
    fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
}

const server = http.createServer((req, res) => {
    
    // 1. 发送验证码 API (改用原生的 HTTPS fetch API 发送)
    if (req.method === 'POST' && req.url === '/api/send-code') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const { email } = JSON.parse(body);
                if (!email || !email.includes('@')) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: '请输入有效的邮箱地址' }));
                }

                const code = Math.floor(100000 + Math.random() * 900000).toString();
                const expires = Date.now() + 5 * 60 * 1000;
                verificationCodes[email] = { code, expires };

                // 准备向 Brevo 发送 HTTPS POST 请求的数据
                const mailData = {
                    sender: { name: "工程工具箱", email: SENDER_EMAIL },
                    to: [{ email: email }],
                    subject: '【工程工具箱】注册验证码',
                    textContent: `您的验证码是：${code}，请在 5 分钟内输入。如果非本人操作，请忽略此邮件。`
                };

                // 直接使用原生 fetch 通过安全的 443 端口发送请求
                const response = await fetch('https://api.brevo.com/v3/smtp/email', {
                    method: 'POST',
                    headers: {
                        'accept': 'application/json',
                        'api-key': BREVO_API_KEY,
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify(mailData)
                });

                const responseData = await response.json();

                if (response.ok) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ message: '验证码发送成功' }));
                } else {
                    console.error('Brevo API 返回错误:', responseData);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ message: responseData.message || '发送验证码失败' }));
                }
            } catch (err) {
                console.error('网络请求失败:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: '发送失败，请稍后再试' }));
            }
        });
        return;
    }

    // 2. 注册 API
    if (req.method === 'POST' && req.url === '/api/register') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const { username, password, email, code } = JSON.parse(body);
                if (!username || !password || !email || !code) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: '所有字段均为必填项' }));
                }

                const record = verificationCodes[email];
                if (!record) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: '请先获取验证码' }));
                }
                if (Date.now() > record.expires) {
                    delete verificationCodes[email];
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: '验证码已过期，请重新获取' }));
                }
                if (record.code !== code) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: '验证码错误' }));
                }

                const users = getUsers();
                if (users.find(u => u.username === username)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: '用户名已存在' }));
                }
                if (users.find(u => u.email === email)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: '该邮箱已被注册' }));
                }

                users.push({ username, password, email });
                saveUsers(users);
                delete verificationCodes[email];

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: '注册成功' }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: '服务器内部错误' }));
            }
        });
        return;
    }

    // 3. 登录 API
    if (req.method === 'POST' && req.url === '/api/login') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            const { username, password } = JSON.parse(body);
            const users = getUsers();
            const user = users.find(u => u.username === username && u.password === password);

            if (user) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                const token = 'token_' + username + '_' + Date.now();
                res.end(JSON.stringify({ message: '登录成功', token: token }));
            } else {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: '用户名或密码错误' }));
            }
        });
        return;
    }

    // 4. 验证 Token API
    if (req.method === 'POST' && req.url === '/api/verify') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const { token } = JSON.parse(body);
                if (!token) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ valid: false }));
                }
                const parts = token.split('_');
                const username = parts[1];
                const users = getUsers();
                const userExists = users.some(u => u.username === username);

                if (userExists) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ valid: true, username: username }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ valid: false }));
                }
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ valid: false }));
            }
        });
        return;
    }

    // 5. 静态 file 托管
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
    if (filePath.includes('users.json')) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        return res.end('Forbidden');
    }

    const extname = path.extname(filePath);
    let contentType = 'text/html';
    if (extname === '.css') contentType = 'text/css';
    if (extname === '.js') contentType = 'text/javascript';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end('<h1>404 Not Found</h1>');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

const actualPort = process.env.PORT || PORT;
server.listen(actualPort, () => {
    console.log(`服务器已启动，监听端口: ${actualPort}`);
});