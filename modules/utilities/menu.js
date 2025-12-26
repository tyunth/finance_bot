const { Markup } = require('telegraf');
const db = require('../../db');
async function getMainMenu(userId) {
    // Твоя любимая раскладка
    return Markup.keyboard([
        ['Доход', 'Расход', 'Перевод'],
        ['Счета', 'Отчеты', 'Помощь'],
        ['Список', 'Дела', 'Вишлист']
    ]).resize();
}
//async function getMainMenu(userId) {
 //   const modules = await db.getUserModules(userId);
    
    // 1. Базовые
  //  const buttons = [['📉 Расходы', '📈 Доходы']];
    
    // 2. Ученики / Календарь
   // if (modules.includes('all') || modules.includes('students')) {
  //      buttons.push(['🎓 Ученики', '📅 Расписание']);
 //   }
    
    // 3. Спорт
 //   if (modules.includes('all') || modules.includes('sport')) {
//        buttons.push(['💪 Спорт']);
 //   }
    
    // 4. Остальное
 //   buttons.push(['📊 Отчет', 'Счета']);
 //   buttons.push(['Помощь']);

 //   return Markup.keyboard(buttons).resize();
//}

module.exports = { getMainMenu };
