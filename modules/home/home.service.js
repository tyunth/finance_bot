const { Telegram } = require('telegraf');
const path = require('path');

const envPath = path.resolve(__dirname, '../../.env');
require('dotenv').config({ path: envPath });

const config = require('../../config');


const token = config.BOT_TOKEN || process.env.BOT_TOKEN;



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
