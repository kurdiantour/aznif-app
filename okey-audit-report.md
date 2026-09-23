# Audit سیستم بازی Okey

بر اساس بررسی دقیق مسیرهای اجرا و کدهای سیستم Okey (شامل Frontend، Server، Game Logic و Engine)، موارد زیر به عنوان کدهای تکراری، State های موازی، محاسبات افزونه و مسیرهای مرده (Dead Code) شناسایی شدند:

## ۱. محاسبات تکراری و چرخه موازی (Duplicate Interval & Timer State)
**فایل‌های درگیر:** 
- `hooks/useOkeyMultiplayerGame.ts`
- `components/OkeyTurnTimerBar.tsx`

**مسیر اجرا و مشکل:**
در Hook مربوط به `useOkeyMultiplayerGame`، یک `setInterval` با زمان ۲۵۰ میلی‌ثانیه وجود دارد که مقدار `turnMillisecondsLeft` را از طریق `deadline - Date.now()` محاسبه می‌کند و این مقدار را به لایه UI پاس می‌دهد. 
اما در کامپوننت `OkeyTurnTimerBar` دوباره یک state به نام `clockNow` ساخته شده و یک `setInterval` مستقل با زمان ۱۰۰۰ میلی‌ثانیه اجرا می‌شود که مجدداً `accessibleRemaining` را محاسبه می‌کند (`Date.parse(deadlineAt) - clockNow - serverClockOffsetMs`). هم‌زمان انیمیشن نوار تایمر (`Animated.timing`) نیز بر اساس این زمان اجرا می‌شود.
**اثر ادغام/حذف:**
حذف تایمر داخلی `OkeyTurnTimerBar` و استفاده مستقیم از مقدار محاسبه شده در Hook (یا صرفاً استفاده از `Animated.timing`) باعث حذف یک Source of Truth موازی، کاهش Rerender های اضافی در React و تجمیع مدیریت زمان در یک لایه می‌شود.

## ۲. چرخش و محاسبه اضافی برای جایگاه بازیکنان (Redundant Seat Rotation Logic)
**فایل‌های درگیر:**
- `presentation/okey-server-projection.ts` (تابع `projectOkeyServerState`)
- `presentation/useOkeyTablePresentation.ts` (درون `useOkeyTableViewModel`)

**مسیر اجرا و مشکل:**
تابع `projectOkeyServerState` به درستی لیست بازیکنان ارسال شده از سرور (`projection.players`) را بر اساس `currentUserId` می‌چرخاند (Rotate)؛ به طوری که کاربر فعلی (Local Player) همیشه در ایندکس `0` (`bottom` یا همان کاربر اصلی) قرار می‌گیرد و بقیه بازیکنان در ایندکس‌های ۱ تا ۳ چیده می‌شوند.
با این وجود، در `useOkeyTableViewModel` این نرمال‌سازی کاملاً نادیده گرفته شده است! این لایه دوباره به آرایه اولیه (`onlineProjection?.players`) رجوع کرده، مقدار `localPlayerIndex` را پیدا می‌کند و با صدا زدن `getRelativeSeatMap(localPlayerIndex)` مجدداً محاسبه می‌کند که کدام بازیکن در کدام صندلی (`top, left, right, bottom`) نشسته است.
**اثر ادغام/حذف:**
با حذف منطق `seatMap` و نگاشت مجدد در ViewModel و اتکای مستقیم به ایندکس‌های ۰ تا ۳ از آرایه `state.players` (که قبلاً در Projection نرمال شده‌اند)، محاسبات و رندرهای اضافه مربوط به مرتب‌سازی بازیکنان کاملاً حذف می‌شود.

## ۳. مسیرهای مرده و بدون استفاده (Dead Code & Ghost Paths)
**فایل‌های درگیر:**
- `engine/okeyengine-konkan.ts`
- `engine/okey-engine.ts`

**مسیر اجرا و مشکل:**
توابع `findKonkanDeclarationRunTileIds` و `findKonkanDeclarationForPlayer` در فایل کانکان تعریف شده‌اند و در همه جای سیستم (از جمله در فایل اصلی موتور `okey-engine.ts`) Export شده‌اند. اما پیاده‌سازی این توابع کاملاً خالی است و فقط `return null;` برمی‌گردانند.
**اثر ادغام/حذف:**
این موارد توابع قدیمی و بدون مصرف هستند که حذف آن‌ها هیچ اثری در بازی نخواهد داشت، اما API Surface موتور بازی را تمیزتر می‌کند.

## ۴. نام‌گذاری و State دوگانه برای یک مفهوم واحد (Redundant Ghost Abstraction)
**فایل‌های درگیر:**
- `engine/okeyengine-eliminated.ts`
- `server/okey-turn-engine.ts`

**مسیر اجرا و مشکل:**
مفهوم بازیکنی که از بازی خارج شده یا قطع اتصال پیدا کرده، توسط تابع `isEliminatedOkeyPlayer` بررسی می‌شود. اما در همان فایل تابع دیگری به نام `isGhostOkeySeat` وجود دارد که دقیقاً یک نام مستعار است (`return isEliminatedOkeyPlayer(player);`).
مشکل این است که لایه سرور (مثلاً `okey-turn-engine.ts`) از `isGhostOkeySeat` استفاده می‌کند در حالی که موتور بازی مستقیماً از `isEliminatedOkeyPlayer` استفاده می‌کند. این موضوع باعث ایجاد دو مسیر مفهومی مختلف برای یک لاجیک یکسان (Source of Truth یکسان) شده است.
**اثر ادغام/حذف:**
حذف تابع واسط `isGhostOkeySeat` و یکپارچه‌سازی تمام فراخوانی‌ها به `isEliminatedOkeyPlayer` باعث جلوگیری از سردرگمی در درک معماری و یکدست شدن منطق کلاینت و سرور می‌شود.

## ۵. کد مرده (Dead Code) و منطق بدون استفاده برای تشخیص پیروزی Konkan
**فایل‌های درگیر:**
- `engine/okeyengine-konkan.ts`

**مسیر اجرا و مشکل:**
توابع `canDeclareKonkanWin`، `hasSmallKonkanMeld` و `isOfficialKonkanRun` با هدف پیدا کردن و اعتبارسنجی خودکار یک دست برنده به سبک Konkan از داخل مهره‌های درهم‌ریخته پیاده‌سازی شده‌اند. با بررسی مسیر Runtime مشخص می‌شود که سرور و کلاینت برای پایان دادن به بازی با Konkan، به جای استفاده از تشخیص خودکار (که از نظر پردازشی سنگین و مبهم است)، از یک اکشن صریح به نام `declareKonkanOpen` استفاده می‌کنند. این اکشن صریح خودش لیست دقیق مهره‌های ران و تکمیل را می‌گیرد و با `isOrderedOfficialKonkanRun` اعتبارسنجی می‌کند. بنابراین `canDeclareKonkanWin` و توابع وابسته به آن کاملاً در بازی اصلی بدون استفاده (Dead Code) رها شده‌اند و فقط در تست‌ها صدا زده می‌شوند.

**اثر ادغام/حذف:**
حذف این توابع به شدت حجم و پیچیدگی `okeyengine-konkan.ts` را کاهش می‌دهد و از نگهداری کدهای مرده که با قوانین بازی همگام نیستند جلوگیری می‌کند.

## ۶. قوانین تکراری (Duplicate Logic) برای محاسبه سایز مجاز Meld تکمیلی در Konkan
**فایل‌های درگیر:**
- `engine/okey-rack-layout.ts` (تابع `findKonkanRackLayoutCandidates`)
- `engine/okeyengine-konkan.ts` (تابع `canDeclareKonkanOpen`)

**مسیر اجرا و مشکل:**
در قوانین Konkan، اگر بازیکن قبلاً یک دست قفل‌شده (Locked Set) داشته باشد، سایز دست تکمیلی (Completion Meld) می‌تواند حداقل ۳ و حداکثر ۴ باشد؛ در غیر این صورت فقط باید دقیقاً ۴ باشد. این منطق دقیق (`hasLockedSet ? [3, 4] : [4]`) دقیقاً و به شکل هاردکد شده هم در کلاینت برای پیدا کردن الگوها در Rack (`okey-rack-layout.ts`) و هم در انجین/سرور برای اعتبارسنجی نهایی (`canDeclareKonkanOpen`) کپی شده است.

**اثر ادغام/حذف:**
در صورت تغییر قوانین، باید هر دو فایل تغییر کنند. این منطق باید به یک تابع مشترک (مثلاً `getValidKonkanCompletionMeldSizes(hasLockedSet)`) در انجین استخراج شود و هر دو لایه فقط از این Source of Truth استفاده کنند.

## ۷. توابع واسط (Wrappers) تکراری و بلااستفاده در سیستم محاسبه امتیاز Rack
**فایل‌های درگیر:**
- `engine/okey-rack-layout.ts`

**مسیر اجرا و مشکل:**
تابع `getRackMeldPlan` یک محاسبه گران‌قیمت برای پیدا کردن بهترین ترکیب امتیاز در Rack انجام می‌دهد. دو تابع `getOpenableRackLayout` و `getRackDisplayScore` در این فایل فقط به عنوان واسط (Wrapper) روی `getRackMeldPlan` عمل می‌کنند. بدتر از آن، `getRackDisplayScore` به جز تست‌ها، در هیچ جای دیگری از کلاینت یا سرور استفاده نمی‌شود و یک Abstraction مرده است. `getOpenableRackLayout` هم نیازی به وجود ندارد و لایه‌ها می‌توانند مستقیم به خروجی `getRackMeldPlan` دسترسی پیدا کنند.

**اثر ادغام/حذف:**
حذف `getRackDisplayScore` کد مرده را پاکسازی می‌کند و حذف Wrapper اضافی، باعث شفافیت بیشتر در مسیر استفاده کلاینت از سیستم استخراج Meldها در `useOkeyTableActions` می‌شود.
