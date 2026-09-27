گزارش تکمیلی Duplicate Assetها — ۲۰۲۶-۰۹-۲۷

نتیجه: خارج از کاشی‌های مستقل Okey، در Assetهای منبع فقط یک جفت فایل یکسان پیدا شد: `icon.png` و `android-icon-foreground.png`. دو فایل فیزیکی برای نقش‌های فعلی آن‌ها لازم نیست. در منابع تولیدشدهٔ Android نیز پنج جفت Splash روز/شب و یک جفت XML آیکون یکسان وجود دارد.

هیچ تصویر، منبع native یا Config تغییر یا حذف نشده است. فقط گزارش‌ها به‌روزرسانی شدند.

**دامنهٔ بررسی**

۴۲۱ فایل رسانه‌ای در درخت پروژه پیدا شد؛ ۲۷۵ فایل `assets/cosmetics/okey/*/tiles/*` عمداً از تحلیل حذف‌پذیری خارج شدند. SHA-256 تمام فایل‌های `assets/` به‌جز سند منابع صدا، و تمام فایل‌های `android/app/src/main/res/`، از جمله XMLها، محاسبه شد. جست‌وجوی سایر پوشه‌ها تصاویر، صداها، ویدیوها، فونت‌ها و PDF را پوشش داد؛ فایل‌های فرمت اختصاصی/بدون پسوند خارج این دو مسیر در این شمارش نیستند.

پوشه‌های dependency، cache و build مانند `node_modules`، `.git`، `.expo`، `dist`، `build`، `.gradle`، `.cxx` و `Pods` کنار گذاشته شدند. کپی‌های build/cache فایل منبع قابل پاک‌سازی محصول محسوب نمی‌شوند. پوشهٔ `ios/` در workspace وجود ندارد؛ نیاز iOS از Config و مولد نصب‌شده بررسی شد. پوشهٔ `android/` موجود، generated و در `.gitignore` است؛ منابع آن در Git ثبت نشده‌اند.

| گروه | طبقه‌بندی | نیاز واقعی به فایل مستقل | نتیجه |
| --- | --- | --- | --- |
| کاشی‌های Okey در Setهای مختلف | عمدی؛ محصولات مستقل Shop | طبق طراحی محصول حفظ شوند | هیچ تجمیع یا حذف پیشنهاد نمی‌شود |
| دو PNG آیکون در assets/images | دو نقش با منبع یکسان | خیر | اتصال foreground به icon.png و سپس حذف فایل دوم امکان‌پذیر است |
| پنج جفت Splash روز/شب Android | خروجی عمدی Config تکراری | نسخهٔ night برای ظاهر فعلی لازم نیست | اصلاح dark در Config و بازتولید native |
| دو XML adaptive icon | خروجی عمدی Expo برای دو resource ID | دو ID فعلاً لازم است؛ دو محتوای فیزیکی مستقل الزام نیست | نگه‌داری توصیه می‌شود؛ تجمیع نیازمند alias و plugin است |

**کاشی‌های Okey: عمدی، نه اضافی**

Setهای `classic`، `midnight`، `royal`، `zagros` و `emerald-ivory` محصولات مستقل‌اند. شباهت فعلی تصویر نباید استقلال آیندهٔ آن‌ها را از بین ببرد.

هر مسیر در نگاشت همان Set در هر دو فایل `constants/catalog/okey-sets.ts` و `constants/catalog/tables.ts` reference شده است. شروع نگاشت‌ها در هر دو فایل: classic خط ۷۸، midnight خط ۱۴۰، emerald-ivory خط ۲۰۲، royal خط ۲۶۴، zagros خط ۳۲۶. اتصال registry در خطوط ۳۹۴، ۴۰۶، ۴۱۸، ۴۳۰ و ۴۴۲ انجام می‌شود. مصرف بازی از `useOkeyCosmetics`، `OkeyTileFace` و preload، و مصرف Shop از `constants/catalog/cosmetics.ts` است.

تکرار خود فایل‌های TypeScript کاتالوگ موضوع جداگانه‌ای است؛ حتی در صورت تجمیع آن کدها، Assetهای فیزیکی هر محصول باید مستقل بمانند.

**دو آیکون منبع: یک فایل کافی است**

| فایل | اندازه | ابعاد | تمام ارجاعات مستقیم اجرایی پیدا‌شده |
| --- | --- | --- | --- |
| `assets/images/icon.png` | 475,264 بایت | 512×512 | `app.json:7` برای expo.icon؛ `app.json:56` برای Splash پایه؛ `app.json:60` برای Splash dark |
| `assets/images/android-icon-foreground.png` | 475,264 بایت | 512×512 | فقط `app.json:21` برای android.adaptiveIcon.foregroundImage |

SHA-256 مشترک:

```text
74c2928c75926bea25369477fb10d82289eee807b585ae781722a1d1b9b82db3
```

علت فعلی دو نسخه، جداکردن نام آیکون عمومی از foreground آیکون Android در Config است؛ تاریخچهٔ علت ایجاد اولیه بررسی نشده است. هیچ consumer پیدا نشد که basename ورودی را الزام کند. در کد JSX/JS بازی import مستقیم این دو PNG وجود ندارد. اشاره‌های مستندات مصرف اجرایی محسوب نمی‌شوند.

`app.config.ts` تنظیمات موجود را spread می‌کند و override آیکون ندارد؛ تنظیمات Android نیز حفظ می‌شوند. `eas.json` override آیکون ندارد. پس تغییر همان مسیر در app.json به Config نهایی منتقل می‌شود.

شواهد فنی مستقل از تعداد مسیرهای Config:

- `node_modules/@expo/prebuild-config/build/plugins/icons/withAndroidIcons.js:129` آیکون عمومی را از android.icon یا config.icon می‌گیرد. در خط ۱۵۵، اگر foreground مشخص نباشد، خود Expo آیکون عمومی را برای foreground استفاده می‌کند. بنابراین مجزا بودن فایل ورودی الزام نیست.
- مولد تصویر مسیر ورودی را در src می‌گیرد و خروجی native را با نام‌هایی مانند ic_launcher_foreground.webp می‌سازد؛ اشتراک ورودی مانع تولید خروجی‌های لازم هر نقش نمی‌شود.
- `withIosIcons.js:74` در نبود ios.icon از آیکون عمومی استفاده می‌کند. این پروژه ios.icon ندارد؛ حفظ icon.png ورودی iOS را ثابت نگه می‌دارد.
- Splash نیز همان icon.png را نگه می‌دارد؛ پردازش متفاوت launcher و Splash نیازی به کپی PNG منبع ندارد.

تعریف مسیرهای icon و foregroundImage در [مرجع رسمی Expo Config](https://docs.expo.dev/versions/latest/config/app/) آمده است. نتیجهٔ اشتراک‌پذیری از کد نصب‌شدهٔ مولد به دست آمده است.

تغییر دقیق برای حذف امن آینده:

```diff
- "foregroundImage": "./assets/images/android-icon-foreground.png",
+ "foregroundImage": "./assets/images/icon.png",
```

سپس فقط `assets/images/android-icon-foreground.png` نامزد حذف است. backgroundImage، monochromeImage، رنگ‌ها و ورودی Splash حفظ شوند. هیچ تغییر Java/Kotlin، Manifest، iOS یا runtime لازم نیست. خروجی‌های مستقل native باید همچنان تولید شوند.

اعتبارسنجی هنگام اجرا: بررسی Config نهایی، جست‌وجوی مسیر قدیمی، بازتولید native در محیط مجزا، مقایسهٔ خروجی launcher/foreground قبل و بعد و مشاهدهٔ launcher و Splash در build تازه. با ورودی باینری برابر تغییر بصری انتظار نمی‌رود، ولی build مقایسه‌ای در این بررسی انجام نشده است. صرفه‌جویی فایل منبع 475,264 بایت است؛ این عدد کاهش تضمین‌شدهٔ APK نیست.

**پنج جفت Splash روز/شب Android**

پیشوند کامل تمام مسیرهای جدول: `android/app/src/main/res/`. هر ردیف یک گروه SHA-256 است.

| نسخهٔ پایه | نسخهٔ شب | اندازهٔ هر فایل، بایت | SHA-256 مشترک |
| --- | --- | --- | --- |
| `drawable-mdpi/splashscreen_logo.png` | `drawable-night-mdpi/splashscreen_logo.png` | 81,860 | `aae7f3906f907afb153cc2e5f91f94ff5fa7a81b45b1f68ee94dbe7606203224` |
| `drawable-hdpi/splashscreen_logo.png` | `drawable-night-hdpi/splashscreen_logo.png` | 170,387 | `2289cb586369b0092d9ff1cb7d64938788414de4f7e8f819f18b8e450115fc1d` |
| `drawable-xhdpi/splashscreen_logo.png` | `drawable-night-xhdpi/splashscreen_logo.png` | 286,231 | `0c9ddc80e8c59d52e4c3d0d29fb30dbca414a20a4399c64f1685893910834225` |
| `drawable-xxhdpi/splashscreen_logo.png` | `drawable-night-xxhdpi/splashscreen_logo.png` | 574,828 | `db765075a2613108193422e49d6dac188ebab55fe14f3d98f88886a4bc9f20bc` |
| `drawable-xxxhdpi/splashscreen_logo.png` | `drawable-night-xxxhdpi/splashscreen_logo.png` | 906,377 | `ac92ac765a0acd6e01b79da2002539845d0d487923f2eacc5055d796d5d145c2` |

علت: app.json:56 و app.json:60 تصویر یکسان و رنگ یکسان #050b22 دارند. `expo-splash-screen/plugin/build/withAndroidSplashImages.js:65` light و dark را جدا تولید می‌کند؛ خط ۱۲۴ پوشهٔ مقصد را با theme انتخاب می‌کند.

مصرف دقیق هر دو نسخه در هر ردیف:

- `android/app/src/main/res/values/styles.xml:16`: windowSplashScreenAnimatedIcon به `@drawable/splashscreen_logo` اشاره دارد.
- `android/app/src/main/AndroidManifest.xml:29`: همین Theme.App.SplashScreen را برای MainActivity انتخاب می‌کند.
- `android/app/src/main/res/drawable/ic_launcher_background.xml:4` نیز همین resource را reference می‌کند؛ اما برای خود این XML ارجاع ورودی در منابع فعلی پیدا نشد. این drawable با `@mipmap/ic_launcher_background` مورد استفادهٔ adaptive icon متفاوت است.
- Android با resource ID مشترک، تراکم و night mode نسخه را انتخاب می‌کند؛ نسخهٔ پایه برای حالت عادی/fallback و نسخهٔ night برای شب در همان تراکم است. نبود night اجازهٔ استفاده از نسخهٔ پایه را می‌دهد. [مستندات انتخاب منابع Android](https://developer.android.com/guide/topics/resources/providing-resources).

نسخه‌های night برای ظاهر فعلی لازم نیستند. تراکم‌های مختلف پایه یکسان نیستند و باید حفظ شوند.

تغییر پایدار لازم: از تنظیمات plugin expo-splash-screen در app.json، `dark.image` یکسان حذف شود. حفظ dark.backgroundColor مجاز است. چون رنگ پایه و شب هم برابرند، می‌توان کل بلوک dark فعلی را حذف کرد. تصویر پایه، رنگ پایه و imageWidth:200 حفظ شوند. سپس prebuild منابع را بازتولید کند. `getAndroidSplashConfig.js` در نبود dark.image مسیر تصویر night نمی‌سازد؛ مولد Splash نیز منابع قبلی را قبل از تولید پاک می‌کند. حذف دستی PNGها بدون اصلاح Config باعث بازگشت آن‌ها در prebuild می‌شود.

حذف override ریشهٔ dark روی iOS هم اعمال خواهد شد؛ همان تصویر پایه باقی می‌ماند، ولی خروجی iOS در این workspace موجود نیست و باید حالت روشن/تاریک در build بعدی کنترل شود. حجم مجموع پنج نسخهٔ night روی دیسک 2,019,683 بایت است؛ اثر APK اندازه‌گیری نشده است.

**دو XML adaptive icon: تکرار عمدی مولد**

فایل‌ها:

- `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`
- `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml`

هرکدام 334 بایت؛ SHA-256 مشترک:

```text
4695650219221a8a70d9aa16e683ddfc6587c52ebb465aa43508c94bc9fd6d34
```

مصرف: AndroidManifest.xml:17، android:icon به `@mipmap/ic_launcher` و android:roundIcon به `@mipmap/ic_launcher_round` اشاره می‌کند. در API 26+ این نام‌ها به XML مربوط resolve می‌شوند. هر دو XML در خطوط ۳، ۴ و ۵ به سه resource مشترک `@mipmap/ic_launcher_background`، `@mipmap/ic_launcher_foreground` و `@mipmap/ic_launcher_monochrome` اشاره دارند؛ تصاویر لایه‌ها دوباره کپی نشده‌اند.

علت: withAndroidIcons.js:225 یک رشتهٔ XML می‌سازد و برای دو نام می‌نویسد. دو نقش launcher عمومی/گرد وجود دارد ولی توصیف adaptive یکسان است. rasterهای نسخه‌های قدیمی در پوشه‌های تراکم hash برابر ندارند؛ برابری این XMLها دلیل حذف آن rasterها نیست.

با Manifest فعلی دو resource ID لازم است، اما دو نسخهٔ محتوای XML الزام فنی ندارد. راه تجمیع احتمالی، alias فقط برای API 26+ در `res/values-v26/icon_aliases.xml` است:

```xml
<resources>
  <item type="mipmap" name="ic_launcher_round">@mipmap/ic_launcher</item>
</resources>
```

برای اجرای پایدار، config plugin باید بعد از تولید آیکون Expo، XML گرد در mipmap-anydpi-v26 را حذف و alias را اضافه کند؛ Manifest و rasterهای قدیمی حفظ شوند. حذف بی‌جایگزین XML گرد می‌تواند fallback raster را فعال کند. تغییر مستقیم android:roundIcon به آیکون عمومی نیز ممکن است رفتار Android قدیمی را عوض کند؛ معادل alias نسخه‌دار نیست.

این راه در پروژه اجرا یا تست نشده است. برای 334 بایت، افزودن plugin و هزینهٔ نگه‌داری آن توجیه عملی کمی دارد؛ پیشنهاد نگه‌داشتن خروجی استاندارد Expo است. این تکرار عمدی مولد با PNG منبع اضافی یکسان طبقه‌بندی نمی‌شود.

خارج از Okey Tiles، مجموعاً ۷ گروه یافت شد: یک جفت منبع، پنج جفت PNG تولیدشده و یک جفت XML تولیدشده. در بقیهٔ فایل‌های بررسی‌شده گروه دیگری نبود؛ background و monochrome آیکون هم با جفت PNG منبع برابر نیستند. prebuild، build Android/iOS یا تست ظاهری اجرا نشد. [مستندات CNG Expo](https://docs.expo.dev/workflow/continuous-native-generation/) توضیح می‌دهد منابع native چگونه از Config تولید می‌شوند.
