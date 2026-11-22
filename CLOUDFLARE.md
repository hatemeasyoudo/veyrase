# Развёртывание Veyrase

Обновление предназначено для Worker `yellow-shape-225f` с доменом
`veyrase.store`. Worker раздаёт витрину из `dist/` и сохраняет данные в
Cloudflare D1.

## Настройка

1. В папке проекта войдите через Wrangler и создайте базу.

   ```sh
   npx wrangler login --device
   npx wrangler d1 create veyrase-store
   ```

   Если база уже существует, найдите её ID через `npx wrangler d1 list`.
   Вставьте действительный ID в `wrangler.jsonc` в поле `database_id`.

2. Примените миграцию и опубликуйте Worker.

   ```sh
   npx wrangler d1 migrations apply DB --remote
   npx wrangler deploy
   npx wrangler secret put ADMIN_PASSWORD
   ```

   Введите уникальный пароль длиной от 20 символов в запросе Wrangler.
   Откройте `https://veyrase.store/admin`. Имя пользователя — `admin`.

## Заказы и статистика

Заявка на заказ содержит имя и email. Согласуйте доставку и оплату с
покупателем по email. Переводите заказ в «Оплачено» после получения оплаты.
Заявки из раздела **Returns** появятся на вкладке **Возвраты**.

Статистика собирается с момента публикации. Уникальные посетители считаются
по браузерам с учётом сигналов приватности. Чтобы отличать кампании,
добавляйте к внешним ссылкам параметры `utm_source`, `utm_medium` и
`utm_campaign`. Например, `?utm_source=instagram&utm_medium=social`.
