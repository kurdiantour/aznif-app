گزارش بررسی کدبیس — ۲۰۲۶-۰۹-۲۷

این گزارش بر اساس وضعیت فعلی working tree، شامل تغییرات ثبت‌نشدهٔ موجود، تهیه شده است. کد برنامه تغییر نکرده است. بررسی شامل تحلیل ایستای ۴۴۶ فایل JS/TS، گراف ارجاعات، مقایسهٔ کدهای تکراری، بررسی ۳۸۷ فایل assets، اجرای lint، TypeScript و تست‌های Shop و Notifications است. فایل‌های تولیدشده، node_modules و خروجی native build از تحلیل کد مرده کنار گذاشته شدند. این بررسی، ممیزی کامل امنیتی دیتابیس یا اجرای برنامه روی دستگاه نیست.

| اولویت | یافته | اطمینان |
| --- | --- | --- |
| بالا | ظاهر دومینو همیشه ست پیش‌فرض است؛ ۱۰ تست مرتبط شکست می‌خورند | قطعی در کد و تست محلی |
| بالا | Node 20 در CI با loader تست‌های پروژه ناسازگار است | قطعی از تنظیمات و API مورد استفاده |
| متوسط | خطای بارگذاری Okey به مصرف‌کنندهٔ hook برنمی‌گردد | قطعی در کد؛ اثر بصری روی دستگاه بررسی نشده |
| متوسط | lint با ۳ خطا متوقف می‌شود | قطعی با اجرا |
| متوسط | چند مجموعهٔ تست مهم از فرمان اصلی CI حذف شده‌اند | قطعی از تنظیمات |
| متوسط | دو کاتالوگ کاملاً یکسان، هر دو در مسیر اجرا | قطعی با مقایسهٔ محتوا |
| پایین | فایل‌ها و exportهای بدون مصرف و بیش از ۵۰ diagnostic کد بدون استفاده | شواهد ایستا؛ جزئیات پایین |
| پایین | یک جفت آیکون منبع قابل تجمیع؛ کاشی‌های مستقل Shop عمدی‌اند | جزئیات در گزارش تکمیلی Assetها |

**۱. ظاهر انتخاب‌شدهٔ دومینو در Provider اعمال نمی‌شود**

در [useDominoCosmetics.tsx](/D:/domino-app/domino/hooks/useDominoCosmetics.tsx:28)، Provider فقط `children` را دریافت می‌کند؛ `roomId` و `mode` در نوع props هستند ولی خوانده نمی‌شوند. `activeSetId` همیشه `DEFAULT_DOMINO_SET_ID` و `isReady` همیشه `true` است.

صفحهٔ [game.tsx](/D:/domino-app/app/domino/game.tsx:785) شناسهٔ اتاق و حالت بازی را ارسال می‌کند، ولی Provider آن‌ها را نادیده می‌گیرد. پس‌زمینهٔ میز و [DominoTile.tsx](/D:/domino-app/components/game/DominoTile.tsx:24) نیز همین context را مصرف می‌کنند. در نتیجه این مسیر نمایش، ست انتخاب‌شده/قفل‌شدهٔ مسابقه را اعمال نمی‌کند و gate آمادگی عملاً همیشه باز است.

`npm run test:shop` در [cosmetics.test.tsx](/D:/domino-app/tests/shop/cosmetics.test.tsx:83) با ۱۰ شکست در حالت‌های 1v1 و 2v2 تمام شد: انتظار برای snapshot، پاسخ کند، تغییر اتاق، timeout و remount. این صرفاً import اضافی نیست؛ قرارداد تست و پیاده‌سازی فعلی با هم ناسازگارند. پیشنهاد: اتصال Provider به snapshot مسابقه و وضعیت واقعی readiness. اگر حذف این قابلیت تصمیم محصول بوده، قرارداد، props و تست‌ها باید هماهنگ شوند.

**۲. پیکربندی CI با نیاز تست‌ها سازگار نیست**

[ci.yml](/D:/domino-app/.github/workflows/ci.yml:15) نسخهٔ Node را `20` قرار می‌دهد، اما [test-typescript-loader.mjs](/D:/domino-app/scripts/test-typescript-loader.mjs:1) از `registerHooks` استفاده می‌کند. این API از Node 22.15.0 و 23.5.0 اضافه شده و در Node 20 وجود ندارد. فرمان `test:okey:core` در `check` همین loader را اجرا می‌کند. منبع: [مستندات رسمی registerHooks](https://nodejs.org/api/module.html#moduleregisterhooksoptions).

همچنین `npm run check` قبل از `setup-deno` اجرا می‌شود، در حالی که خودش `typecheck:edge` و دستور `deno check` دارد. این ترتیب به Deno احتمالی موجود در image وابسته است؛ نصب صریح باید قبل از check باشد. بررسی Deno بعدی نیز با بخشی از `typecheck:edge` هم‌پوشانی دارد.

پیشنهاد: همسان‌کردن نسخهٔ Node محلی و CI با API loader، جابه‌جایی setup-deno و داشتن یک فرمان مرجع برای typecheck همهٔ Edge Functionها. CI ریموت در این بررسی اجرا نشده است.

**۳. خطای دریافت بازی آنلاین Okey از API hook حذف شده است**

[useOkeyMultiplayerGame.ts](/D:/domino-app/okey/hooks/useOkeyMultiplayerGame.ts:35) وضعیت‌های `loading` و `error` را ایجاد و به‌روزرسانی می‌کند، ولی هیچ‌کدام خوانده یا در خروجی hook برگردانده نمی‌شوند. خطای refresh اولیه در catch ثبت می‌شود؛ خروجی hook در خط ۲۷۹ این خطا را به صفحه نمی‌رساند.

در نبود projection نیز خط ۲۳۱ با `createInitialOkeyGame()` یک state جایگزین می‌سازد. بنابراین مصرف‌کننده نمی‌تواند از طریق این hook، بارگذاری/خطای snapshot را از state جایگزین تشخیص بدهد. پیشنهاد: خروجی صریح loading/error و مسیر retry در صفحه. این مورد با بررسی مسیر کد تأیید شده؛ سناریوی شبکه روی دستگاه بازتولید نشده است.

**۴. lint فعلی پاس نمی‌شود**

در [leaderboard.tsx](/D:/domino-app/app/(tabs)/leaderboard.tsx:67)، خطوط ۶۷، ۹۷ و ۱۰۶ سه خطای `react-hooks/set-state-in-effect` گزارش شد. چون `check` از lint شروع می‌شود، همین خطاها زنجیرهٔ بعدی را متوقف می‌کنند. فایل از قبل تغییرات ثبت‌نشده داشت؛ گزارش دربارهٔ همین وضعیت محلی است.

در [FeedbackPopup.tsx](/D:/domino-app/components/lobby/FeedbackPopup.tsx:70) نیز یک `eslint-disable` بی‌اثر وجود دارد. آن مورد warning است. پیشنهاد: بازبینی state مشتق‌شده و حذف disable بی‌مصرف، بدون خاموش‌کردن کلی قانون lint.

**۵. تست‌های موجود به فرمان اصلی بررسی وصل نیستند**

در [package.json](/D:/domino-app/package.json:19)، `check` شامل `test:shop` و `test:notifications` نیست. `jest.auth.config.cjs` هم اسکریپتی در این زنجیره ندارد. تست‌های TypeScript زیر `domino/**/__tests__` و `lib/multiplayer/core/__tests__` نیز در globهای `test:okey:core` یا تنظیمات Jest متصل به check قرار نمی‌گیرند.

نمونه‌های دیگر: `scripts/wallet-architecture.test.mjs`، `scripts/wallet-economy-reporting.test.mjs`، `scripts/waiting-room-heartbeat.test.mjs` و `scripts/ios-game-system-gestures.test.cjs`. این‌ها فایل مردهٔ برنامه محسوب نمی‌شوند؛ تست‌های قابل اجرا هستند که مسیر اصلی CI پوشششان نمی‌دهد. شکست واقعی Shop در همین بررسی، اهمیت این خلأ را نشان می‌دهد.

**۶. دو فایل کاتالوگ کاملاً تکراری‌اند**

[tables.ts](/D:/domino-app/constants/catalog/tables.ts:1) و [okey-sets.ts](/D:/domino-app/constants/catalog/okey-sets.ts:1) پس از یکسان‌سازی پایان خط کاملاً برابرند؛ حدود ۴۶۵ خط در هر فایل، شامل نوع‌ها، نگاشت تصاویر، registry و helperها.

هر دو زنده‌اند: `constants/catalog/cosmetics.ts` از `tables.ts` و `okey/hooks/useOkeyCosmetics.tsx` و `lib/game/gameLaunchPreload.ts` از `okey-sets.ts` استفاده می‌کنند. بنابراین حذف مستقیم یکی صحیح نیست. پیشنهاد: یک منبع مرجع و اصلاح importها؛ در صورت نیاز یک re-export موقت. خطر فعلی، متفاوت‌شدن نمایش فروشگاه و بازی پس از ویرایش تنها یکی از دو فایل است.

**۷. فایل‌های بدون مصرف یا خارج از مسیر اجرای برنامه**

تحلیل import/export/require و رشته‌های مسیر، ورودی‌های `app/`، Edge Functionها و Cloudflare را لحاظ کرد. فایل‌های native/web نیز با قرارداد نام‌گذاری پلتفرم بررسی شدند. ارجاع پویا که از رشته‌های محاسبه‌شده ساخته شود ممکن است در این روش دیده نشود؛ نتیجهٔ زیر مبنای بازبینی حذف است.

| فایل | وضعیت |
| --- | --- |
| `components/game/DropAnimationOverlay.tsx` | بدون ارجاع در کد و تست؛ نامزد قوی حذف |
| `lib/multiplayer/core/timeout-orchestration.ts` | بدون import مصرف‌کننده؛ نامزد قوی حذف یا اتصال به مسیر واقعی |
| `lib/multiplayer/core/bot-turn-orchestration.ts` | بدون import مصرف‌کننده؛ نامزد قوی حذف یا اتصال |
| `lib/multiplayer/core/seat-ownership.ts` | تنها از فایل bot-turn-orchestration بالا import نوع دارد؛ زنجیرهٔ بدون مصرف |
| `domino/index.ts` | barrel ورودی بدون مصرف |
| `domino/core/index.ts` | در زنجیرهٔ barrel بالا؛ فایل‌های داخلی مستقیماً import می‌شوند |
| `domino/shared/index.ts` | در زنجیرهٔ barrel بالا؛ حذف آن به معنی حذف ماژول‌های shared نیست |
| `domino/modes/one-vs-one/index.ts` | در زنجیرهٔ barrel بالا؛ مسیر اجرای مستقیمی پیدا نشد |
| `domino/modes/one-vs-one/lifecycle/domino-one-vs-one-lifecycle.ts` | مصرف مستقیم در تست engine-parity دارد، ولی از ورودی‌های runtime قابل دسترسی نبود؛ حذف بی‌قید توصیه نمی‌شود |

در مجموع ۹ فایل خارج از گراف runtime پیدا شد؛ این عدد شامل فایل دارای مصرف تست و barrelها نیز هست و به معنی ۹ فایل قطعاً قابل حذف نیست.

**۸. کد مرده داخل فایل‌های زنده**

`npx tsc --noEmit --noUnusedLocals --noUnusedParameters` بیش از ۵۰ diagnostic داد. نمونه‌های مهم:

| محل | موارد |
| --- | --- |
| `okey/adapters/supabase-okey-match-adapter.ts:141` | متد خصوصی `requireSnapshot` بدون مصرف |
| `okey/server/okey-server-reconciler.ts:7` | چندین import بدون مصرف و `nextVersion` در خط ۲۷۱ |
| `domino/modes/ai-practice/controllers/use-domino-ai-practice-controller.ts:1` | importهای قدیمی مانند `applyMove`، `isValidMove`، `roundToNearestFive` و `handContainsTile` |
| `components/game/BoardBoneyard.tsx:35` | `boardWidth` و `tileWidth` خوانده نمی‌شوند |
| `components/game/DrawPilePrompt.tsx:48` | `passCountdown` خوانده نمی‌شود |
| `okey/scenes/OkeyGameTableScene.tsx:232` | setterها و متغیرهای بدون استفاده مانند `setKonkanRevealData`، `setTableMeldOffsets` و `showFinalTileCelebration` |
| `okey/hooks/useOkeyMultiplayerGame.ts:35` | `loading` و `error`؛ پیامد رفتاری در بند ۳ |

جست‌وجوی نام exportها در سورس نیز موارد زیر را فقط در محل تعریف پیدا کرد؛ این‌ها نامزد پاک‌سازی‌اند، نه فهرست قطعی حذف خودکار:

- `lib/supabaseAuth.ts:423`: تابع `getPublicProfile`.
- `lib/shop-state.ts:33`: تابع `getDefaultItem`.
- `lib/gameInvites.ts:76`: تابع `cancelGameInvite`.
- `lib/platformFeatures.ts:3`: مقدار `IS_IOS_APP_REVIEW_BUILD`.
- `domino/shared/game-shared.ts`: توابع `createTwoVsTwoSeats`، `getInitialDeal`، `resolveBlockedRound2v2`، `awardEndOfHandPoints2v2` و `evaluateFinalWinner`.
- `okey/engine/okeyengine-melds.ts`: توابع `isValidScoringMeld`، `getOkeyPlayerSetScore` و `getBestRackSetScore`.
- `lib/rtl.ts`: مقدارهای `isKurdishRTL` و `rtlStyles`؛ خود فایل نباید به این دلیل حذف شود، چون side effect مربوط به `I18nManager` دارد.

پیشنهاد: ابتدا importها و متد خصوصی بدون مصرف پاک‌سازی شوند. دربارهٔ پارامترهای قوانین بازی و stateهای UI ابتدا باید روشن شود کد باقی‌مانده است یا اتصال فراموش‌شده؛ حذف پارامتر به‌تنهایی رفتار ناقص را اصلاح نمی‌کند.

**۹. تکرار موتور دومینو، با مرز اجرایی عمدی**

بین [موتور کلاینت](/D:/domino-app/domino/core/engine/kozel-engine.ts:10) و [نسخهٔ Deno](/D:/domino-app/supabase/functions/_shared/kozel-engine.ts:33)، بدنهٔ ۱۲ تابع بعد از یکسان‌سازی فاصله‌ها برابر بود: `normalizeImageKey`، `isDouble`، `otherSide`، `createEmptyBoard`، `cloneBoard`، `createPlacedTile`، `buildBranchPath`، `canAnyPlayerMove`، `canHandMove`، `applyOpeningTile`، `isValidMove` و `applyMove`.

هر دو مصرف‌کننده دارند. [OWNERSHIP.md](/D:/domino-app/domino/OWNERSHIP.md:18) صریحاً نگه‌داشتن adapter مخصوص Deno را توضیح می‌دهد؛ بنابراین این مورد کد مرده یا خطای قطعی نیست. پیشنهاد: استخراج بخش pure و مشترک با حفظ مرز runtime، یا افزودن آزمون parity مشخص بین همین دو پیاده‌سازی. کل دو فایل یکسان نیستند.

**۱۰. تصاویر تکراری و وابستگی‌های مشکوک به اضافه‌بودن**

اصلاح بر اساس توضیح مالک پروژه: کاشی‌های Setهای مختلف Okey محصولات مستقل Shop هستند. یکسان‌بودن فعلی محتوا دلیل اضافه‌بودن آن‌ها نیست؛ پیشنهاد قبلی تجمیع/حذف کاشی‌ها پس گرفته می‌شود و ساختار مستقل آن‌ها باید حفظ شود.

خارج از این کاشی‌ها، در assets فقط icon.png و android-icon-foreground.png یکسان‌اند. بررسی مولد Expo نشان داد می‌توان foregroundImage را به icon.png متصل کرد و سپس نسخهٔ دوم را حذف کرد؛ دو فایل فیزیکی الزام نیست. هیچ حذف یا تغییر Config انجام نشده است.

[گزارش تکمیلی SHA-256، ارجاعات دقیق و منابع native](duplicate-assets-audit-2026-09-27.md) شامل یک جفت آیکون منبع، پنج جفت Splash تولیدشدهٔ روز/شب و یک جفت XML تولیدشده است و جایگزین نتیجه‌گیری قبلی دربارهٔ حذف Assetهاست. کاهش APK اندازه‌گیری نشده است.

برای فایل‌های رسانه‌ای، نامزد قوی بدون ارجاع پیدا نشد. جست‌وجو محافظه‌کارانه بود و نام فایل در مستندات/تست‌ها نیز ارجاع محسوب شد؛ بنابراین این نتیجه اثبات نمی‌کند همهٔ تصاویر در runtime استفاده می‌شوند. `assets/audio/game/SOURCES.md` سند منبع صداهاست و بدون import بودن آن دلیل حذف نیست.

`expo-clipboard` و `expo-blob` در dependencies هستند، ولی import یا استفادهٔ صریح در سورس پیدا نشد. در lockfile نیز مصرف‌کنندهٔ dependency/peer/optional دیگری برای آن‌ها پیدا نشد. این دو نامزد حذف dependency مستقیم‌اند، با بررسی autolinking و build بعد از حذف. بسته‌های زیرساختی مانند `react-native-reanimated`، `react-native-worklets` و `react-native-web` صرفاً به دلیل نداشتن import مستقیم، اضافی اعلام نشدند.

**نتیجهٔ بررسی‌های اجرایی**

| بررسی | نتیجه |
| --- | --- |
| `npm run typecheck` | موفق |
| `npm run lint` | ۳ خطا و ۱ warning |
| `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | ناموفق؛ بیش از ۵۰ diagnostic مربوط به استفاده‌نشدن |
| `npm run test:shop` | ۳۲ تست دیتابیس/قرارداد موفق؛ UI شامل ۳۸ موفق و ۱۰ ناموفق |
| `npm run test:notifications` | ۵ تست دیتابیس، ۱۴ تست قرارداد/Edge و ۱۳ تست Jest؛ همه موفق |

تست‌های دیتابیس بالا در PGlite محلی اجرا شدند. کل `npm run check`، تست‌های کامل بازی، Edge typecheck و build دستگاه در این بررسی اجرا نشدند. داده یا پیکربندی سرویس ریموت تغییر نکرد.

ترتیب پیشنهادی کار: اصلاح قرارداد ظاهر دومینو و خطای Okey؛ اصلاح CI و اتصال تست‌های جاافتاده؛ رفع lint؛ یکپارچه‌کردن کاتالوگ؛ سپس پاک‌سازی کدهای بی‌مصرف و بررسی آیکون منبع مشترک، با حفظ استقلال Assetهای Shop. فایل‌های بزرگ مانند `okey/server/okey-authoritative.ts` با حدود ۱۶۱۵ خط و `app/domino/game.tsx` با حدود ۱۳۲۶ خط نیز نامزد تقسیم مسئولیت‌اند، اما بزرگی فایل به‌تنهایی به‌عنوان باگ گزارش نشده است.
