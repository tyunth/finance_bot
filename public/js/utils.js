export const CURRENCY = 'T';

export function formatCurrency(amount) {
    if (!amount && amount !== 0) return '0 ' + CURRENCY;
    return new Intl.NumberFormat('ru-RU').format(Math.round(amount)) + ' ' + CURRENCY;
}

export function formatPeriod(p) {
    if (p === 'urgent' || p === 'today') return 'Срочно';
    if (p === 'medium') return 'Средне';
    return 'Не к спеху';
}

// Получаем дату YYYY-MM-DD без сдвига поясов
export function formatDateISO(dateObj) {
    const offset = dateObj.getTimezoneOffset() * 60000;
    return new Date(dateObj.getTime() - offset).toISOString().split('T')[0];
}

// Безопасное создание HTML (чтобы не писать длинные строки в app.js)
// В данном примере мы оставим строковые шаблоны для простоты чтения, 
// но вынесем форматирование сюда, если потребуется.
