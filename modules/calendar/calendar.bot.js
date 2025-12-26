const { Composer, Markup } = require('telegraf');
const calendarService = require('./calendar.service'); // Подключаем сервис выше
const db = require('../../db');
const gcal = require('../../calendar');
const config = require('../../config');

const bot = new Composer();

// --- КОМАНДА SYNC ---
bot.command('sync', async (ctx) => {
    const msg = await ctx.reply('🔄 Проверяю календарь...');
    // Передаем (ctx.telegram, userId) или просто (ctx.telegram, ctx.from.id)
    // Но так как checkLessons требует экземпляр bot (у которого есть telegram),
    // мы можем передать ctx.telegram как "bot" (у него есть sendMessage), 
    // но правильнее передать сам ctx.telegram.
    
    // В Telegraf `ctx.telegram` имеет методы sendMessage, так что это сработает.
    const result = await calendarService.checkLessons(ctx, ctx.from.id);
    
    await ctx.telegram.editMessageText(
        ctx.chat.id, 
        msg.message_id, 
        null, 
        result.count > 0 ? `✅ Проверка завершена. ${result.message}` : '🔕 Новых уроков не найдено.'
    );
});

// ... (Остальной код с кнопками cal_cx_, cal_debt_ и т.д. ОСТАВЛЯЕМ КАК БЫЛ в прошлом ответе) ...
// Я продублирую его ниже, чтобы ты мог скопировать файл целиком.

// 1. Меню отмены
bot.action(/^cal_cancel_menu_(.+)$/, (ctx) => {
    const eventId = ctx.match[1];
    ctx.editMessageText('Причина отмены?', Markup.inlineKeyboard([
        [Markup.button.callback('Согласовано', `cal_cx_agreed_${eventId}`)],
        [Markup.button.callback('Я отменил', `cal_cx_teacher_${eventId}`)],
        [Markup.button.callback('Ученик отменил', `cal_cx_student_${eventId}`)],
        [Markup.button.callback('🔙 Назад', `cal_ignore`)]
    ]));
});

// 2. Фиксация отмены
bot.action(/^cal_cx_([a-z]+)_(.+)$/, async (ctx) => {
    const reason = ctx.match[1];
    const eventId = ctx.match[2];
    
    // Пытаемся достать текст из сообщения
    let summary = 'Урок';
    if (ctx.callbackQuery.message && ctx.callbackQuery.message.text) {
        const lines = ctx.callbackQuery.message.text.split('\n');
        // Ищем строку с названием
        const sumLine = lines.find(l => l.includes('Урок завершен:')); // Зависит от того, что шлет сервис
        if (sumLine) summary = sumLine.split(':')[1].trim();
        else if (lines.length > 1) summary = lines[1]; // Фолбэк на вторую строку
    }

    const { studentName } = gcal.parseLessonInfo(summary);

    await db.addLessonHistory({
        userId: ctx.from.id,
        studentId: null, 
        studentName: studentName,
        date: new Date().toISOString(),
        status: `cancelled_${reason}`,
        reason: reason,
        lostIncome: config.LESSON_PRICE
    });

    await db.markEventProcessed(eventId, summary, 'cancelled');
    try { await gcal.deleteEvent(eventId); } catch(e) {}
    
    await ctx.editMessageText(`✅ Отмена записана (${reason}). Событие удалено.`);
});

// 3. В Долги
bot.action(/^cal_debt_(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    
    // Парсинг (упрощенный)
    let summary = 'Урок';
    if (ctx.callbackQuery.message) {
        const lines = ctx.callbackQuery.message.text.split('\n');
        if (lines.length > 1) summary = lines[1];
    }
    const { studentName, subject } = gcal.parseLessonInfo(summary);

    await db.addDebt(ctx.from.id, studentName, subject, config.LESSON_PRICE, eventId);
    await db.markEventProcessed(eventId, summary, 'debt');
    await ctx.editMessageText(`📝 Записано в долги: ${studentName}`);
});

// 4. Оплачено
bot.action(/^cal_paid_(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    let summary = 'Урок';
    if (ctx.callbackQuery.message) {
        const lines = ctx.callbackQuery.message.text.split('\n');
        if (lines.length > 1) summary = lines[1];
    }
    const { studentName, subject } = gcal.parseLessonInfo(summary);

    let lessonType = 'regular';
    if (summary.toLowerCase().includes('пробный')) lessonType = 'trial';
    
    await db.addTransaction({
        userId: ctx.from.id, 
        type: 'income', 
        amount: config.LESSON_PRICE, 
        category: 'Репетиторство',
        tag: `Ученик: ${studentName}`, 
        comment: `${subject} (${summary})`, 
        sourceAccount: null, 
        targetAccount: 'Основной',
        lesson_type: lessonType
    });
    
    await db.markEventProcessed(eventId, summary, 'paid');
    await ctx.editMessageText(`💰 Оплачено: ${studentName}`);
});

bot.action('cal_ignore', (ctx) => ctx.deleteMessage());

module.exports = bot;
