require('dotenv').config();
const { google } = require('googleapis');
const path = require('path');
const config = require('../../config'); // 🔥 Путь вверх

// 🔥 Путь к ключу теперь на 2 уровня выше
const KEY_FILE = path.resolve(__dirname, '../../google_key.json');

let auth;
try {
    auth = new google.auth.GoogleAuth({
        keyFile: KEY_FILE,
        scopes: ['https://www.googleapis.com/auth/calendar'],
    });
} catch (e) {
    console.error("Ошибка инициализации Google Auth:", e.message);
}

const calendar = google.calendar({ version: 'v3', auth });

/**
 * Получает события календаря
 */
async function getRecentLessons(logCallback = console.log) {
    if (!auth) {
        logCallback('Ошибка: Google Auth не настроен.');
        return [];
    }

    const now = new Date();
    const timeMin = new Date(now);
    timeMin.setHours(0, 0, 0, 0);
    const timeMax = now.toISOString();

    try {
        logCallback(`Запрос к календарю...`);
        
        const response = await calendar.events.list({
            calendarId: config.CALENDAR_ID,
            timeMin: timeMin.toISOString(),
            timeMax: timeMax,
            singleEvents: true,
            orderBy: 'startTime',
        });

        const events = response.data.items || [];
        logCallback(`Найдено событий всего: ${events.length}`);
        
        // Фильтрация
        const relevantEvents = events.filter(event => {
            const summary = event.summary || '';
            const isRelevant = config.KEYWORDS.some(kw => summary.toLowerCase().includes(kw.toLowerCase()));
            if (!isRelevant) return false;
            
            const end = new Date(event.end.dateTime || event.end.date);
            const diffMinutes = (now - end) / (1000 * 60);
            
            // Если урок закончился менее 30 минут назад (или еще идет) - не трогаем
            // (Логика из старого файла)
            if (diffMinutes < 30) {
                 return false;
            }
            return true;
        });

        return relevantEvents;

    } catch (error) {
        logCallback(`Ошибка Google Calendar API: ${error.message}`);
        return [];
    }
}

async function deleteEvent(eventId) {
    try {
        await calendar.events.delete({
            calendarId: config.CALENDAR_ID,
            eventId: eventId
        });
        return true;
    } catch (err) {
        console.error('Error deleting event:', err);
        return false;
    }
}

function parseLessonInfo(summary) {
    const parts = summary.split(' ');
    const studentName = parts[0]; 
    let subject = 'Математика';
    if (summary.toLowerCase().includes('го')) subject = 'Го';
    return { studentName, subject };
}

async function getEventsForDate(dateObj) {
    try {
        const start = new Date(dateObj);
        start.setHours(0, 0, 0, 0);
        const end = new Date(dateObj);
        end.setHours(23, 59, 59, 999);

        const res = await calendar.events.list({
            calendarId: config.CALENDAR_ID,
            timeMin: start.toISOString(),
            timeMax: end.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });
        return res.data.items || [];
    } catch (error) {
        return [];
    }
}

module.exports = {
    getRecentLessons,
    deleteEvent,
    parseLessonInfo,
    getEventsForDate
};
