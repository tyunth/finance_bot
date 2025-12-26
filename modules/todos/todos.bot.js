const { Composer, Markup } = require('telegraf');
const db = require('../../db');

const bot = new Composer();

// --- СПИСОК ДЕЛ ---
bot.hears(['Дела', '/todo'], async (ctx) => {
    const list = await db.getTodos(ctx.from.id);
    const active = list.filter(t => !t.is_done);
    
    if (!active.length) {
        return ctx.reply('🎉 Дел нет! Можно отдыхать.\nДобавить: /todo Текст');
    }

    let msg = `📝 *Список дел (${active.length}):*\n`;
    const buttons = active.map(t => [
        Markup.button.callback(`✅ ${t.text}`, `todo_done_${t.id}`)
    ]);

    ctx.replyWithMarkdown(msg, Markup.inlineKeyboard(buttons));
});

// Добавление: /todo Помыть кота
bot.command('todo', async (ctx) => {
    const text = ctx.message.text.replace('/todo', '').trim();
    if (!text) return ctx.reply('✍️ Напиши задачу: /todo Помыть кота');
    
    await db.addTodo(ctx.from.id, text);
    ctx.reply(`📌 Записал: ${text}`);
});

// Выполнение задачи
bot.action(/^todo_done_(\d+)$/, async (ctx) => {
    const id = ctx.match[1];
    await db.toggleTodo(id, 1);
    await ctx.answerCbQuery('Сделано!');
    await ctx.deleteMessage(); // Просто удаляем кнопку из чата
});

// --- КОРЗИНА (Trash) ---
bot.command(['trash', 'archive'], async (ctx) => {
    const items = await db.getArchivedItems(ctx.from.id);
    if (!items.length) return ctx.reply('🗑 Корзина пуста.');

    const buttons = items.map(i => [
        Markup.button.callback(`♻️ ${i.title.slice(0, 20)}...`, `restore_${i.type}_${i.id}`)
    ]);
    
    buttons.push([Markup.button.callback('❌ Закрыть', 'delete_msg')]);
    ctx.reply('🗑 Последние удаленные:', Markup.inlineKeyboard(buttons));
});

// Восстановление
bot.action(/^restore_(\w+)_(\d+)$/, async (ctx) => {
    const [_, type, id] = ctx.match;
    await db.restoreItem(type, id);
    await ctx.answerCbQuery('Восстановлено!');
    // Можно обновить сообщение, но проще просто удалить строку
    await ctx.deleteMessage(); 
});

// Утилита: удалить сообщение
bot.action('delete_msg', (ctx) => ctx.deleteMessage());
bot.action('cancel_op', (ctx) => {
    ctx.session.state = {};
    ctx.editMessageText('❌ Отменено');
});

module.exports = bot;
