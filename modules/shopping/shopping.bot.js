const { Composer, Markup } = require('telegraf');
const db = require('../../db');

const bot = new Composer();

// --- УТИЛИТА: Рендер списка ---
async function renderList(ctx, type, edit = false) {
    const list = await db.getShoppingList(ctx.from.id);
    // Фильтруем: тип совпадает И не куплено
    const items = list.filter(i => i.type === type && !i.is_bought);

    const titles = { buy: '🛒 Список покупок', wish: '🎁 Вишлист', market: '📦 Маркетплейс' };
    const emptyText = items.length ? '' : '_Список пуст_';
    
    let msg = `*${titles[type] || 'Список'}:*\n${emptyText}\n`;
    const buttons = [];

    items.forEach(i => {
        msg += `• ${i.title}\n`;
        // Кнопка: ✅ Куплено (или удалить)
        buttons.push([Markup.button.callback(`✅ ${i.title}`, `shop_done_${i.id}_${type}`)]);
    });

    // Управление
    const controls = [
        Markup.button.callback('➕ Добавить', `shop_add_${type}`),
        Markup.button.callback('🔄 Обновить', `shop_refresh_${type}`)
    ];
    buttons.push(controls);

    const keyboard = Markup.inlineKeyboard(buttons);
    
    if (edit) {
        try { await ctx.editMessageText(msg, { parse_mode: 'Markdown', ...keyboard }); } catch (e) {}
    } else {
        await ctx.replyWithMarkdown(msg, keyboard);
    }
}

// --- КОМАНДЫ ---
bot.command('list', (ctx) => renderList(ctx, 'buy'));
bot.command('wishlist', (ctx) => renderList(ctx, 'wish'));
bot.hears('Список', (ctx) => renderList(ctx, 'buy'));

// Быстрое добавление: /buy Молоко
bot.command('buy', async (ctx) => {
    const text = ctx.message.text.replace('/buy', '').trim();
    if (!text) return ctx.reply('Пример: /buy Молоко');
    await db.addShoppingItem(ctx.from.id, { title: text, type: 'buy' });
    ctx.reply(`🛒 Добавлено: ${text}`);
});

bot.command(['wb', 'ozon', 'market'], async (ctx) => {
    const text = ctx.message.text.replace(/^\/\w+\s*/, '').trim();
    if (!text) return ctx.reply('Пример: /wb Наушники');
    await db.addShoppingItem(ctx.from.id, { title: text, type: 'market' });
    ctx.reply(`📦 Добавлено в маркетплейс: ${text}`);
});

// --- ACTIONS (Кнопки) ---

// 1. Обновить
bot.action(/^shop_refresh_(.+)$/, (ctx) => renderList(ctx, ctx.match[1], true));

// 2. Куплено (Удалить из списка)
bot.action(/^shop_done_(\d+)_(.+)$/, async (ctx) => {
    const [_, id, type] = ctx.match;
    await db.updateShoppingStatus(id, 1); // 1 = bought
    await ctx.answerCbQuery('Куплено!');
    renderList(ctx, type, true);
});

// 3. Добавить (через кнопку)
bot.action(/^shop_add_(.+)$/, (ctx) => {
    const type = ctx.match[1];
    ctx.session.state = { type: 'shopping', shoppingType: type, step: 'ITEM_NAME' };
    ctx.reply('✍️ Что добавить в этот список?', Markup.inlineKeyboard([
        [Markup.button.callback('❌ Отмена', 'cancel_op')]
    ]));
});

// --- ОБРАБОТКА ТЕКСТА (Ввод названия) ---
bot.on('text', async (ctx, next) => {
    const state = ctx.session.state || {};
    if (state.type === 'shopping' && state.step === 'ITEM_NAME') {
        const text = ctx.message.text;
        await db.addShoppingItem(ctx.from.id, { title: text, type: state.shoppingType });
        
        ctx.reply(`✅ Добавлено: ${text}`);
        // Показываем обновленный список
        await renderList(ctx, state.shoppingType);
        
        ctx.session.state = {}; // Сброс
        return;
    }
    return next();
});

module.exports = bot;
