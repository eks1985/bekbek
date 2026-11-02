<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Правила работы с репозиторием bek-bek

## База данных: локальная — дев, прод — на Layero

Дев и прод — **разные** базы, но прод рядом, и попасть в него из дева легко. Берегись.

- Локальная база — свой Postgres (`DATABASE_URL` из `.env.local`, сейчас `localhost:5433/auth`). Прод — PostgreSQL на Layero (база `bek-bek`): на рантайме платформа сама кладёт строку подключения в `LAYERO_DATABASE_URL`, и код (`src/lib/db.ts`, `prisma.config.ts`) берёт её первой, а `DATABASE_URL` — только если её нет.
- Миграции на прод не попадают сами: Layero при сборке их не запускает (`build` = `prisma generate && next build`). Порядок: правка `schema.prisma` → `npm run db:migrate` (создаёт миграцию и применяет её **локально**) → проверка сгенерированного SQL и приложения → коммит схемы **вместе с папкой миграции** → накат на прод `npm run db:deploy` (команды и доступы — в README, раздел «Изменение таблиц БД»).
- Накат миграций на прод, `user:add` против прод-базы и любой ручной SQL в проде — только после подтверждения пользователя, даже если операция выглядит безопасной.
- `prisma migrate dev` при расхождении схемы может предложить **reset базы** — на проде это катастрофа. Поэтому: не прописывать `LAYERO_DATABASE_URL` в `.env.local` (она приоритетнее `DATABASE_URL`, и дев с миграциями уйдёт в прод) и не оставлять прод-строку в `DATABASE_URL` терминала после `db:deploy`. Предложения Prisma о сбросе не принимать.
- Перед `db:deploy` проверять вывод Prisma: должно быть `Datasource "db": … "mgr_bekbek" … at "db.layero.ru:5432"` — значит, команда смотрит в прод, а не в локальную базу.

## Git: пуш в два репозитория и деплой пушем

- У `origin` настроены два push-URL: GitLab (`git@gitlab.com:eks1985/bek-bek.git`) и GitHub (`https://github.com/eks1985/bekbek.git`). Обычный `git push` уходит в оба сразу — ничего дополнительно делать не нужно.
- По команде «коммит и пуш»: закоммитить и запушить; по выводу пуша убедиться, что обновились оба `main` (в выводе должны быть и `gitlab.com`, и `github.com`).
- **Перед каждым пушем** сначала `git fetch origin` и `git fetch github` и проверить, не уехал ли remote `main` вперёд (`git status -sb` не должен показывать `behind`; `main` сверять и с `origin/main`, и с `github/main`). Если уехал — сначала rebase на свежий `main`, потом пуш. При конфликтах ребейса — остановиться и спросить пользователя, конфликты не разрешать самостоятельно.
- Причина проверки: при двух push-URL Git пушит в ремоуты по очереди, и отклонение в GitLab не остановит пуш в GitHub — ремоуты могут разъехаться.
- Ремоут `github` — для fetch (туда же пушат облачные агенты) и точечного пуша только на GitHub (`git push github main`, без `-u`, чтобы не переключать upstream с `origin`).
- Push в `main` на GitLab — это **деплой**: вебхук собирает проект на Layero, через 2–3 минуты новая версия на https://bek-bek.layero.app (если сборка упала — живой остаётся предыдущая). Пуш в `main` только по просьбе пользователя.
- Если в коммите есть миграция БД — порядок выкладки из README («Что сначала — миграция или код»): чистые добавления — сначала миграция на прод, потом пуш; удаления/переименования — в два шага. Не выкладывать код, обращающийся к колонкам, которых на проде ещё нет (или уже нет).

## Параллельная работа: другие агенты работают в этом же репозитории

- Над репозиторием одновременно работают другие агенты (локальные и облачные сессии): фичи живут в ветках вида `feature/*`, `add-*`, `annotate-files-*`, `upload-fit` — локально и в `origin`. Перед пушем делать fetch обоих ремоутов и смотреть `git branch -r --sort=-committerdate` и локальные ветки (`git branch`).
- О чужих ветках докладывать пользователю: имя ветки, что в ней свежего (кратко по коммитам), вливается ли она в текущий `main` без конфликтов (проверять через `git merge-tree` или тестовый merge, ничего не коммитя).
- Чужие ветки самовольно не мержить и не удалять — только по явной просьбе пользователя. Финальное решение о слиянии — всегда за пользователем.
- Если remote `main` уехал вперёд из-за смерженных чужих веток — действовать по обычному правилу: rebase локального `main` на свежий и только потом пуш.

## Стиль коммитов

- Краткое описание изменения по-русски, без conventional-префиксов: «Темп без „/км“ везде: сводка, темп отрезков, вывод парсера», «БД: таблицы fit_files и workouts для FIT-файлов и результатов парсинга». Ориентироваться на `git log`.

## SSH с этого ПК: только System32 OpenSSH

- `ssh`/`scp` из Git Bash (MSYS, `/usr/bin/ssh`) на этой машине зависают: соединения уходят через виртуальный адаптер (10.6.7.1) и не завершаются, а принудительно остановленная сессия оставляет висячий ssh-процесс с открытым соединением — они копятся и мешают новым.
- Для любых `ssh`/`scp` использовать Windows OpenSSH — в Git Bash это `/c/Windows/System32/OpenSSH/ssh.exe` и `/c/Windows/System32/OpenSSH/scp.exe`, всегда с `-o BatchMode=yes`.
- Если MSYS-ssh всё же зависли: `ps -W | grep '/usr/bin/ssh'` → WINPID (4-й столбец) → `taskkill //F //PID <WINPID>`. Сессии `C:\Windows\System32\OpenSSH\ssh.exe`, запущенные не агентом, не трогать — это обычно живая сессия человека.
- VPS для garmin-sync — `root@2.29.21.51` (Ubuntu, Docker): код в `~/bekbek`, токены Garmin и скачанные FIT — в `/opt/garmin-sync/data`. Повторные запуски — docker-командой из README garmin-sync; логин по паролю не нужен, токены уже сохранены.

## Этот файл

- `AGENTS.md` закоммичен и общий для команды и кодинг-агентов; изменения в него вносятся обычными коммитами.
- Блок `nextjs-agent-rules` в начале файла дописывает `next dev` сам — его не редактировать и не выкидывать из коммитов (удаление лишь пересоздаст незакоммиченное изменение).
