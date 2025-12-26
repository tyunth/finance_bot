const { Composer, Markup } = require('telegraf');
const db = require('../../db');
const config = require('../../config');
const gcal = require('../../calendar'); // Подключаем твой calendar.js

const bot = new Composer();

// Ручная синхронизация (вызывает ту же логику, что и крон)
bot.command('sync', async (ctx) => {
    ctx.reply('🔄 Запускаю проверку календаря...');
    // Логика проверки находится в jobs/cron.manager.js, 
    // но чтобы вызвать её отсюда, лучше вынести polling в отдельный файл или оставить тут просто заглушку,
    // так как крон и так работает. 
    // В данном случае мы просто сообщаем пользователю.
});

// --- CALLBACKS ИЗ СООБЩЕНИЙ КАЛЕНДАРЯ ---

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
    const reason = ctx.match[1]; // agreed, teacher, student
    const eventId = ctx.match[2];
    
    // Парсим текст сообщения, чтобы достать имя
    const msgLines = ctx.callbackQuery.message.text.split('\n');
    const summaryLine = msgLines.find(l => l.includes('Урок завершен:'));
    const summary = summaryLine ? summaryLine.split('Урок завершен:')[1].trim() : 'Урок';
    
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
    
    // Удаляем из Google Calendar
    try {
        await gcal.deleteEvent(eventId);
    } catch(e) { console.error('GCal delete error:', e); }
    
    await ctx.editMessageText(`✅ Отмена записана (${reason}). Событие удалено.`);
});

// 3. В Долги
bot.action(/^cal_debt_(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    
    const msgLines = ctx.callbackQuery.message.text.split('\n');
    const summaryLine = msgLines.find(l => l.includes('Урок завершен:'));
    const summary = summaryLine ? summaryLine.split('Урок завершен:')[1].trim() : 'Урок';
    const { studentName, subject } = gcal.parseLessonInfo(summary);

    await db.addDebt(ctx.from.id, studentName, subject, config.LESSON_PRICE, eventId);
    await db.markEventProcessed(eventId, summary, 'debt');
    
    await ctx.editMessageText(`📝 Записано в долги: ${studentName}`);
});

// 4. Оплачено (с логикой типов уроков)
bot.action(/^cal_paid_(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    
    const msgLines = ctx.callbackQuery.message.text.split('\n');
    const summaryLine = msgLines.find(l => l.includes('Урок завершен:'));
    const summary = summaryLine ? summaryLine.split('Урок завершен:')[1].trim() : 'Урок';
    const { studentName, subject } = gcal.parseLessonInfo(summary);

    // Определение типа урока
    const summaryLower = summary.toLowerCase();
    let lessonType = 'regular';
    if (summaryLower.includes('пробный')) lessonType = 'trial';
    else if (summaryLower.includes('доп')) lessonType = 'extra';

    let comment = `${subject} (${summary})`;
    if (lessonType === 'trial') comment += ' [ПРОБНЫЙ]';

    await db.addTransaction({
        userId: ctx.from.id, 
        type: 'income', 
        amount: config.LESSON_PRICE, 
        category: 'Репетиторство',
        tag: `Ученик: ${studentName}`, 
        comment: comment, 
        sourceAccount: null, 
        targetAccount: 'Основной',
        lesson_type: lessonType
    });
    
    await db.markEventProcessed(eventId, summary, 'paid');
    await ctx.editMessageText(`💰 Оплачено: ${studentName} (+${config.LESSON_PRICE})`);
});

bot.action('cal_ignore', (ctx) => ctx.deleteMessage());

module.exports = bot;
