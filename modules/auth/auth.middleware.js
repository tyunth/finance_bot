const jwt = require('jsonwebtoken');
const db = require('../../db');

// Используем тот же секрет, что и в auth.routes.js
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-it';

module.exports = (req, res, next) => {
    // 1. Ищем токен: сначала в Куках, потом в Заголовке (на всякий случай)
    const token = req.cookies.token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);

    if (!token) {
        // Если токена нет совсем - ошибка 401
        console.log('🔒 AuthMiddleware: Token not found');
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    try {
        // 2. Проверяем токен
        const decoded = jwt.verify(token, JWT_SECRET);

        // 3. Сохраняем данные пользователя в запрос
        req.user = decoded;      // Для нового кода (req.user.id)
        req.userId = decoded.id; // Для старого кода (req.userId)

        // 4. Логирование использования (асинхронно, не блокируем запрос)
        const logUsage = async () => {
            try {
                const functionName = req.route ? req.route.path : req.path;
                await db.incrementUsageCounter(req.userId, functionName);
            } catch (e) {
                console.error('Error logging usage:', e);
            }
        };
        logUsage();

        // console.log(`🔓 Auth success. User ID: ${decoded.id}`);
        next();
    } catch (e) {
        console.error('🔒 AuthMiddleware: Invalid token', e.message);
        // Если токен протух или поддельный - очищаем куку и даем ошибку
        res.clearCookie('token');
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
};
