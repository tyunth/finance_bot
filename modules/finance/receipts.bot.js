const { Composer, Markup } = require('telegraf');
const axios = require('axios');
const ai = require('./finance.ai'); 
const db = require('../../db');

const bot = new Composer();

// Вспомогательная функция: Показываем итоговый чек
// Вынесли её отдельно, чтобы вызывать и сразу (если магазин знаком), 
// и потом (когда пользователь введет название)
async function sendReceiptPreview(ctx) {
    const temp = ctx.session.temp_receipt;
    if (!temp) return ctx.reply('⚠️ Ошибка сессии. Попробуйте снова.');

    const data = temp.data;
    
    // Пытаемся найти красивое имя, если мы его уже определили в сессии
    // или используем сырое имя
    const displayName = temp.brandName || data.shop.name;

    const diff = Math.abs(data.meta.total_receipt - data.meta.total_calculated);
    const statusIcon = diff < 5 ? '✅' : '⚠️';
    
    let preview = `🧾 *Предпросмотр чека*\n🏪 ${displayName}\n`;
    // Если имя изменено, покажем оригинальное в скобках
    if (temp.brandName && temp.brandName !== data.shop.name) {
        preview += `_(по чеку: ${data.shop.name})_\n`;
    }
    
    preview += `📅 ${data.date}\n`;
    preview += `💰 Итого: *${data.meta.total_receipt}*\n🧮 Расчет: *${data.meta.total_calculated}* ${statusIcon}\n\n`;
    
    data.items.forEach((item, i) => {
        preview += `${i+1}. ${item.name} — ${item.sum}\n   └ _${item.category}_\n`;
    });

    preview += `\n_Записать эти данные в базу?_`;

    const buttons = Markup.inlineKeyboard([
        [Markup.button.callback('💾 Записать в БД', 'receipt_save_confirm')],
        [Markup.button.callback('❌ Отмена', 'receipt_save_cancel')]
    ]);

    // Если сообщение уже было (мы его редактируем)
    if (ctx.callbackQuery) {
        await ctx.editMessageText(preview, { parse_mode: 'Markdown', ...buttons });
    } else {
        await ctx.replyWithMarkdown(preview, buttons);
    }
}

// 1. Обработка ФОТО
bot.on('photo', async (ctx) => {
    try {
        const msg = await ctx.reply('👀 Смотрю на чек...');
        
        // Скачиваем
        const photo = ctx.message.photo.pop();
        const fileLink = await ctx.telegram.getFileLink(photo.file_id);
        const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);

        // Категории
        const userCategories = await db.getUserCategories(ctx.from.id, 'expense');

        // AI Анализ
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, '🧠 Анализирую товары...');
        const data = await ai.parseReceipt(buffer, userCategories);

        if (!data) return ctx.editMessageText('❌ ИИ не смог прочитать чек.');

        // Сохраняем во временную сессию
        ctx.session.temp_receipt = { data: data, photo_file_id: photo.file_id };
        await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id);

        // 🔥 ЭТАП ПРОВЕРКИ МАГАЗИНА 🔥
        const rawName = data.shop.name; // Например "ТОО Ритейл Норд"
        
        // Ищем в базе алиасов
        // ВНИМАНИЕ: Использую dbGet, предполагая, что он у вас есть (вы использовали dbRun/dbAll)
        // Если dbGet нет, замените на db.get или реализацию через dbAll[0]
        const aliasRow = await db.dbGet('SELECT brand_name FROM shop_aliases WHERE raw_name = ? AND user_id = ?', [rawName, ctx.from.id]);

        if (aliasRow) {
            // Ура, мы знаем этот магазин!
            ctx.session.temp_receipt.brandName = aliasRow.brand_name;
            await sendReceiptPreview(ctx);
        } else {
            // 🤷‍♂️ Магазин незнакомый. Спрашиваем юзера.
            ctx.session.awaiting_shop_name = true; // Ставим "флажок" ожидания
            
            await ctx.reply(
                `🧐 Я впервые вижу магазин: *"${rawName}"*\n\nКак называть его в отчетах? (Например: *Магнум*)\n\n_Напиши название или нажми кнопку, чтобы оставить как есть._`,
                {
                    parse_mode: 'Markdown',
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

// 2. Обработка ТЕКСТА (когда юзер пишет название магазина)
bot.on('text', async (ctx, next) => {
    // Если мы НЕ ждем названия магазина, пропускаем к другим модулям (next)
    if (!ctx.session.awaiting_shop_name) return next();

    const newBrandName = ctx.message.text;
    const rawName = ctx.session.temp_receipt.data.shop.name;

    try {
        // Сохраняем в базу знаний
        await db.dbRun(
            `INSERT OR REPLACE INTO shop_aliases (user_id, raw_name, brand_name) VALUES (?, ?, ?)`,
            [ctx.from.id, rawName, newBrandName]
        );

        ctx.reply(`👌 Запомнил: ${rawName} = ${newBrandName}`);
        
        // Обновляем сессию и показываем чек
        ctx.session.temp_receipt.brandName = newBrandName;
        ctx.session.awaiting_shop_name = false; // Снимаем флажок
        
        await sendReceiptPreview(ctx);

    } catch (e) {
        ctx.reply('Ошибка сохранения алиаса: ' + e.message);
    }
});

// 3. Если нажали "Оставить оригинальное"
bot.action('shop_alias_skip', async (ctx) => {
    if (!ctx.session.temp_receipt) return ctx.reply('Сессия истекла');
    
    // Просто копируем сырое имя в отображаемое
    ctx.session.temp_receipt.brandName = ctx.session.temp_receipt.data.shop.name;
    ctx.session.awaiting_shop_name = false;
    
    await ctx.answerCbQuery('Ок, оставил как есть');
    await sendReceiptPreview(ctx);
});


// 4. Стандартные действия (Сохранить / Отмена)

bot.action('receipt_save_confirm', async (ctx) => {
    const temp = ctx.session.temp_receipt;
    if (!temp) return ctx.editMessageText('⚠️ Данные устарели.');
    
    try {
        // ВАЖНО: Мы сохраняем в таблицу receipts ОРИГИНАЛЬНОЕ название (temp.data),
        // а красивое имя подтянется само через SQL VIEW (аналитику), которую мы настроили ранее.
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
    ctx.session.awaiting_shop_name = false; // На всякий случай сбрасываем
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
    
    ctx.replyWithMarkdown(msg);
    ctx.answerCbQuery();
});

module.exports = bot;
