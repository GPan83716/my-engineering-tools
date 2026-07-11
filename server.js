const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const DB_FILE = path.join(__dirname, 'users.json');

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
    // 1. 注册 API
    if (req.method === 'POST' && req.url === '/api/register') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            const { username, password } = JSON.parse(body);
            if (!username || !password) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ message: '用户名和密码不能为空' }));
            }
            const users = getUsers();
            if (users.find(u => u.username === username)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ message: '用户名已存在' }));
            }
            users.push({ username, password });
            saveUsers(users);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: '注册成功' }));
        });
        return;
    }

    // 2. 登录 API
    if (req.method === 'POST' && req.url === '/api/login') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            const { username, password } = JSON.parse(body);
            const users = getUsers();
            const user = users.find(u => u.username === username && u.password === password);

            if (user) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                // 这里我们生成一个简单的 Token (在实际云端部署时，我们会换成更安全的 JWT 加密算法)
                const token = 'token_' + username + '_' + Date.now();
                res.end(JSON.stringify({ message: '登录成功', token: token }));
            } else {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: '用户名或密码错误' }));
            }
        });
        return;
    }

    // 3. 【新增】验证 Token API
    if (req.method === 'POST' && req.url === '/api/verify') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const { token } = JSON.parse(body);
                if (!token) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ valid: false, message: '无Token凭证' }));
                }

                // 解析我们的简易 Token 格式: token_用户名_时间戳
                const parts = token.split('_');
                const username = parts[1];

                const users = getUsers();
                const userExists = users.some(u => u.username === username);

                if (userExists) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ valid: true, username: username }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ valid: false, message: '无效的Token' }));
                }
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ valid: false, message: '数据解析失败' }));
            }
        });
        return;
    }

    // 4. 静态文件托管
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

// 如果系统环境有指定端口，就用系统端口；否则默认使用 3000
const actualPort = process.env.PORT || PORT;

server.listen(actualPort, () => {
    console.log(`服务器已启动，监听端口: ${actualPort}`);
});