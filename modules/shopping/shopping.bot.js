const { Composer, Markup } = require('telegraf');
const db = require('../../db');
const config = require('../../config');

const bot = new Composer();

// --- УТИЛИТА: Рендер списка ---
async function renderList(ctx, type) {
    const list = await db.getShoppingList(ctx.from.id);
    
    // Фильтруем: тип совпадает И не куплено
    const items = list.filter(i => i.type === type && !i.is_bought);

    // Проверяем режим управления (храним в сессии)
    const isManageMode = ctx.session.manageMode === true;

    // Заголовки
    const titles = { 
        buy: '🛒 *Список покупок:*', 
        wish: '🎁 *Вишлист:*', 
        market: '📦 *Маркетплейс:*' 
    };
    
    let msg = (titles[type] || 'Список:') + '\n\n';
    const buttons = [];

    if (items.length === 0) {
        msg += '_Список пуст_';
    } else {
        items.forEach(i => {
            // Форматируем строку товара
            const price = i.price_estimate ? ` (~${i.price_estimate})` : '';
            msg += `• ${i.title}${price}\n`;
            
            if (isManageMode) {
                // РЕЖИМ УПРАВЛЕНИЯ: Кнопки Удалить и Изменить
                buttons.push([
                    Markup.button.callback(`✏️ ${i.title}`, `shop_edit_${i.id}_${type}`),
                    Markup.button.callback(`❌ Удалить`, `shop_del_${i.id}_${type}`)
                ]);
            } else {
                // ОБЫЧНЫЙ РЕЖИМ: Кнопка "Куплено" (Галочка)
                buttons.push([
                    Markup.button.callback(`✅ ${i.title}`, `shop_done_${i.id}_${type}`)
                ]);
            }
        });
    }

    // --- НИЖНЯЯ ПАНЕЛЬ УПРАВЛЕНИЯ ---
    const controls = [];
    
    // Кнопка добавления (только в обычном режиме, чтобы не перегружать)
    if (!isManageMode) {
        controls.push(Markup.button.callback('➕ Добавить', `shop_add_${type}`));
    }
    
    // Переключатель режима
    const modeBtnText = isManageMode ? '⬅️ Готово' : '⚙️ Ред/Удал';
    controls.push(Markup.button.callback(modeBtnText, `shop_mode_${type}`));
    
    // Обновить
    controls.push(Markup.button.callback('🔄', `shop_refresh_${type}`));
    
    buttons.push(controls);

    // Отправляем или редактируем сообщение
    const keyboard = Markup.inlineKeyboard(buttons);
    if (ctx.callbackQuery) {
        try { await ctx.editMessageText(msg, { parse_mode: 'Markdown', ...keyboard }); } catch (e) {}
    } else {
        await ctx.replyWithMarkdown(msg, keyboard);
    }
}

// --- КОМАНДЫ (МЕНЮ) ---
bot.command('list', (ctx) => renderList(ctx, 'buy'));
bot.command('wishlist', (ctx) => renderList(ctx, 'wish'));
bot.hears(['Список', 'Покупки'], (ctx) => renderList(ctx, 'buy'));
bot.hears(['Вишлист', 'Хотелки'], (ctx) => renderList(ctx, 'wish'));

// --- БЫСТРЫЕ КОМАНДЫ (/buy Хлеб) ---
bot.command('buy', async (ctx) => handleQuickAdd(ctx, 'buy', '🛒'));
bot.command('wish', async (ctx) => handleQuickAdd(ctx, 'wish', '🎁'));
bot.command(['wb', 'ozon', 'market'], async (ctx) => handleQuickAdd(ctx, 'market', '📦'));

async function handleQuickAdd(ctx, type, icon) {
    // Удаляем команду из текста (/buy Хлеб -> Хлеб)
    const text = ctx.message.text.replace(/^\/\w+\s*/, '').trim();
    if (!text) return ctx.reply(`Пример: ${ctx.message.text.split(' ')[0]} Название товара`);
    
    await db.addShoppingItem(ctx.from.id, { title: text, type: type });
    ctx.reply(`${icon} Добавлено: ${text}`);
}

// --- CALLBACKS (КНОПКИ) ---

bot.action(/^shop_/, async (ctx) => {
    const parts = ctx.match.input.split('_'); // shop_action_id_type
    const action = parts[1];
    
    // 1. ПЕРЕКЛЮЧЕНИЕ РЕЖИМА (mode)
    if (action === 'mode') {
        const type = parts[2];
        ctx.session.manageMode = !ctx.session.manageMode; // Инвертируем true/false
        return renderList(ctx, type);
    }

    // 2. ОБНОВИТЬ (refresh)
    if (action === 'refresh') {
        const type = parts[2];
        return renderList(ctx, type);
    }

    // 3. ДОБАВИТЬ ЧЕРЕЗ КНОПКУ (add)
    if (action === 'add') {
        const type = parts[2];
        ctx.session.state = { step: 'AWAITING_SHOPPING_ITEM', shoppingType: type };
        return ctx.reply('✍️ Что добавить в список?', Markup.inlineKeyboard([
            [Markup.button.callback('❌ Отмена', 'shop_cancel')]
        ]));
    }

    // 4. КУПЛЕНО (done)
    if (action === 'done') {
        const id = parts[2];
        const type = parts[3];
        await db.updateShoppingStatus(id, 1); // 1 = bought
        await ctx.answerCbQuery('Куплено!');
        return renderList(ctx, type);
    }

    // 5. УДАЛИТЬ (del)
    if (action === 'del') {
        const id = parts[2];
        const type = parts[3];
        await db.deleteShoppingItem(id);
        await ctx.answerCbQuery('Удалено');
        return renderList(ctx, type);
    }

    // 6. РЕДАКТИРОВАТЬ (edit)
    if (action === 'edit') {
        const id = parts[2];
        const type = parts[3];
        ctx.session.state = { 
            step: 'AWAITING_SHOPPING_EDIT', 
            id: id, 
            type: type 
        };
        return ctx.reply('Введите новое название:', Markup.inlineKeyboard([
            [Markup.button.callback('❌ Отмена', 'shop_cancel')]
        ]));
    }
    
    // 7. ОТМЕНА ДЕЙСТВИЯ
    if (action === 'cancel') {
        ctx.session.state = {};
        return ctx.editMessageText('❌ Отменено');
    }
});

// --- ОБРАБОТКА ТЕКСТА (ВВОД НАЗВАНИЯ) ---
bot.on('text', async (ctx, next) => {
    const state = ctx.session.state || {};
    
    // 1. Добавление
    if (state.step === 'AWAITING_SHOPPING_ITEM') {
        const text = ctx.message.text;
        await db.addShoppingItem(ctx.from.id, { title: text, type: state.shoppingType });
        await ctx.reply(`✅ Добавлено: ${text}`);
        await renderList(ctx, state.shoppingType);
        ctx.session.state = {};
        return;
    }

    // 2. Редактирование
    if (state.step === 'AWAITING_SHOPPING_EDIT') {
        const text = ctx.message.text;
        // Используем прямой SQL, так как в db.js может не быть updateShoppingTitle
        await db.dbRun('UPDATE shopping_list SET item_name = ? WHERE id = ?', [text, state.id]);
        await ctx.reply(`✅ Обновлено: ${text}`);
        await renderList(ctx, state.type);
        ctx.session.state = {};
        return;
    }

    return next();
});

module.exports = bot;
