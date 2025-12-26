const { Composer, Markup } = require('telegraf');
const axios = require('axios');
const ai = require('../../ai'); // Твой ai.js
const db = require('../../db');

const bot = new Composer();

// Обработка фото (Чеки)
bot.on('photo', async (ctx) => {
    try {
        const msg = await ctx.reply('👀 Смотрю на чек...');
        
        // 1. Скачиваем фото
        const photo = ctx.message.photo.pop();
        const fileLink = await ctx.telegram.getFileLink(photo.file_id);
        const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);

        // 2. Берем категории из базы
        const userCategories = await db.getUserCategories(ctx.from.id, 'expense');

        // 3. Отправляем в AI
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, '🧠 Анализирую товары...');
        const data = await ai.parseReceipt(buffer, userCategories);

        if (!data) return ctx.editMessageText('❌ ИИ не смог прочитать чек.');

        // 4. Сохраняем во временную сессию
        ctx.session.temp_receipt = { data: data, photo_file_id: photo.file_id };

        // 5. Превью
        const diff = Math.abs(data.meta.total_receipt - data.meta.total_calculated);
        const statusIcon = diff < 5 ? '✅' : '⚠️';
        
        let preview = `🧾 *Предпросмотр чека*\n🏪 ${data.shop.name}\n📅 ${data.date}\n`;
        preview += `💰 Итого: *${data.meta.total_receipt}*\n🧮 Расчет: *${data.meta.total_calculated}* ${statusIcon}\n\n`;
        
        data.items.forEach((item, i) => {
            preview += `${i+1}. ${item.name} — ${item.sum}\n   └ _${item.category}_\n`;
        });

        preview += `\n_Записать эти данные в базу?_`;

        // 6. Кнопки
        const buttons = Markup.inlineKeyboard([
            [Markup.button.callback('💾 Записать в БД', 'receipt_save_confirm')],
            [Markup.button.callback('❌ Отмена', 'receipt_save_cancel')]
        ]);

        await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id);
        await ctx.replyWithMarkdown(preview, buttons);

    } catch (e) {
        console.error(e);
        ctx.reply('Ошибка обработки чека: ' + e.message);
    }
});

// Callback: Подтверждение сохранения
bot.action('receipt_save_confirm', async (ctx) => {
    const temp = ctx.session.temp_receipt;
    if (!temp) return ctx.editMessageText('⚠️ Данные устарели.');
    
    try {
        const receiptId = await db.createReceipt(ctx.from.id, temp.data, temp.photo_file_id);
        delete ctx.session.temp_receipt;
        
        const finalBtns = Markup.inlineKeyboard([
            [Markup.button.callback('📜 Показать детали', `receipt_show_${receiptId}`)],
            [Markup.button.callback('❌ Удалить чек', `receipt_del_${receiptId}`)]
        ]);
        await ctx.editMessageText(`✅ *Чек #${receiptId} сохранен!*`, { parse_mode: 'Markdown', ...finalBtns });
    } catch (e) {
        ctx.reply('Ошибка БД: ' + e.message);
    }
});

bot.action('receipt_save_cancel', (ctx) => {
    delete ctx.session.temp_receipt;
    ctx.editMessageText('❌ Отменено');
});

// Callback: Удаление чека
bot.action(/^receipt_del_(\d+)$/, async (ctx) => {
    const id = ctx.match[1];
    await db.dbRun('DELETE FROM receipts WHERE id = ?', [id]);
    await db.dbRun('DELETE FROM transactions WHERE receipt_id = ?', [id]);
    ctx.editMessageText('🗑 Чек и транзакции удалены.');
});

// Callback: Показ деталей
bot.action(/^receipt_show_(\d+)$/, async (ctx) => {
    const id = ctx.match[1];
    const items = await db.dbAll('SELECT * FROM transactions WHERE receipt_id = ?', [id]);
    if (!items.length) return ctx.reply('Позиции не найдены.');
    
    let msg = `🧾 **Чек #${id}**\n`;
    items.forEach((t, i) => {
        msg += `${i+1}. ${t.comment} — ${t.amount}\n`;
    });
    
    ctx.replyWithMarkdown(msg);
    ctx.answerCbQuery();
});

module.exports = bot;
