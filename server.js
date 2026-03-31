const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.json());
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

const USERS_FILE = path.join(__dirname, 'users.json');

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Ошибка загрузки пользователей:', error);
  }
  return {};
}

function saveUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error('Ошибка сохранения пользователей:', error);
  }
}

let users = loadUsers();
let onlineUsers = new Map();
let userSockets = new Map();

function getRandomAvatar() {
  const avatars = ['🐱', '🌸', '💖', '🎀', '🌟', '🍬', '✨', '💝', '🐰', '🦄'];
  return avatars[Math.floor(Math.random() * avatars.length)];
}
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Заполни все поля! 🎀' });
  }
  
  if (users[username]) {
    return res.status(400).json({ error: 'Такое имя уже существует! 💔' });
  }
  
  if (username.length < 3) {
    return res.status(400).json({ error: 'Имя должно быть минимум 3 символа! 🌸' });
  }
  
  const hashedPassword = await bcrypt.hash(password, 10);
  
  users[username] = {
    username,
    password: hashedPassword,
    createdAt: new Date().toISOString(),
    avatar: getRandomAvatar()
  };
  
  saveUsers(users);
  res.json({ success: true, message: 'Регистрация успешна! 💖' });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!users[username]) {
    return res.status(400).json({ error: 'Пользователь не найден! 💔' });
  }
  
  const isValid = await bcrypt.compare(password, users[username].password);
  
  if (!isValid) {
    return res.status(400).json({ error: 'Неверный пароль! 💔' });
  }
  
  res.json({ 
    success: true, 
    user: {
      username: users[username].username,
      avatar: users[username].avatar
    }
  });
});

app.get('/api/users', (req, res) => {
  const userList = Object.keys(users).map(username => ({
    username,
    avatar: users[username].avatar,
    isOnline: userSockets.has(username)
  }));
  res.json(userList);
});
io.on('connection', (socket) => {
  console.log('Новый пользователь подключился:', socket.id);
  
  socket.on('user_online', (username) => {
    socket.username = username;
    onlineUsers.set(socket.id, username);
    userSockets.set(username, socket.id);
    
    io.emit('users_online', Array.from(userSockets.keys()));
    
    socket.emit('notification', {
      text: `💖 Добро пожаловать в Hello Kitty Messenger, ${username}!`,
      type: 'welcome'
    });
    
    console.log(`${username} теперь онлайн`);
  });
  
  socket.on('private_message', (data) => {
    const { to, message, from, time } = data;
    const targetSocketId = userSockets.get(to);
    
    if (targetSocketId) {
      io.to(targetSocketId).emit('new_message', {
        from: from,
        message: message,
        time: time,
        isPrivate: true
      });
      
      socket.emit('message_sent', {
        to: to,
        message: message,
        time: time
      });
      
      console.log(`Сообщение от ${from} к ${to}: ${message}`);
    } else {
      socket.emit('notification', {
        text: `💔 ${to} сейчас не в сети. Сообщение не доставлено!`,
        type: 'error'
      });
    }
  });
  
  socket.on('public_message', (data) => {
    const { message, from, time } = data;
    
    io.emit('new_public_message', {
      from: from,
      message: message,
      time: time
    });
  });
  
  socket.on('typing', (data) => {
    const { to, isTyping } = data;
    const targetSocketId = userSockets.get(to);
    
    if (targetSocketId) {
      io.to(targetSocketId).emit('user_typing', {
        from: socket.username,
        isTyping: isTyping
      });
    }
  });
  
  socket.on('disconnect', () => {
    const username = socket.username;
    if (username) {
      onlineUsers.delete(socket.id);
      userSockets.delete(username);
      io.emit('user_offline', username);
      io.emit('users_online', Array.from(userSockets.keys()));
      console.log(`${username} вышел из чата`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✨ Hello Kitty Messenger запущен!`);
  console.log(`💖 Открой браузер и перейди на: http://localhost:${PORT}`);
  console.log(`🎀 Общайся с друзьями в реальном времени!`);
});