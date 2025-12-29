const config = require('../../config');

/**
 * Обработка события от Home Assistant
 * @param {Object} bot - экземпляр Telegraf
 * @param {Object} payload - данные от HA { event: 'button_click', data: 'sport_increase' }
 */
async function handleWebhook(bot, payload) {
    console.log('🏠 HA Webhook received:', payload);

    if (!payload || !payload.event) return;

    // Пример обработки события "sport_click"
    if (payload.event === 'sport_click') {
        const userId = config.ADMIN_ID; // Пока хардкод на тебя
        
        // Тут можно вызвать sportService.updateLog(...)
        // Но пока просто уведомим
        await bot.telegram.sendMessage(userId, `🔘 Нажата кнопка! Действие: ${payload.action || 'Unknown'}`);
    }
    
    // Пример: Уведомление о стиралке
    if (payload.event === 'laundry_done') {
        await bot.telegram.sendMessage(config.ADMIN_ID, '🧺 Стирка завершена. Развесь белье!');
    }
}

module.exports = { handleWebhook };
