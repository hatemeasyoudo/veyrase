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
  if (!response.ok) throw new Error(response.status === 401 ? 'Войдите снова, обновив страницу.' : 'Не удалось выполнить действие. Обновите страницу и попробуйте ещё раз.');
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

function statusControl(row, record, kind) {
  const slot = cell(row, labels[record.status]);
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
    if (!select.value) return;
    if (select.value === 'paid' && !confirm('Вы уже получили оплату по заказу ' + record.id + '?')) {
      select.value = '';
      return;
    }
    select.disabled = true;
    try {
      await api(kind + '/' + record.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: select.value })
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
      cell(row, item.name, item.email);
      cell(row, item.qty + ' × ' + item.size_id + ' cm');
      cell(row, new Intl.NumberFormat('ru', { style: 'currency', currency: item.currency }).format(item.subtotal / 100));
      cell(row, sourceName(item.source));
    } else {
      cell(row, item.order_ref);
      cell(row, item.email);
      cell(row, item.reason, null, 'reason');
    }
    statusControl(row, item, kind);
    tbody.append(row);
  }
  empty(tbody, kind === 'orders' ? 6 : 5, kind === 'orders' ? 'Заказов пока нет.' : 'Заявок пока нет.');
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
