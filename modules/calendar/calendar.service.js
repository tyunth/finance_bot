const db = require('../../db');
const config = require('../../config');
const gcal = require('./calendar.driver'); // 🔥 Подключаем локальный драйвер
const { Markup } = require('telegraf');

async function checkLessons(bot, userId) {
    if (!userId) userId = config.ADMIN_ID;
    const log = (msg) => console.log(`[Calendar] ${msg}`);

    try {
        const events = await gcal.getRecentLessons(log);
        if (!events || events.length === 0) return { count: 0, message: 'Событий нет' };

        const students = await db.getStudents(userId);
        const studentNames = students.map(s => s.name);
        const keywords = [...studentNames, 'Тест', 'Пробный', 'Урок', 'Занятие'];

        let foundCount = 0;

        for (const event of events) {
            const processed = await db.isEventProcessed(event.id);
            if (processed) continue;

            const summary = event.summary;
            const isRelevant = keywords.some(key => summary.toLowerCase().includes(key.toLowerCase()));
            if (!isRelevant) continue;

            const { studentName, subject } = gcal.parseLessonInfo(summary);
            // Находим ученика и берем его индивидуальную цену
            const student = students.find(s => s.name === studentName);
            const amount = student ? (student.price || 4000) : 4000;

            await bot.telegram.sendMessage(userId,
                `🔔 *Урок завершен:*\n${summary}\n👤 ${studentName}\n📚 ${subject}`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [
                        [{ text: `💰 Оплачен (+${amount})`, callback_data: `cal_paid_${event.id}` }],
                        [{ text: `📝 В долг`, callback_data: `cal_debt_${event.id}` }],
                        [{ text: `❌ Отмена/Удалить`, callback_data: `cal_cancel_menu_${event.id}` }]
                    ]}
                }
            );

            await db.markEventProcessed(event.id, summary, 'pending');
            foundCount++;
        }

        return { count: foundCount, message: `Найдено новых: ${foundCount}` };

    } catch (e) {
        console.error('Calendar Service Error:', e);
        return { count: 0, message: 'Ошибка: ' + e.message };
    }
}

// --- НОВЫЕ МЕТОДЫ (Переехали из бота) ---

async function processPayment(userId, eventId, summary) {
    const { studentName, subject } = gcal.parseLessonInfo(summary);
    let lessonType = 'regular';
    if (summary.toLowerCase().includes('пробный')) lessonType = 'trial';

    // Находим ученика и берем его индивидуальную цену
    const students = await db.getStudents(userId);
    const student = students.find(s => s.name === studentName);
    const amount = student ? (student.price || 4000) : 4000;

    await db.addTransaction({
        userId,
        type: 'income',
        amount: amount,
        category: 'Репетиторство',
        tag: `Ученик: ${studentName}`,
        comment: subject,
        sourceAccount: null,
        targetAccount: 'Основной',
        lesson_type: lessonType
    });

    await db.markEventProcessed(eventId, summary, 'paid');
    return studentName;
}

async function processDebt(userId, eventId, summary) {
    const { studentName, subject } = gcal.parseLessonInfo(summary);
    // Находим ученика и берем его индивидуальную цену
    const students = await db.getStudents(userId);
    const student = students.find(s => s.name === studentName);
    const amount = student ? (student.price || 4000) : 4000;
    await db.addDebt(userId, studentName, subject, amount, eventId);
    await db.markEventProcessed(eventId, summary, 'debt');
    return studentName;
}

async function processCancellation(userId, eventId, summary, reason) {
    const { studentName } = gcal.parseLessonInfo(summary);

    // Находим ученика и берем его индивидуальную цену
    const students = await db.getStudents(userId);
    const student = students.find(s => s.name === studentName);
    const amount = student ? (student.price || 4000) : 4000;

    await db.addLessonHistory({
        userId,
        studentId: null,
        studentName: studentName,
        date: new Date().toISOString(),
        status: `cancelled_${reason}`,
        reason: reason,
        lostIncome: amount
    });

    await db.markEventProcessed(eventId, summary, 'cancelled');
    try { await gcal.deleteEvent(eventId); } catch(e) {}

    return studentName;
}

async function checkPracticeAndAsk(bot, userId) {
    try {
        const events = await gcal.getEventsForDate(new Date());
        const hasPractice = events.some(event => event.summary && event.summary.toLowerCase().includes('практика'));

        if (hasPractice) {
            await bot.telegram.sendMessage(userId, 'Как добирался?', {
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.callback('автобус +200тг', 'practice_bus')],
                    [Markup.button.callback('другое', 'practice_other')]
                ])
            });
        }
    } catch (e) {
        console.error('Error in checkPracticeAndAsk:', e);
    }
}

module.exports = {
    checkLessons,
    processPayment,
    processDebt,
    processCancellation,
    checkPracticeAndAsk
};
