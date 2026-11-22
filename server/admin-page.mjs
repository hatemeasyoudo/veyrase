export const adminPage = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Veyrase — управление магазином</title>
  <link rel="stylesheet" href="/admin.css">
  <script type="module" src="/admin.js"></script>
</head>
<body>
  <header><a class="brand" href="/admin">Veyrase</a><a href="/">Открыть магазин</a></header>
  <main>
    <h1>Управление магазином</h1>
    <nav aria-label="Разделы">
      <button type="button" data-tab="statistics" aria-current="page">Статистика</button>
      <button type="button" data-tab="orders">Заказы</button>
      <button type="button" data-tab="returns">Возвраты</button>
    </nav>
    <p id="notice" role="status" aria-live="polite"></p>
    <section id="statistics">
      <div class="section-title">
        <h2>Воронка продаж</h2>
        <label>Период <select id="period"><option value="7">7 дней</option><option value="30" selected>30 дней</option><option value="90">90 дней</option></select></label>
      </div>
      <div class="metrics">
        <article><span>Посетители</span><strong data-metric="visitors">—</strong></article>
        <article><span>Добавили в корзину</span><strong data-metric="cart">—</strong><small data-metric="cartRate"></small></article>
        <article><span>Купили</span><strong data-metric="purchasers">—</strong><small data-metric="purchaseRate"></small></article>
        <article><span>Заявки на заказ</span><strong data-metric="orders">—</strong><small data-metric="paidOrders"></small></article>
      </div>
      <p class="hint">Посетители считаются по браузерам за выбранный период. Покупка учитывается после подтверждения оплаты. Источники отражают первое посещение сайта. Периоды считаются по UTC.</p>
      <h2>Источники трафика</h2>
      <div class="scroll" tabindex="0" aria-label="Таблица источников"><table>
        <thead><tr><th>Источник</th><th>Канал</th><th>Кампания</th><th>Посетители</th><th>В корзину</th><th>Купили</th></tr></thead>
        <tbody id="sources"></tbody>
      </table></div>
    </section>
    <section id="orders" hidden>
      <h2>Заказы</h2>
      <div class="scroll" tabindex="0" aria-label="Таблица заказов"><table>
        <thead><tr><th>Заказ</th><th>Клиент</th><th>Доставка</th><th>Товар</th><th>Сумма</th><th>Источник</th><th>Статус и оплата</th></tr></thead>
        <tbody id="order-rows"></tbody>
      </table></div>
      <div class="pager"><button type="button" data-page="-1">Назад</button><button type="button" data-page="1">Далее</button></div>
    </section>
    <section id="returns" hidden>
      <h2>Заявки на возврат</h2>
      <div class="scroll" tabindex="0" aria-label="Таблица возвратов"><table>
        <thead><tr><th>Заявка</th><th>Номер заказа</th><th>Email</th><th>Причина</th><th>Статус</th></tr></thead>
        <tbody id="return-rows"></tbody>
      </table></div>
      <div class="pager"><button type="button" data-page="-1">Назад</button><button type="button" data-page="1">Далее</button></div>
    </section>
  </main>
</body>
</html>`;
