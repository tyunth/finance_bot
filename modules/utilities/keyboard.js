const { Markup } = require('telegraf');
const db = require('../../db');

/**
 * Хелпер: Разбивает массив кнопок на ряды по N штук
 */
function chunk(arr, size) {
    const res = [];
    for (let i = 0; i < arr.length; i += size) {
        res.push(arr.slice(i, i + size));
    }
    return res;
}

/**
 * Генерация главного меню
 * @param {number} userId
 */
async function getMainMenu(userId) {
    // 1. Получаем модули и роль пользователя
    const user = await db.getUser(userId);
    // Если юзера нет в базе (странно, но бывает), считаем что модулей нет
    const modulesStr = user ? user.modules : '';
    const modules = modulesStr ? modulesStr.split(',') : [];
    const isAdmin = user && user.role === 'admin';
    const hasAccess = (mod) => isAdmin || modules.includes('all') || modules.includes(mod);

    // 2. ФИКСИРОВАННАЯ ЧАСТЬ (Твои 9 кнопок)
    const fixedRows = [
        ['Доход', 'Расход', 'Перевод'],
        ['Счета', 'Отчеты', 'Помощь'],
        ['Список', 'Дела', 'Вишлист']
    ];

    // 3. ДИНАМИЧЕСКАЯ ЧАСТЬ
    const dynamicButtons = [];

    // Добавляем кнопки, если есть доступ к модулю
    if (hasAccess('sport'))     dynamicButtons.push('💪 Спорт');
    if (hasAccess('students'))  dynamicButtons.push('🎓 Ученики');
    if (hasAccess('calendar'))  dynamicButtons.push('📅 Календарь');
    if (hasAccess('utilities')) dynamicButtons.push('💡 Быт');
    if (hasAccess('all')) dynamicButtons.push('📦 Посылки');
    // Админская кнопка
    if (isAdmin) dynamicButtons.push('⚙️ Админка');

    // Разбиваем динамические кнопки по 2 или 3 в ряд (как тебе красивее)
    // Сейчас поставил по 2, чтобы их было удобно нажимать
    const dynamicRows = chunk(dynamicButtons, 2); 

    // 4. Склеиваем всё вместе
    return Markup.keyboard([
        ...fixedRows,
        ...dynamicRows
    ]).resize();
}

module.exports = { getMainMenu };
