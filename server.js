const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.json());
app.use(express.static('public'));

// Файлы для хранения данных
const USERS_FILE = path.join(__dirname, 'users.json');
const MESSAGES_FILE = path.join(__dirname, 'messages.json');

// Загрузка пользователей
function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        }
    } catch (e) { console.error(e); }
    return {};
}

// Сохранение пользователей
function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Загрузка сообщений
function loadMessages() {
    try {
        if (fs.existsSync(MESSAGES_FILE)) {
            return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
        }
    } catch (e) { console.error(e); }
    return {};
}

// Сохранение сообщений
function saveMessages(messages) {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
}

let users = loadUsers();
let messages = loadMessages();
let onlineUsers = new Map(); // username -> socketId

// Функция для аватарки
function getRandomAvatar() {
    const avatars = ['🐱', '🌸', '💖', '🎀', '🌟', '🍬', '✨', '💝', '🐰', '🦄'];
    return avatars[Math.floor(Math.random() * avatars.length)];
}

// API: Регистрация
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || username.length < 3) {
        return res.status(400).json({ error: 'Имя должно быть минимум 3 символа! 🎀' });
    }
    if (!password || password.length < 4) {
        return res.status(400).json({ error: 'Пароль минимум 4 символа! 🔐' });
    }
    
    if (users[username]) {
        return res.status(400).json({ error: 'Такой никнейм уже занят! 💔' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    users[username] = {
        username,
        password: hashedPassword,
        avatar: getRandomAvatar(),
        createdAt: new Date().toISOString(),
        online: false
    };
    
    saveUsers(users);
    res.json({ success: true, message: 'Регистрация успешна! 💖' });
});

// API: Вход
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    const user = users[username];
    if (!user) {
        return res.status(400).json({ error: 'Пользователь не найден! 💔' });
    }
    
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
        return res.status(400).json({ error: 'Неверный пароль! 💔' });
    }
    
    res.json({
        success: true,
        user: {
            username: user.username,
            avatar: user.avatar
        }
    });
});

// API: Получить всех пользователей
app.get('/api/users', (req, res) => {
    const userList = Object.keys(users).map(username => ({
        username,
        avatar: users[username].avatar,
        online: onlineUsers.has(username)
    }));
    res.json(userList);
});

// API: Поиск пользователя по никнейму
app.get('/api/search/:query', (req, res) => {
    const query = req.params.query.toLowerCase();
    const results = Object.keys(users)
        .filter(username => username.toLowerCase().includes(query))
        .slice(0, 10)
        .map(username => ({
            username,
            avatar: users[username].avatar,
            online: onlineUsers.has(username)
        }));
    res.json(results);
});

// API: Получить историю сообщений
app.get('/api/messages/:user1/:user2', (req, res) => {
    const { user1, user2 } = req.params;
    const chatId = [user1, user2].sort().join('_');
    const chatMessages = messages[chatId] || [];
    res.json(chatMessages);
});

// Socket.io
io.on('connection', (socket) => {
    console.log('🔌 Новое подключение');
    
    socket.on('user_online', (username) => {
        socket.username = username;
        onlineUsers.set(username, socket.id);
        io.emit('users_online', Array.from(onlineUsers.keys()));
        console.log(`✅ ${username} онлайн`);
    });
    
    socket.on('private_message', (data) => {
        const { to, message, from, time } = data;
        const chatId = [from, to].sort().join('_');
        
        // Сохраняем сообщение
        if (!messages[chatId]) messages[chatId] = [];
        messages[chatId].push({
            from,
            to,
            text: message,
            time,
            timestamp: Date.now(),
            read: false
        });
        saveMessages(messages);
        
        // Отправляем если получатель онлайн
        const targetSocketId = onlineUsers.get(to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('new_message', {
                from, message, time
            });
        }
        
        socket.emit('message_sent', { to, message, time });
    });
    
    socket.on('get_history', (data) => {
        const { withUser } = data;
        const chatId = [socket.username, withUser].sort().join('_');
        const history = messages[chatId] || [];
        socket.emit('chat_history', history);
    });
    
    socket.on('typing', (data) => {
        const targetSocketId = onlineUsers.get(data.to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('user_typing', {
                from: socket.username,
                isTyping: data.isTyping
            });
        }
    });
    
    socket.on('disconnect', () => {
        if (socket.username) {
            onlineUsers.delete(socket.username);
            io.emit('users_online', Array.from(onlineUsers.keys()));
            console.log(`❌ ${socket.username} офлайн`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✨ Hello Kitty Messenger запущен!`);
    console.log(`💖 http://localhost:${PORT}`);
    console.log(`📁 Пользователи: ${USERS_FILE}`);
    console.log(`💬 Сообщения: ${MESSAGES_FILE}`);
});