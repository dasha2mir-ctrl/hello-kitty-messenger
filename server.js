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
const CONTACTS_FILE = path.join(__dirname, 'contacts.json');

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

// Загрузка контактов (кто кого добавил)
function loadContacts() {
    try {
        if (fs.existsSync(CONTACTS_FILE)) {
            return JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8'));
        }
    } catch (e) { console.error(e); }
    return {};
}

function saveContacts(contacts) {
    fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts, null, 2));
}

let users = loadUsers();
let messages = loadMessages();
let groups = loadGroups();
let contacts = loadContacts();
let onlineUsers = new Map();

function getRandomAvatar() {
    const avatars = ['🐱', '🌸', '💖', '🎀', '🌟', '🍬', '✨', '💝'];
    return avatars[Math.floor(Math.random() * avatars.length)];
}

// Проверка уникальности тега
function isTagUnique(tag) {
    return !Object.values(users).some(user => user.tag === tag);
}

// API Регистрация
app.post('/api/register', async (req, res) => {
    const { username, tag, password } = req.body;
    
    console.log('Регистрация:', username, tag);
    
    if (!username || username.length < 2) {
        return res.status(400).json({ error: 'Имя минимум 2 символа! 🎀' });
    }
    if (!tag || tag.length < 3) {
        return res.status(400).json({ error: 'Тег минимум 3 символа! 🎀' });
    }
    if (!password || password.length < 4) {
        return res.status(400).json({ error: 'Пароль минимум 4 символа! 🔐' });
    }
    
    // Проверка уникальности тега
    if (!isTagUnique(tag)) {
        return res.status(400).json({ error: 'Такой тег уже занят! Выбери другой 💔' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    users[username] = {
        username,
        tag: tag.startsWith('@') ? tag : '@' + tag,
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
    
    // Получаем контакты пользователя
    const userContacts = contacts[username] || [];
    const contactsWithInfo = userContacts.map(contactUsername => ({
        username: contactUsername,
        tag: users[contactUsername]?.tag,
        avatar: users[contactUsername]?.avatar,
        online: onlineUsers.has(contactUsername)
    }));
    
    res.json({
        success: true,
        user: {
            username: user.username,
            tag: user.tag,
            avatar: user.avatar
        },
        contacts: contactsWithInfo
    });
});

// Поиск пользователя по тегу
app.get('/api/search/:tag', (req, res) => {
    const searchTag = req.params.tag;
    const normalizedSearch = searchTag.startsWith('@') ? searchTag : '@' + searchTag;
    
    const foundUser = Object.values(users).find(user => 
        user.tag.toLowerCase() === normalizedSearch.toLowerCase()
    );
    
    if (foundUser) {
        res.json({
            found: true,
            user: {
                username: foundUser.username,
                tag: foundUser.tag,
                avatar: foundUser.avatar,
                online: onlineUsers.has(foundUser.username)
            }
        });
    } else {
        res.json({ found: false });
    }
});

// Добавить контакт
app.post('/api/add-contact', (req, res) => {
    const { myUsername, contactUsername } = req.body;
    
    if (!contacts[myUsername]) {
        contacts[myUsername] = [];
    }
    
    if (!contacts[myUsername].includes(contactUsername)) {
        contacts[myUsername].push(contactUsername);
        saveContacts(contacts);
    }
    
    res.json({ success: true });
});

// Получить мои контакты
app.get('/api/my-contacts/:username', (req, res) => {
    const { username } = req.params;
    const userContacts = contacts[username] || [];
    
    const contactsWithInfo = userContacts.map(contactUsername => {
        const user = users[contactUsername];
        return {
            username: contactUsername,
            tag: user?.tag,
            avatar: user?.avatar,
            online: onlineUsers.has(contactUsername)
        };
    });
    
    res.json(contactsWithInfo);
});

// Получить информацию о пользователе по username
app.get('/api/user/:username', (req, res) => {
    const { username } = req.params;
    const user = users[username];
    
    if (user) {
        res.json({
            username: user.username,
            tag: user.tag,
            avatar: user.avatar,
            online: onlineUsers.has(username)
        });
    } else {
        res.status(404).json({ error: 'Не найден' });
    }
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
        const newMsg = {
            id: Date.now(),
            from,
            to,
            text: message,
            time,
            timestamp: Date.now(),
            readBy: [from]
        };
        messages[chatId].push(newMsg);
        saveMessages(messages);
        
        const targetSocketId = onlineUsers.get(to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('new_message', { id: newMsg.id, from, message, time });
        }
        
        socket.emit('message_sent', { id: newMsg.id, to, message, time });
    });
    
    // Групповое сообщение
    socket.on('group_message', (data) => {
        const { groupId, message, from, time } = data;
        const chatId = `group_${groupId}`;
        
        if (!messages[chatId]) messages[chatId] = [];
        const newMsg = {
            id: Date.now(),
            from,
            text: message,
            time,
            timestamp: Date.now(),
            groupId: groupId,
            readBy: [from]
        };
        messages[chatId].push(newMsg);
        saveMessages(messages);
        
        const group = groups.find(g => g.id == groupId);
        if (group) {
            group.members.forEach(member => {
                const targetSocketId = onlineUsers.get(member);
                if (targetSocketId && member !== from) {
                    io.to(targetSocketId).emit('new_group_message', { id: newMsg.id, groupId, from, message, time });
                }
            });
        }
    });
    
    // Отметить как прочитанное
    socket.on('mark_read', (data) => {
        const { messageId, username, chatId } = data;
        const msgs = messages[chatId];
        if (msgs) {
            const msg = msgs.find(m => m.id == messageId);
            if (msg && !msg.readBy.includes(username)) {
                msg.readBy.push(username);
                saveMessages(messages);
                
                const senderSocketId = onlineUsers.get(msg.from);
                if (senderSocketId && msg.from !== username) {
                    io.to(senderSocketId).emit('message_read', { messageId, readBy: username, chatId });
                }
            }
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