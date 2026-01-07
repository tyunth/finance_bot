const { Composer, Markup } = require('telegraf');
const axios = require('axios');
const ai = require('./finance.ai'); 
const db = require('../../db');

const bot = new Composer();

// 🔥 УЛУЧШЕННАЯ ФУНКЦИЯ ЭКРАНИРОВАНИЯ
// Теперь она превращает все спецсимволы в безопасные
const escape = (text) => {
    if (!text) return '';
    // Экранируем: _ * [ ] ( ) ~ ` > # + - = | { } . !
    return text.toString().replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
};

// Исправленная функция предпросмотра
async function sendReceiptPreview(ctx) {
    const temp = ctx.session.temp_receipt;
    if (!temp) return ctx.reply('⚠️ Ошибка сессии. Попробуйте снова.');

    const data = temp.data;
    const displayName = temp.brandName || data.shop.name;
    const diff = Math.abs(data.meta.total_receipt - data.meta.total_calculated);
    const statusIcon = diff < 5 ? '✅' : '⚠️';
    
    // 🔥 ИСПРАВЛЕНИЕ: Экранируем даже жестко прописанные символы
    // Было: 🏪 ${escape(displayName)}
    // Стало: экранируем весь текст вокруг переменных тоже, где есть спецсимволы
    
    let preview = `🧾 *Предпросмотр чека*\n🏪 ${escape(displayName)}\n`;
    
    // Вот здесь была ошибка с '('
    if (temp.brandName && temp.brandName !== data.shop.name) {
        // Мы вручную добавляем \\ перед скобками
        preview += `_\\(по чеку: ${escape(data.shop.name)}\\)_\n`;
    }
    
    preview += `📅 ${escape(data.date)}\n`;
    preview += `💰 Итого: *${escape(data.meta.total_receipt)}*\n🧮 Расчет: *${escape(data.meta.total_calculated)}* ${statusIcon}\n\n`;
    
    data.items.forEach((item, i) => {
        // Точку после цифры тоже нужно экранировать: `${i+1}\\.`
        preview += `${i+1}\\. ${escape(item.name)} — ${escape(item.sum)}\n   └ _${escape(item.category)}_\n`;
    });

    preview += `\n_Записать эти данные в базу?_`;

    const buttons = Markup.inlineKeyboard([
        [Markup.button.callback('💾 Записать в БД', 'receipt_save_confirm')],
        [Markup.button.callback('❌ Отмена', 'receipt_save_cancel')]
    ]);

    try {
        if (ctx.callbackQuery) {
            await ctx.editMessageText(preview, { parse_mode: 'MarkdownV2', ...buttons });
        } else {
            await ctx.replyWithMarkdownV2(preview, buttons);
        }
    } catch (e) {
        console.error('Markdown Error:', e);
        // Если все равно упало — отправляем чистый текст без форматирования, чтобы не терять чек
        ctx.reply('⚠️ Форматирование не прошло, но вот данные:\n\n' + preview.replace(/\\/g, ''));
    }
}

// 1. Обработка ФОТО
bot.on('photo', async (ctx) => {
    try {
        const msg = await ctx.reply('👀 Смотрю на чек...');
        
        const photo = ctx.message.photo.pop();
        const fileLink = await ctx.telegram.getFileLink(photo.file_id);
        const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);
        const userCategories = await db.getUserCategories(ctx.from.id, 'expense');

        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, '🧠 Анализирую товары...');
        const data = await ai.parseReceipt(buffer, userCategories);

        if (!data) return ctx.editMessageText('❌ ИИ не смог прочитать чек.');

        ctx.session.temp_receipt = { data: data, photo_file_id: photo.file_id };
        await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id);

        // Проверка магазина
        const rawName = data.shop.name; 
        
        // Используем dbGet (если его нет в db.js, замените на const rows = await db.dbAll(...); const aliasRow = rows[0];)
        let aliasRow = null;
        try {
            const rows = await db.dbAll('SELECT brand_name FROM shop_aliases WHERE raw_name = ? AND user_id = ?', [rawName, ctx.from.id]);
            aliasRow = rows[0];
        } catch (e) {
            console.error('DB Alias Error:', e);
        }

        if (aliasRow) {
            ctx.session.temp_receipt.brandName = aliasRow.brand_name;
            await sendReceiptPreview(ctx);
        } else {
            ctx.session.awaiting_shop_name = true;

            // Тут используем MarkdownV2 и экранирование
            await ctx.reply(
                `🧐 Я впервые вижу магазин: *"${escape(rawName)}"* \n\nКак называть его в отчетах? \\(Например: *Магнум*\\)\n\n_Напиши название или нажми кнопку, чтобы оставить как есть\\._`,
                {
                    parse_mode: 'MarkdownV2',
                    ...Markup.inlineKeyboard([
                        Markup.button.callback('Оставить оригинальное', 'shop_alias_skip')
                    ])
                }
            );
        }

    } catch (e) {
        console.error(e);
        ctx.reply('Ошибка обработки чека: ' + e.message);
    }
});

// 2. Обработка ТЕКСТА (Алиас)
bot.on('text', async (ctx, next) => {
    if (!ctx.session.awaiting_shop_name) return next();

    const newBrandName = ctx.message.text;
    const rawName = ctx.session.temp_receipt.data.shop.name;

    try {
        await db.dbRun(
            `INSERT OR REPLACE INTO shop_aliases (user_id, raw_name, brand_name) VALUES (?, ?, ?)`,
            [ctx.from.id, rawName, newBrandName]
        );

        // Экранируем имена для ответа
        ctx.replyWithMarkdownV2(`👌 Запомнил: ${escape(rawName)} = ${escape(newBrandName)}`);
        
        ctx.session.temp_receipt.brandName = newBrandName;
        ctx.session.awaiting_shop_name = false;
        
        await sendReceiptPreview(ctx);

    } catch (e) {
        ctx.reply('Ошибка сохранения алиаса: ' + e.message);
    }
});

// 3. Скип алиаса
bot.action('shop_alias_skip', async (ctx) => {
    if (!ctx.session.temp_receipt) return ctx.reply('Сессия истекла');
    ctx.session.temp_receipt.brandName = ctx.session.temp_receipt.data.shop.name;
    ctx.session.awaiting_shop_name = false;
    await ctx.answerCbQuery('Ок, оставил как есть');
    await sendReceiptPreview(ctx);
});

// 4. Сохранение
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

        // 🔥 ИСПРАВЛЕНИЕ: Добавил слэш перед #
        // Было: *Чек #${receiptId}
        // Стало: *Чек \#${receiptId}
        await ctx.editMessageText(`✅ *Чек \\#${receiptId} сохранен\\!*`, { parse_mode: 'MarkdownV2', ...finalBtns });
        
    } catch (e) {
        console.error(e); // Логируем ошибку в консоль
        ctx.reply('Ошибка: ' + e.message);
    }
});

bot.action('receipt_save_cancel', (ctx) => {
    delete ctx.session.temp_receipt;
    ctx.session.awaiting_shop_name = false;
    ctx.editMessageText('❌ Отменено');
});

bot.action(/^receipt_del_(\d+)$/, async (ctx) => {
    const id = ctx.match[1];
    await db.dbRun('DELETE FROM receipts WHERE id = ?', [id]);
    await db.dbRun('DELETE FROM transactions WHERE receipt_id = ?', [id]);
    ctx.editMessageText('🗑 Чек и транзакции удалены.');
});

bot.action(/^receipt_show_(\d+)$/, async (ctx) => {
    const id = ctx.match[1];
    const items = await db.dbAll('SELECT * FROM transactions WHERE receipt_id = ?', [id]);
    if (!items.length) return ctx.reply('Позиции не найдены.');
    
    let msg = `🧾 **Чек #${id}**\n`;
    items.forEach((t, i) => {
        msg += `${i+1}. ${t.comment} — ${t.amount}\n`;
    });
    // Тут простой текст, Markdown не обязателен, или тоже экранируйте если хотите красоты
    ctx.reply(msg); 
    ctx.answerCbQuery();
});

module.exports = bot;
