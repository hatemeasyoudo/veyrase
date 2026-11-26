const $ = selector => document.querySelector(selector);
const tabs = [...document.querySelectorAll('[data-tab]')];
const notice = $('#notice');
const number = new Intl.NumberFormat('ru');
const percent = new Intl.NumberFormat('ru', { style: 'percent', maximumFractionDigits: 1 });
const date = new Intl.DateTimeFormat('ru', { dateStyle: 'short', timeStyle: 'short' });
const labels = {
  pending: 'Ожидает оплаты', paid: 'Оплачено', shipped: 'Отправлено', cancelled: 'Отменено',
  new: 'Новая', reviewing: 'На рассмотрении', approved: 'Одобрена', declined: 'Отклонена'
};
const transitions = {
  orders: { pending: ['paid', 'cancelled'], paid: ['shipped'] },
  returns: { new: ['reviewing', 'approved', 'declined'], reviewing: ['approved', 'declined'] }
};
let tab = 'statistics';
let offset = 0;
let requestSequence = 0;

async function api(path, options) {
  const response = await fetch('/api/admin/' + path, { cache: 'no-store', ...options });
  const result = await response.json().catch(() => ({}));
  if (result.error === 'This Revolut transaction is already linked to another order.') {
    throw new Error('Этот перевод Revolut уже привязан к другому заказу.');
  }
  if (!response.ok) throw new Error(response.status === 401 ? 'Войдите снова, обновив страницу.' : (path === 'pricing' && result.error ? result.error : 'Не удалось выполнить действие. Обновите страницу и попробуйте ещё раз.'));
  return result;
}

function make(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function cell(row, value, detail, className) {
  const node = make('td', value, className);
  if (detail) node.append(make('small', detail));
  row.append(node);
  return node;
}

function empty(tbody, count, text) {
  if (tbody.children.length) return;
  const row = make('tr');
  cell(row, text).colSpan = count;
  tbody.append(row);
}

function sourceName(source) {
  return ({ direct: 'Прямой / без источника', instagram: 'Instagram', tiktok: 'TikTok', google: 'Google' })[source]
    || source || '—';
}

function paintStatistics(data) {
  const { visitors, cart, purchasers } = data.totals;
  const values = {
    visitors: number.format(visitors), cart: number.format(cart), purchasers: number.format(purchasers),
    orders: number.format(data.orders), paidOrders: number.format(data.paid_orders) + ' оплачено',
    cartRate: visitors ? percent.format(cart / visitors) + ' от посетителей' : '',
    purchaseRate: visitors ? percent.format(purchasers / visitors) + ' от посетителей' : ''
  };
  for (const [key, value] of Object.entries(values)) $('[data-metric="' + key + '"]').textContent = value;
  const daily = $('#daily-rows');
  daily.replaceChildren();
  for (const item of data.daily || []) {
    const row = make('tr');
    cell(row, item.day.split('-').reverse().join('.'));
    for (const key of ['visitors', 'cart', 'orders', 'paid_orders']) cell(row, number.format(item[key]));
    daily.append(row);
  }
  empty(daily, 5, 'За этот период данных пока нет.');
  const countries = $('#country-rows');
  countries.replaceChildren();
  const names = new Intl.DisplayNames(['ru'], { type: 'region' });
  for (const item of data.countries || []) {
    const row = make('tr');
    cell(row, item.country ? names.of(item.country) : 'Не определено');
    cell(row, number.format(item.visitors));
    cell(row, visitors ? percent.format(item.visitors / visitors) : '—');
    countries.append(row);
  }
  empty(countries, 3, 'За этот период данных пока нет.');
  const tbody = $('#sources');
  tbody.replaceChildren();
  for (const item of data.sources) {
    const row = make('tr');
    cell(row, sourceName(item.source));
    cell(row, item.medium || '—');
    cell(row, item.campaign || '—');
    for (const count of [item.visitors, item.cart, item.purchasers]) cell(row, number.format(count));
    tbody.append(row);
  }
  empty(tbody, 6, 'За этот период данных пока нет.');
}

function orderTotal(record, amount = record.total ?? record.subtotal) {
  return new Intl.NumberFormat('ru', { style: 'currency', currency: record.currency }).format(amount / 100);
}

function shippingCell(row, shipping) {
  if (!shipping) return cell(row, '—');
  const slot = cell(row, null, null, 'shipping');
  const details = make('details');
  details.append(make('summary', 'Адрес доставки'));
  const locality = [shipping.city, shipping.region, shipping.postalCode].filter(Boolean).join(', ');
  for (const line of [shipping.street, shipping.addressLine2, locality, shipping.country].filter(Boolean)) {
    details.append(make('small', line));
  }
  slot.append(details);
}

function statusControl(row, record, kind) {
  const reported = record.status === 'pending' && record.payment_reported_at;
  const slot = cell(row, reported ? 'Оплата на проверке' : labels[record.status], null, 'payment');
  if (record.payment_payer) slot.append(make('small', 'Плательщик: ' + record.payment_payer));
  if (record.payment_payer_reference) slot.append(make('small', 'Номер от покупателя: ' + record.payment_payer_reference));
  if (record.payment_reported_at) slot.append(make('small', 'Сообщил об оплате: ' + date.format(new Date(record.payment_reported_at))));
  if (record.paid_at) slot.append(make('small', 'Оплата подтверждена: ' + date.format(new Date(record.paid_at))));
  if (record.payment_transaction_id) slot.append(make('small', 'Revolut: ' + record.payment_transaction_id));
  const next = transitions[kind][record.status];
  if (!next) return;
  const select = make('select');
  select.setAttribute('aria-label', 'Изменить статус ' + record.id);
  select.append(make('option', 'Изменить статус'));
  select.firstChild.value = '';
  for (const state of next) {
    const option = make('option', labels[state]);
    option.value = state;
    select.append(option);
  }
  select.addEventListener('change', async () => {
    const status = select.value;
    if (!status) return;
    let transactionId;
    if (status === 'paid') {
      if (record.shipping) {
        transactionId = prompt(`Сверьте поступление ${orderTotal(record)} по заказу ${record.id} в Revolut. Введите уникальный ID полученного перевода, чтобы подтвердить оплату.`)?.trim();
        if (!transactionId || transactionId.length > 160) {
          select.value = '';
          return;
        }
      } else if (!confirm('Вы уже получили оплату по заказу ' + record.id + '?')) {
        select.value = '';
        return;
      }
    }
    select.disabled = true;
    try {
      await api(kind + '/' + record.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, transactionId })
      });
      if (tab === kind) await load();
    } catch (error) {
      notice.textContent = error.message;
      select.value = '';
      select.disabled = false;
    }
  });
  slot.append(select);
}

function paintRecords(kind, data) {
  const section = $('#' + kind);
  const tbody = section.querySelector('tbody');
  tbody.replaceChildren();
  for (const item of data.rows) {
    const row = make('tr');
    cell(row, item.id, date.format(new Date(item.created_at)));
    if (kind === 'orders') {
      const contact = cell(row, item.name, item.email);
      if (item.shipping?.phone) contact.append(make('small', item.shipping.phone));
      shippingCell(row, item.shipping);
      cell(row, item.qty + ' × ' + item.size_id + ' cm');
      cell(row, orderTotal(item), item.deliveryFee ? 'Доставка ' + orderTotal(item, item.deliveryFee) : null);
      cell(row, sourceName(item.source));
    } else {
      cell(row, item.order_ref);
      cell(row, item.email);
      cell(row, item.reason, null, 'reason');
    }
    statusControl(row, item, kind);
    tbody.append(row);
  }
  empty(tbody, kind === 'orders' ? 7 : 5, kind === 'orders' ? 'Заказов пока нет.' : 'Заявок пока нет.');
  section.querySelector('[data-page="-1"]').disabled = offset === 0;
  section.querySelector('[data-page="1"]').disabled = !data.more;
}

async function load() {
  const view = tab;
  const id = ++requestSequence;
  notice.textContent = 'Загрузка…';
  try {
    if (view === 'statistics') {
      const data = await api('statistics?days=' + $('#period').value);
      if (id === requestSequence) paintStatistics(data);
    } else if (view === 'pricing') {
      const data = await api('pricing');
      if (id === requestSequence) paintPricing(data);
    } else {
      const data = await api(view + '?offset=' + offset);
      if (id === requestSequence) paintRecords(view, data);
    }
    if (id === requestSequence) notice.textContent = '';
  } catch (error) {
    if (id === requestSequence) notice.textContent = error.message;
  }
}

for (const button of tabs) {
  button.addEventListener('click', () => {
    tab = button.dataset.tab;
    offset = 0;
    for (const candidate of tabs) {
      const active = candidate === button;
      $('#' + candidate.dataset.tab).hidden = !active;
      if (active) candidate.setAttribute('aria-current', 'page');
      else candidate.removeAttribute('aria-current');
    }
    load();
  });
}
for (const button of document.querySelectorAll('[data-page]')) {
  button.addEventListener('click', () => {
    offset = Math.max(0, offset + Number(button.dataset.page) * 50);
    load();
  });
}
$('#period').addEventListener('change', load);
load();

function toCents(value) {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value)) return NaN;
  const [whole, fraction = ''] = value.replace(',', '.').split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
function pricingTotal() {
  const total = toCents($('#unit-price').value) + toCents($('#delivery-fee').value);
  $('#pricing-total').textContent = Number.isSafeInteger(total) ? 'Итого за 1 браслет с доставкой: ' + (total / 100).toFixed(2) + ' USD' : '';
}
function paintPricing(data) {
  $('#unit-price').value = (data.unitPrice / 100).toFixed(2);
  $('#delivery-fee').value = (data.deliveryFee / 100).toFixed(2);
  for (const id of ['unit-price', 'delivery-fee', 'save-pricing']) $('#' + id).disabled = !data.configured;
  $('#pricing-status').textContent = data.configured ? '' : 'Для включения настроек выполните supabase/pricing.sql в Supabase. Сейчас действуют прежние цены.';
  pricingTotal();
}
$('#pricing-form').addEventListener('input', pricingTotal);
$('#pricing-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#save-pricing');
  if (button.disabled) return;
  button.disabled = true;
  $('#pricing-status').textContent = 'Сохранение…';
  try {
    const data = await api('pricing', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unitPrice: toCents($('#unit-price').value), deliveryFee: toCents($('#delivery-fee').value) }) });
    paintPricing(data);
    $('#pricing-status').textContent = 'Цены сохранены и применяются к новым заказам.';
  } catch (error) { $('#pricing-status').textContent = error.message; }
  finally { button.disabled = false; }
});
