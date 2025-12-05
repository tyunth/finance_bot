const { Markup } = require('telegraf');

function generateReplyKeyboard(categories, withBack = false) {
    const keyboard = categories.map(row => row.map(btn => Markup.button.text(btn)));
    if (withBack) keyboard.push([Markup.button.text('Назад')]);
    return Markup.keyboard(keyboard).resize();
}

async function generateAccountReplyKeyboard(db, userId, excludeAccount = null, withBack = true) {
    const accounts = await db.dbAll('SELECT name FROM accounts WHERE user_id = ?', [userId]);
    const buttons = accounts.map(a => a.name).filter(name => name !== excludeAccount);
    
    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
    
    if (withBack) rows.push(['Назад', 'Отмена']); 
    else rows.push(['Отмена']);
    
    return Markup.keyboard(rows).resize();
}

// Inline клавиатура (используется для удаления/добавления в меню Счета)
const ACCOUNTS_INLINE = Markup.inlineKeyboard([
    [Markup.button.callback('Добавить Депозит', 'btn_add_deposit')],
    [Markup.button.callback('Удалить Депозит', 'btn_del_deposit')]
]);

const BACK_KEYBOARD = Markup.keyboard([['Назад']]).resize();
const SKIP_COMMENT_KEYBOARD = Markup.keyboard([['Пропустить'], ['Назад']]).resize();
const MAIN_KEYBOARD = Markup.keyboard([
    ['Доход', 'Расход', 'Перевод'],
    ['Счета', 'Отчеты', 'Помощь']
]).resize();

module.exports = {
    generateReplyKeyboard,
    generateAccountReplyKeyboard,
    ACCOUNTS_INLINE,
    BACK_KEYBOARD,
    SKIP_COMMENT_KEYBOARD,
    MAIN_KEYBOARD
};