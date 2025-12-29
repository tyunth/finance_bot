const { Composer, Markup } = require('telegraf');
const db = require('../../db');

const bot = new Composer();

// --- СПИСОК ДЕЛ ---
bot.hears(['Дела', '/todo', '📝 Дела'], async (ctx) => {
    const list = await db.getTodos(ctx.from.id);
    const active = list.filter(t => !t.is_done);
    
    if (!active.length) {
        return ctx.reply('🎉 Дел нет! Можно отдыхать.\nДобавить: /todo [Текст] [🔥/⚡/💤]');
    }

    // Группируем задачи
    const groups = {
        urgent: { title: '🔥 Срочно', items: [] },
        medium: { title: '⚡ Средне', items: [] },
        later:  { title: '💤 Не к спеху', items: [] }
    };

    active.forEach(t => {
        const p = t.period || 'urgent'; // urgent по умолчанию
        if (groups[p]) groups[p].items.push(t);
        else groups['urgent'].items.push(t); // Fallback
    });

    const buttons = [];

    // Формируем кнопки с разделителями
    ['urgent', 'medium', 'later'].forEach(key => {
        const group = groups[key];
        if (group.items.length > 0) {
            // 1. Добавляем "Заголовок" (Кнопка-пустышка)
            buttons.push([
                Markup.button.callback(`--- ${group.title} ---`, 'ignore_click')
            ]);
            
            // 2. Добавляем задачи
            group.items.forEach(t => {
                buttons.push([
                    Markup.button.callback(`▫️ ${t.text}`, `todo_done_${t.id}`)
                ]);
            });
        }
    });

    // Кнопка добавления (опционально)
    // buttons.push([Markup.button.callback('➕ Добавить задачу', 'add_todo_flow')]);

    await ctx.reply(`📝 *Список дел (${active.length}):*`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
    });
});

// Игнор нажатия на заголовок
bot.action('ignore_click', (ctx) => ctx.answerCbQuery('Это заголовок 😅'));

// Добавление: /todo Помыть кота
bot.command('todo', async (ctx) => {
    const rawText = ctx.message.text.replace('/todo', '').trim();
    if (!rawText) return ctx.reply('✍️ Напиши задачу: /todo Помыть кота');

    // Пытаемся определить срочность по смайлику в тексте
    let period = 'urgent';
    let cleanText = rawText;

    if (rawText.includes('⚡')) { period = 'medium'; cleanText = rawText.replace('⚡', ''); }
    else if (rawText.includes('💤')) { period = 'later'; cleanText = rawText.replace('💤', ''); }
    else if (rawText.includes('🔥')) { period = 'urgent'; cleanText = rawText.replace('🔥', ''); }

    cleanText = cleanText.trim();
    
    await db.addTodo(ctx.from.id, cleanText, period);
    
    const icon = { urgent: '🔥', medium: '⚡', later: '💤' }[period];
    ctx.reply(`📌 Записал в ${icon}: ${cleanText}`);
});

// Выполнение задачи
bot.action(/^todo_done_(\d+)$/, async (ctx) => {
    const id = ctx.match[1];
    await db.toggleTodo(id, 1);
    await ctx.answerCbQuery('Сделано!');
    
    // Хитрость: Чтобы обновить список, мы можем заново вызвать логику показа
    // Но для простоты пока просто удалим кнопку (или сообщение целиком, если хочешь)
    // await ctx.deleteMessage(); 
    
    // Лучший вариант: Перерисовать меню (но это сложнее, т.к. надо заново лезть в базу)
    // Давай просто напишем "Сделано" в тексте кнопки
    /*
    const newMarkup = ctx.callbackQuery.message.reply_markup;
    // ... логика поиска кнопки и замены текста на ✅ ...
    */
   
    // Простой вариант: удаляем сообщение и шлем новое (свежий список)
    await ctx.deleteMessage();
    // Можно раскомментировать, если хочешь чтобы список появлялся снова сам:
    // ctx.reply('/todo'); 
});

// --- КОРЗИНА (Оставляем как есть) ---
bot.command(['trash', 'archive'], async (ctx) => {
    // ... твой старый код корзины ...
    const items = await db.getArchivedItems(ctx.from.id);
    if (!items.length) return ctx.reply('🗑 Корзина пуста.');
    const buttons = items.map(i => [Markup.button.callback(`♻️ ${i.title.slice(0, 20)}...`, `restore_${i.type}_${i.id}`)]);
    buttons.push([Markup.button.callback('❌ Закрыть', 'delete_msg')]);
    ctx.reply('🗑 Последние удаленные:', Markup.inlineKeyboard(buttons));
});

bot.action(/^restore_(\w+)_(\d+)$/, async (ctx) => {
    const [_, type, id] = ctx.match;
    await db.restoreItem(type, id);
    await ctx.answerCbQuery('Восстановлено!');
    await ctx.deleteMessage(); 
});
bot.action('delete_msg', (ctx) => ctx.deleteMessage());

module.exports = bot;
