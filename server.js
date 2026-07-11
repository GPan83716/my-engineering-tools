const http = require('http');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer'); // 引入发信模块

const PORT = 3000;
const DB_FILE = path.join(__dirname, 'users.json');

// ==================== 【Brevo 发信邮箱配置】 ====================
const EMAIL_USER = process.env.EMAIL_USER || ''; // 截图中的 Login 账号
const EMAIL_PASS = process.env.EMAIL_PASS || '';     // 您生成的 xsmtpsib- 开头的密钥
const SENDER_EMAIL = process.env.SENDER_EMAIL || ''; // 例如:  (必须是您注册Brevo的邮箱)

// 创建邮件发送器
const transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false, // 587 端口必须为 false
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
    }
});
// =========================================================

// 用于在服务器内存中临时保存验证码，格式： { "email@xx.com": { code: "123456", expires: 时间戳 } }
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
    
    // 1. 发送验证码 API
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

                // 生成 6 位随机数字验证码
                const code = Math.floor(100000 + Math.random() * 900000).toString();
                // 设置过期时间为 5 分钟后
                const expires = Date.now() + 5 * 60 * 1000;
                verificationCodes[email] = { code, expires };

                // 邮件内容配置
                const mailOptions = {
                    from: `"工程工具箱" <${SENDER_EMAIL}>`, // 发件人
                    to: email, // 收件人
                    subject: '【工程工具箱】注册验证码',
                    text: `您的验证码是：${code}，请在 5 分钟内输入。如果非本人操作，请忽略此邮件。`
                };

                // 发送邮件
                await transporter.sendMail(mailOptions);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: '验证码发送成功' }));
            } catch (err) {
                console.error('发送邮件失败:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: '验证码发送失败，请检查邮箱配置或稍后再试' }));
            }
        });
        return;
    }

    // 2. 注册 API (加入邮箱验证)
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

                // 校验验证码是否存在及是否过期
                const record = verificationCodes[email];
                if (!record) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: '请先获取验证码' }));
                }
                if (Date.now() > record.expires) {
                    delete verificationCodes[email]; // 清理过期数据
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: '验证码已过期，请重新获取' }));
                }
                if (record.code !== code) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: '验证码错误' }));
                }

                // 验证码通过，执行注册
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

                // 注册成功后清除验证码缓存
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

    // 5. 静态文件托管
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