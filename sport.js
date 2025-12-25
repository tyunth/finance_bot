const { Markup } = require('telegraf');
const db = require('./db'); // Нам понадобятся методы работы с БД (добавим их ниже)
const ai = require('./ai');

// --- ГЛАВНОЕ МЕНЮ СПОРТА ---
async function renderMainMenu(ctx) {
    const userId = ctx.from.id;
    
    // 1. Ищем активный план
    const planRow = await db.dbGet('SELECT * FROM sport_plans WHERE user_id = ? AND is_active = 1', [userId]);
    
    if (!planRow) {
        return ctx.reply('🏋️‍♂️ План тренировок не найден.\n\nПерешли мне сообщение от тренера (или текст плана), и я создам его.');
    }

    const plan = JSON.parse(planRow.plan_data);
    const today = new Date().toISOString().split('T')[0];
    
    // 2. Загружаем прогресс за сегодня
    const logs = await db.dbAll('SELECT * FROM sport_logs WHERE user_id = ? AND date = ?', [userId, today]);
    
    let msg = `💪 **${plan.title}**\n📅 ${today}\n\n`;
    const buttons = [];

    // 3. Рисуем блоки
    plan.blocks.forEach((block, bIndex) => {
        msg += `🔹 *${block.name}*\n`;
        
        block.items.forEach((item, iIndex) => {
            // Ищем лог для этого упражнения
            const log = logs.find(l => l.exercise_name === item.name);
            const current = log ? (item.type === 'count' ? log.count : log.is_done) : 0;
            const isDone = current >= item.target;
            const statusIcon = isDone ? '✅' : '⬜';

            if (item.type === 'check') {
                msg += `${statusIcon} ${item.name}\n`;
                if (!isDone) {
                    // Кнопка "Сделано"
                    buttons.push([Markup.button.callback(`✅ ${item.name}`, `sport_do_${item.name}`)]);
                }
            } else {
                // Счетчик
                msg += `${statusIcon} ${item.name}: **${current}** / ${item.target}\n`;
                if (!isDone) {
                    // Кнопки добавления: +1, +5 (если шаг большой)
                    const step = item.step || 1;
                    const btns = [];
                    btns.push(Markup.button.callback(`+${step}`, `sport_add_${item.name}_${step}`));
                    // Если цель большая (например 50), добавим кнопку побольше
                    if (item.target >= 20 && step < 5) {
                        btns.push(Markup.button.callback(`+5`, `sport_add_${item.name}_5`));
                    }
                    buttons.push(btns);
                }
            }
        });
        msg += '\n';
    });

    buttons.push([Markup.button.callback('🔄 Обновить', 'sport_refresh')]);
    buttons.push([Markup.button.callback('⚙️ Загрузить новый план', 'sport_new')]);

    try {
        if (ctx.callbackQuery) {
            await ctx.editMessageText(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
        } else {
            await ctx.replyWithMarkdown(msg, Markup.inlineKeyboard(buttons));
        }
    } catch (e) {}
}

// --- ОБРАБОТКА ДЕЙСТВИЙ ---
async function handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id;
    const today = new Date().toISOString().split('T')[0];

    // 1. СДЕЛАТЬ (Чек-лист)
    if (data.startsWith('sport_do_')) {
        const name = data.replace('sport_do_', '');
        await db.dbRun(
            `INSERT INTO sport_logs (user_id, exercise_name, date, is_done, count) 
             VALUES (?, ?, ?, 1, 1)
             ON CONFLICT(id) DO UPDATE SET is_done = 1`, 
            [userId, name, today]
        );
        // SQLite не поддерживает ON CONFLICT для не-PK без индекса, поэтому упростим:
        // Просто вставим. При рендере мы берем сумму или max.
        // А лучше просто делать UPDATE или INSERT. 
        // Для простоты сейчас: просто INSERT. А при чтении будем суммировать (для count) или искать (для check).
    }

    // 2. ДОБАВИТЬ (Счетчик)
    if (data.startsWith('sport_add_')) {
        const parts = data.split('_');
        const count = parseInt(parts.pop()); // Последний элемент - число
        const name = parts.slice(2).join('_'); // Имя может содержать подчеркивания

        // Проверяем, есть ли уже запись за сегодня
        const existing = await db.dbGet('SELECT id, count FROM sport_logs WHERE user_id = ? AND date = ? AND exercise_name = ?', [userId, today, name]);
        
        if (existing) {
            await db.dbRun('UPDATE sport_logs SET count = count + ? WHERE id = ?', [count, existing.id]);
        } else {
            await db.dbRun('INSERT INTO sport_logs (user_id, exercise_name, date, count, is_done) VALUES (?, ?, ?, ?, 0)', [userId, name, today, count]);
        }
    }

    if (data === 'sport_new') {
        await ctx.reply('Отправь мне текст нового плана (или перешли сообщение).');
        // Тут нужно выставить состояние сессии, но пока сделаем просто авто-определение текста
        ctx.session.state = { step: 'AWAITING_SPORT_PLAN' };
        return ctx.answerCbQuery();
    }

    // Обновляем меню
    await renderMainMenu(ctx);
    await ctx.answerCbQuery();
}

// --- ЗАГРУЗКА ПЛАНА ---
async function handlePlanUpload(ctx) {
    const text = ctx.message.text;
    const msg = await ctx.reply('🧠 Читаю план...');
    
    const json = await ai.parseSportPlan(text);
    
    if (!json) {
        return ctx.editMessageText('❌ Не смог разобрать план. Попробуй еще раз или проверь формат.');
    }

    // Деактивируем старые
    await db.dbRun('UPDATE sport_plans SET is_active = 0 WHERE user_id = ?', [ctx.from.id]);
    
    // Сохраняем новый
    await db.dbRun(
        'INSERT INTO sport_plans (user_id, title, plan_data, created_at) VALUES (?, ?, ?, ?)',
        [ctx.from.id, json.title, JSON.stringify(json), new Date().toISOString()]
    );

    await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id);
    await ctx.reply(`✅ План "${json.title}" загружен!`);
    
    // Сразу показываем
    ctx.session.state = {};
    return renderMainMenu(ctx);
}

module.exports = {
    renderMainMenu,
    handleCallback,
    handlePlanUpload
};
