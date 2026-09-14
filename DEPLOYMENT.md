# Chuẩn bị deploy bản test OVERANGE

Project đã được chuẩn bị, chưa push GitHub và chưa deploy online.

## Database local và production

- Local: SQLite, schema `server/prisma/schema.prisma`, database hiện tại `server/prisma/dev.db`.
- Production: PostgreSQL, schema `server/prisma/postgresql/schema.prisma`.
- Hai schema có cùng User, Slot, Booking, relationships và constraints.
- `@@unique([userId, slotId])` vẫn chặn booking trùng một Slot; nhiều Slot/ngày và nhiều user/Slot vẫn được phép.
- Slot vẫn lưu ngày/giờ dạng chuỗi; response API giữ nguyên.
- PostgreSQL có lịch sử migration riêng. SQL SQLite dùng AUTOINCREMENT/PRAGMA nên không thể dùng nguyên migrations SQLite cho PostgreSQL.
- Backend chọn Prisma Client theo DATABASE_URL: `file:` dùng SQLite, `postgresql://` hoặc `postgres://` dùng PostgreSQL.
- Database SQLite hiện tại được giữ nguyên. Bước chuẩn bị này không sao chép dữ liệu local lên PostgreSQL; database online mới sẽ được migrate và seed Slot. Nếu muốn mang theo User/Booking local, cần một bước chuyển dữ liệu riêng.
- Khi thay đổi model sau này, cập nhật cả hai schema và tạo migration riêng cho từng provider.

## Chạy local

Trong `server`, giữ DATABASE_URL=`file:./dev.db` và JWT_SECRET đã có trong .env.

Checkout mới:

```powershell
cd C:\schedule\server
npm.cmd ci --include=dev
Copy-Item .env.example .env
# Điền JWT_SECRET vào .env trước khi Login.
npm.cmd run db:generate
npm.cmd run db:deploy
npm.cmd run db:seed
npm.cmd run dev
```

Nếu đã có .env/database, giữ nguyên chúng và chạy `npm.cmd run dev`.
`predev` tạo các Prisma Client cần thiết. Script generation bỏ qua client nếu schema và phiên bản đã khớp; khi thay đổi schema trên Windows, dừng backend/Prisma Studio trước khi generate để tránh khóa DLL.

Terminal frontend:

```powershell
cd C:\schedule\client
npm.cmd ci --include=dev
npm.cmd run dev
```

Để VITE_API_URL trống hoặc không đặt khi chạy local. Axios dùng `/api`; Vite proxy chuyển request sang `http://127.0.0.1:3000`. Mở `http://localhost:5173`.

**Các lệnh database local** đều dùng schema SQLite:
`npm run db:deploy`, `npm run db:migrate`, `npm run db:studio`.

**Lệnh `npx prisma migrate deploy` mặc định dùng PostgreSQL**, theo `server/prisma.config.js`.

## Biến môi trường backend online

Dùng `server/.env.production.example` làm mẫu và đặt biến trong dashboard dịch vụ hosting:

| Biến | Giá trị |
| --- | --- |
| NODE_ENV | production |
| DATABASE_URL | PostgreSQL connection URL do dịch vụ database cấp |
| JWT_SECRET | Chuỗi ngẫu nhiên bí mật, giữ ổn định giữa các lần deploy |
| FRONTEND_URL | Origin HTTPS của frontend, ví dụ https://casting.example.com |
| PORT | Hosting thường tự cấp; nếu không, đặt 3000 |
| SCHEDULING_TIMEZONE | Asia/Ho_Chi_Minh (cũng là mặc định) |

DATABASE_URL có thể cần `?sslmode=require` theo hướng dẫn của nhà cung cấp. Dùng URL hỗ trợ DDL và advisory locks cho Prisma Migrate; nếu dịch vụ có pooler không hỗ trợ migrations, chạy migration bằng direct connection URL do họ cấp.

FRONTEND_URL chỉ chứa scheme + domain + port nếu có; không thêm `/api`, path, query hoặc wildcard. Dấu `/` cuối URL được chuẩn hóa. Production chỉ chấp nhận Origin frontend này; localhost không được tự thêm. Development chấp nhận localhost:5173, 127.0.0.1:5173 và FRONTEND_URL được cấu hình.

CORS xử lý preflight với Content-Type, Authorization và DELETE. JWT tiếp tục gửi bằng Bearer header, không chuyển sang cookies. Health checks/PowerShell không có Origin vẫn được phép gọi API; các endpoint bảo vệ vẫn cần JWT.

Tạo JWT_SECRET trên máy bạn rồi điền vào hosting:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Không đưa secret hoặc database credentials vào GitHub/frontend.

## Biến môi trường frontend online

Đặt trước khi build:

```dotenv
VITE_API_URL=https://your-backend.example.com/api
```

**Bao gồm `/api`** vì các React handler gọi `/auth/login`, `/slots`, `/bookings`, v.v. Axios giữ interceptor Bearer token hiện tại.

Vite đưa VITE_API_URL vào bundle lúc build. Thay đổi URL cần build/deploy lại frontend. Đây là URL công khai; chỉ backend giữ JWT_SECRET và DATABASE_URL.

## Cấu hình dịch vụ hosting

Chọn Node.js 22.12+ (Node 22 được dùng để kiểm tra project).

| Dịch vụ | Root directory | Build Command | Start Command / Output |
| --- | --- | --- | --- |
| Backend | server | npm ci --include=dev && npm run build | npm start |
| Frontend | client | npm ci --include=dev && npm run build | Output directory: dist |

Backend không cần compile JavaScript. `npm run build` generate Prisma Client SQLite và PostgreSQL; giữ Prisma CLI khi chạy migrations. `npm start` chạy Express trên PORT, bind 0.0.0.0 để hosting truy cập được. Production yêu cầu PostgreSQL DATABASE_URL, JWT_SECRET và FRONTEND_URL hợp lệ.

Build không tự migrate hoặc seed database.

## Migration production

Chạy trong `server`, sau khi đã đặt DATABASE_URL PostgreSQL:

```sh
npx prisma migrate deploy
```

Lệnh npm tương đương:

```sh
npm run db:deploy:production
```

Migration `prisma/postgresql/migrations/20260914000000_init/migration.sql` tạo User, Slot, Booking, unique indexes và foreign keys cho database PostgreSQL mới. Chạy lại chỉ áp dụng migration chưa chạy; không reset database.

Dùng release/pre-deploy command của hosting hoặc shell của backend. Không dùng `migrate reset`, `db push --force-reset` hay `migrate dev` trên production.

## Seed production

Sau migration, trong `server` với DATABASE_URL PostgreSQL:

```sh
npm run db:seed
```

Hoặc chọn thứ Hai cụ thể:

```sh
npm run db:seed -- 2026-09-14
```

Seed tạo 4 tuần, 28 ngày, 3 Slot/ngày:
09:00–10:00, 10:00–11:00, 11:00–12:00.

Script dùng upsert theo `date_startTime`, `update: {}`. Chạy lại cùng khoảng ngày giữ Slot ID, User và Booking. Chọn tuần khác chỉ thêm các Slot còn thiếu.

Có thể dùng release command:

```sh
npx prisma migrate deploy && npm run db:seed
```

Không seed trong từng HTTP request hoặc mỗi lần user mở Calendar.

## Kiểm tra trước khi push GitHub

```powershell
cd C:\schedule\server
npm.cmd test
cd ..\client
npm.cmd run build
```

Tests SQLite dùng database tạm. Để chạy thêm integration tests PostgreSQL, cấp **test database** qua TEST_POSTGRES_DATABASE_URL:

```powershell
cd C:\schedule\server
$env:TEST_POSTGRES_DATABASE_URL = 'postgresql://USER:PASSWORD@HOST:5432/TEST_DATABASE'
npm.cmd test
Remove-Item Env:TEST_POSTGRES_DATABASE_URL
```

Suite PostgreSQL tạo schema ngẫu nhiên `scheduler_test_...` và chỉ xóa schema đó khi xong; không reset schema public. Test account được tạo trong schema riêng. Nếu không có TEST_POSTGRES_DATABASE_URL, suite này skip, các tests local vẫn chạy.

.gitignore loại trừ .env/.env.*, node_modules, dist, generated PostgreSQL Client và database SQLite. Các .env.example được đưa lên Git cùng hai schema, migrations, seed, package-lock và source code.

Project chưa có Git repository trong workspace hiện tại. Khi sẵn sàng, bạn có thể chạy:

```powershell
cd C:\schedule
git init
git add .
git status
git diff --cached --stat
# Kiểm tra không có .env, database, node_modules hoặc generated client.
git commit -m "Prepare OVERANGE test deployment"
```

Sau đó tạo repository trên GitHub và push theo hướng dẫn của GitHub. Không đặt credentials trong remote URL.

## Sau khi deploy thực tế

Kiểm tra backend `/api/health`, frontend Register → Login → reload → Calendar → đổi tuần → Booking → Shared Schedule → Cancel → Logout. Dùng hai account kiểm tra cùng Slot hiển thị cả hai tên.

Frontend, backend và PostgreSQL sẽ chạy trên dịch vụ online độc lập với máy local sau khi deploy thành công. Hiện bước này chỉ chuẩn bị cấu hình và kiểm tra local.

