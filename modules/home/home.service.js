const { Telegram } = require('telegraf');
const path = require('path');

// 🔥 ХАК: Сами грузим .env, так как server.js его не видит или грузит поздно
// Ищем файл .env на 2 уровня выше (в корне)
const envPath = path.resolve(__dirname, '../../.env');
require('dotenv').config({ path: envPath });

const config = require('../../config');

// Пытаемся добыть токен любыми способами (из конфига или напрямую из env)
const token = config.BOT_TOKEN || process.env.BOT_TOKEN;

// --- 🛠 ОТЛАДКА (DEBUG) ---
console.log('--- 🏠 HA MODULE INIT ---');
console.log(`📂 Ищем .env здесь: ${envPath}`);
console.log('🔑 Token в process.env:', process.env.BOT_TOKEN ? '✅ ЕСТЬ' : '❌ ПУСТО');
console.log('🔑 Token в config.js:', config.BOT_TOKEN ? '✅ ЕСТЬ' : '❌ ПУСТО');
if (!token) console.error('🚨 КРИТИЧЕСКАЯ ОШИБКА: Бот не сможет отправлять сообщения!');
console.log('-------------------------');

// Создаем инстанс только если есть токен
const telegram = token ? new Telegram(token) : null;

async function handleWebhook(payload) {
    console.log('🏠 HA Webhook payload:', payload);

    if (!telegram) {
        console.error('❌ Не могу отправить сообщение: нет токена!');
        return;
    }

    if (!payload || !payload.event) return;

    try {
        // 1. Тестовое событие
        if (payload.event === 'test') {
            await telegram.sendMessage(config.ADMIN_ID, `🟢 [Модуль Home] Тест прошел! Связь есть.`);
        }

        // 2. Нажатие кнопки
        if (payload.event === 'button_click') {
            const action = payload.action || 'click';
            await telegram.sendMessage(config.ADMIN_ID, `🔘 Кнопка нажата: ${action}`);
        }
        
        // 3. Уведомление
        if (payload.event === 'notify') {
             await telegram.sendMessage(config.ADMIN_ID, `🏠 ${payload.message}`);
        }

    } catch (e) {
        console.error('Ошибка отправки в Telegram:', e);
    }
}

module.exports = { handleWebhook };
