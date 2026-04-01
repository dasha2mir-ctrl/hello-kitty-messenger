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

// Загрузка групп
function loadGroups() {
    try {
        if (fs.existsSync(GROUPS_FILE)) {
            return JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
        }
    } catch (e) { console.error(e); }
    return { groups: [], nextId: 1 };
}

// Сохранение групп
function saveGroups(groupsData) {
    fs.writeFileSync(GROUPS_FILE, JSON.stringify(groupsData, null, 2));
}

let users = loadUsers();
let messages = loadMessages();
let groupsData = loadGroups();
let onlineUsers = new Map(); // username -> socketId

// Функция для аватарки
function getRandomAvatar() {
    const avatars = ['🐱', '🌸', '💖', '🎀', '🌟', '🍬', '✨', '💝', '🐰', '🦄'];
    return avatars[Math.floor(Math.random() * avatars.length)];
}

// ============ API ============

// Регистрация
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

// Вход
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

// Получить всех пользователей
app.get('/api/users', (req, res) => {
    const userList = Object.keys(users).map(username => ({
        username,
        avatar: users[username].avatar,
        online: onlineUsers.has(username)
    }));
    res.json(userList);
});

// Поиск пользователя
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

// История личных сообщений
app.get('/api/messages/:user1/:user2', (req, res) => {
    const { user1, user2 } = req.params;
    const chatId = [user1, user2].sort().join('_');
    const chatMessages = messages[chatId] || [];
    res.json(chatMessages);
});

// ============ ГРУППОВЫЕ ЧАТЫ ============

// Создать группу
app.post('/api/groups/create', (req, res) => {
    const { name, createdBy, members } = req.body;
    
    if (!name || !createdBy) {
        return res.status(400).json({ error: 'Название и создатель обязательны!' });
    }
    
    const groupId = groupsData.nextId++;
    const newGroup = {
        id: groupId,
        name: name,
        avatar: '👥',
        createdBy: createdBy,
        members: [createdBy, ...(members || []).filter(m => m !== createdBy)],
        createdAt: new Date().toISOString()
    };
    
    groupsData.groups.push(newGroup);
    saveGroups(groupsData);
    
    res.json({ success: true, groupId });
});

// Получить группы пользователя
app.get('/api/groups/:username', (req, res) => {
    const { username } = req.params;
    const userGroups = groupsData.groups.filter(group => group.members.includes(username));
    res.json(userGroups);
});

// Получить участников группы
app.get('/api/groups/:groupId/members', (req, res) => {
    const { groupId } = req.params;
    const group = groupsData.groups.find(g => g.id == groupId);
    if (!group) return res.json([]);
    res.json(group.members);
});

// Добавить участника в группу
app.post('/api/groups/:groupId/add', (req, res) => {
    const { groupId } = req.params;
    const { username } = req.body;
    
    const group = groupsData.groups.find(g => g.id == groupId);
    if (!group) return res.status(404).json({ error: 'Группа не найдена' });
    
    if (!group.members.includes(username)) {
        group.members.push(username);
        saveGroups(groupsData);
    }
    
    res.json({ success: true });
});

// История сообщений группы
app.get('/api/group-messages/:groupId', (req, res) => {
    const { groupId } = req.params;
    const chatId = `group_${groupId}`;
    const chatMessages = messages[chatId] || [];
    res.json(chatMessages);
});

// ============ Socket.io ============

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
        const newMessage = {
            id: Date.now(),
            from,
            to,
            text: message,
            time,
            timestamp: Date.now(),
            readBy: [from]
        };
        messages[chatId].push(newMessage);
        saveMessages(messages);
        
        const targetSocketId = onlineUsers.get(to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('new_message', {
                id: newMessage.id,
                from, message, time
            });
        }
        
        socket.emit('message_sent', { id: newMessage.id, to, message, time });
    });
    
    // Групповое сообщение
    socket.on('group_message', (data) => {
        const { groupId, message, from, time } = data;
        const chatId = `group_${groupId}`;
        
        if (!messages[chatId]) messages[chatId] = [];
        const newMessage = {
            id: Date.now(),
            from,
            groupId: groupId,
            text: message,
            time,
            timestamp: Date.now(),
            readBy: [from],
            chatType: 'group'
        };
        messages[chatId].push(newMessage);
        saveMessages(messages);
        
        // Получаем участников группы
        const group = groupsData.groups.find(g => g.id == groupId);
        if (group) {
            group.members.forEach(member => {
                const targetSocketId = onlineUsers.get(member);
                if (targetSocketId && member !== from) {
                    io.to(targetSocketId).emit('new_group_message', {
                        id: newMessage.id,
                        groupId,
                        from,
                        message,
                        time
                    });
                }
            });
        }
        
        socket.emit('message_sent', { id: newMessage.id, to: `group_${groupId}`, message, time });
    });
    
    // Отметить сообщение как прочитанное
    socket.on('mark_read', (data) => {
        const { messageId, username, chatId } = data;
        
        const messagesList = messages[chatId];
        if (messagesList) {
            const msg = messagesList.find(m => m.id == messageId);
            if (msg && !msg.readBy.includes(username)) {
                msg.readBy.push(username);
                saveMessages(messages);
                
                // Уведомить отправителя о прочтении
                const senderSocketId = onlineUsers.get(msg.from);
                if (senderSocketId) {
                    io.to(senderSocketId).emit('message_read', {
                        messageId,
                        readBy: username,
                        chatId
                    });
                }
            }
        }
    });
    
    // Получить статус прочтения
    socket.on('get_read_status', (data) => {
        const { messageId, chatId } = data;
        const messagesList = messages[chatId];
        const msg = messagesList?.find(m => m.id == messageId);
        if (msg) {
            socket.emit('read_status', {
                messageId,
                readBy: msg.readBy || []
            });
        }
    });
    
    socket.on('get_history', (data) => {
        const { withUser } = data;
        const chatId = [socket.username, withUser].sort().join('_');
        const history = messages[chatId] || [];
        socket.emit('chat_history', history);
    });
    
    socket.on('get_group_history', (data) => {
        const { groupId } = data;
        const chatId = `group_${groupId}`;
        const history = messages[chatId] || [];
        socket.emit('group_history', history);
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
    console.log(`👥 Группы: ${GROUPS_FILE}`);
});