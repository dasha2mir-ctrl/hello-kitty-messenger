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
const GROUPS_FILE = path.join(__dirname, 'groups.json');

// Загрузка данных
function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        }
    } catch (e) { console.error(e); }
    return {};
}

function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function loadMessages() {
    try {
        if (fs.existsSync(MESSAGES_FILE)) {
            return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
        }
    } catch (e) { console.error(e); }
    return {};
}

function saveMessages(messages) {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
}

function loadGroups() {
    try {
        if (fs.existsSync(GROUPS_FILE)) {
            return JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
        }
    } catch (e) { console.error(e); }
    return [];
}

function saveGroups(groups) {
    fs.writeFileSync(GROUPS_FILE, JSON.stringify(groups, null, 2));
}

let users = loadUsers();
let messages = loadMessages();
let groups = loadGroups();
let onlineUsers = new Map();

function getRandomAvatar() {
    const avatars = ['🐱', '🌸', '💖', '🎀', '🌟', '🍬', '✨', '💝'];
    return avatars[Math.floor(Math.random() * avatars.length)];
}

// API Регистрация
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    
    console.log('Регистрация:', username);
    
    if (!username || username.length < 3) {
        return res.status(400).json({ error: 'Имя минимум 3 символа! 🎀' });
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
        createdAt: new Date().toISOString()
    };
    
    saveUsers(users);
    res.json({ success: true, message: 'Регистрация успешна! 💖' });
});

// API Вход
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    console.log('Вход:', username);
    
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

// Получить всех пользователей
app.get('/api/users', (req, res) => {
    const userList = Object.keys(users).map(username => ({
        username,
        avatar: users[username].avatar,
        online: onlineUsers.has(username)
    }));
    res.json(userList);
});

// Поиск пользователей
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

// История сообщений
app.get('/api/messages/:user1/:user2', (req, res) => {
    const { user1, user2 } = req.params;
    const chatId = [user1, user2].sort().join('_');
    const chatMessages = messages[chatId] || [];
    res.json(chatMessages);
});

// Создать группу
app.post('/api/groups/create', (req, res) => {
    const { name, createdBy, members } = req.body;
    
    const newGroup = {
        id: Date.now(),
        name: name,
        avatar: '👥',
        createdBy: createdBy,
        members: [createdBy, ...(members || []).filter(m => m !== createdBy)],
        createdAt: new Date().toISOString()
    };
    
    groups.push(newGroup);
    saveGroups(groups);
    
    res.json({ success: true, groupId: newGroup.id });
});

// Получить группы пользователя
app.get('/api/groups/:username', (req, res) => {
    const { username } = req.params;
    const userGroups = groups.filter(group => group.members.includes(username));
    res.json(userGroups);
});

// Получить участников группы
app.get('/api/groups/:groupId/members', (req, res) => {
    const { groupId } = req.params;
    const group = groups.find(g => g.id == groupId);
    res.json(group ? group.members : []);
});

// История группы
app.get('/api/group-messages/:groupId', (req, res) => {
    const { groupId } = req.params;
    const chatId = `group_${groupId}`;
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
    
    // Личное сообщение
    socket.on('private_message', (data) => {
        const { to, message, from, time } = data;
        const chatId = [from, to].sort().join('_');
        
        if (!messages[chatId]) messages[chatId] = [];
        messages[chatId].push({
            id: Date.now(),
            from,
            to,
            text: message,
            time,
            timestamp: Date.now(),
            read: false
        });
        saveMessages(messages);
        
        const targetSocketId = onlineUsers.get(to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('new_message', { from, message, time });
        }
        
        socket.emit('message_sent', { to, message, time });
    });
    
    // Групповое сообщение
    socket.on('group_message', (data) => {
        const { groupId, message, from, time } = data;
        const chatId = `group_${groupId}`;
        
        if (!messages[chatId]) messages[chatId] = [];
        messages[chatId].push({
            id: Date.now(),
            from,
            text: message,
            time,
            timestamp: Date.now(),
            groupId: groupId
        });
        saveMessages(messages);
        
        const group = groups.find(g => g.id == groupId);
        if (group) {
            group.members.forEach(member => {
                const targetSocketId = onlineUsers.get(member);
                if (targetSocketId && member !== from) {
                    io.to(targetSocketId).emit('new_group_message', { groupId, from, message, time });
                }
            });
        }
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
});