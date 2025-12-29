const jwt = require('jsonwebtoken');
const config = require('../../config');

// Секрет для шифрования (добавь JWT_SECRET в .env или config.js!)
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-it';

const authMiddleware = (req, res, next) => {
    // 1. Пытаемся достать токен из куки
    const token = req.cookies.token;

    if (!token) {
        return res.status(401).json({ error: 'Auth required' });
    }

    try {
        // 2. Расшифровываем токен
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // 3. 🔥 МАГИЯ: Мы жестко перезаписываем req.userId
        // Теперь неважно, что клиент прислал в ?userId=..., мы верим только токену
        req.userId = decoded.id;
        req.userRole = decoded.role;
        
        next(); // Пропускаем дальше
    } catch (e) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

module.exports = authMiddleware;
