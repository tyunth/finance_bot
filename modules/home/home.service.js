const { Telegram } = require('telegraf');
const config = require('../../config');

// Создаем "почтальона" отдельно от основного бота
const telegram = new Telegram(config.BOT_TOKEN);

async function handleWebhook(payload) {
    console.log('🏠 HA Webhook:', payload);

    if (!payload || !payload.event) return;

    // --- ЛОГИКА ОБРАБОТКИ СОБЫТИЙ ---
    
    // 1. Тестовое событие
    if (payload.event === 'test') {
        await telegram.sendMessage(config.ADMIN_ID, `🟢 Тест интеграции прошел успешно!`);
    }

    // 2. Нажатие Zigbee кнопки (пример payload: { event: 'button_click', action: 'single' })
    if (payload.event === 'button_click') {
        const action = payload.action || 'click';
        await telegram.sendMessage(config.ADMIN_ID, `🔘 Кнопка нажата: ${action}`);
        
        // Тут потом добавим:
        // if (action === 'single') sportService.addRepetition(...)
        // if (action === 'double') shoppingService.add(...)
    }

    // 3. Уведомление
    if (payload.event === 'notify') {
        await telegram.sendMessage(config.ADMIN_ID, `🏠 Дом сообщает: ${payload.message}`);
    }
}

module.exports = { handleWebhook };
