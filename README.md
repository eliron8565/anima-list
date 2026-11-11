# WatchVault — אנימה וסדרות

אפליקציית HTML + CSS + Vanilla JavaScript בעברית (RTL), עם Firebase Realtime Database ו-SDK מודולרי v9. כל מי שפותח את האתר רואה את אותה ספרייה בזמן אמת, ויכול להוסיף כותר, לדרג, לסמן "צפיתי" ולמחוק.

**ללא npm, ללא שרת וללא build.** GitHub Pages מארח את הקבצים הסטטיים. Firebase שומר ומסנכרן את הנתונים.

## קבצים

- **index.html** — מבנה ממשק בעברית, טופס הוספה וחיפוש.
- **styles.css** — עיצוב כהה, Glassmorphism, כרטיסי פוסטר ופריסה רספונסיבית.
- **app.js** — קוד Vanilla JS ו-Firebase v9 Modular.
- **firebase-config.js** — **כאן מדביקים את פרטי פרויקט Firebase שלך**.
- **database.rules.json** — כללי האבטחה שיש להדביק ב-Firebase Console.

## 1. הקמת פרויקט Firebase

1. כנסו ל-[Firebase Console](https://console.firebase.google.com/) ולחצו **Create project / Add project**.
2. בחרו שם (למשל WatchVault) והשלימו את יצירת הפרויקט. Google Analytics אינו נחוץ לאפליקציה הזאת.
3. בחרו **Build → Realtime Database → Create Database**, בחרו אזור והפעילו **Locked mode** (מצב נעול). **אל תשאירו את Test mode פתוח.**
4. במסך **Realtime Database → Data**, העתיקו את כתובת בסיס הנתונים (לדוגמה https://your-project-default-rtdb.europe-west1.firebasedatabase.app). הכתובת חייבת להיות מדויקת; היא לא תמיד firebaseio.com.
5. בחרו **Build → Authentication → Get started → Sign-in method → Anonymous → Enable → Save**. הדבר מאפשר שימוש בלי ליצור חשבונות אישיים, ובמקביל דורש זיהוי אנונימי לפני כתיבה.
6. בחרו גלגל שיניים ליד Project Overview → **Project settings → General → Your apps → Web (</>)**. רשמו אפליקציית Web והעתיקו את אובייקט firebaseConfig (אפשר לבחור באפשרות Config, בלי התקנת npm).
7. פתחו את **firebase-config.js** והחליפו את כל הערכים לדוגמה בערכים האמיתיים. **ודאו שהגדרתם databaseURL בהתאם לכתובת שהעתקתם בשלב 4.**
8. ב-**Realtime Database → Rules**, החליפו את כל התוכן בתוכן הקובץ [database.rules.json](./database.rules.json) ולחצו **Publish**.
   **אם כבר הגדרתם את הכללים בעבר, חשוב לפרסם אותם שוב אחרי העדכון הזה** כדי לאפשר סדרות ללא קישור לצפייה וללא תמונה.
9. אם Firebase Authentication מבקש הגדרת דומיין מורשה, הוסיפו ב-**Authentication → Settings → Authorized domains** את eliron8565.github.io.

> האפליקציה עובדת עם מסד נתונים משותף אחד. כל משתמש אנונימי יכול לדרג, לשנות סטטוס ולמחוק כל סדרה. זה מתאים לספרייה ציבורית/ניסוי, **לא לרשימה פרטית או לעבודה עם משתמשים לא מהימנים**. Anonymous Auth לבדו אינו מונע השחתה או ספאם. לפרויקט ציבורי רציני יש להוסיף הרשאות לפי משתמש/מנהל, מגבלות קצב, App Check ובקרת תוכן.

**Firebase Config אינו סיסמת שרת.** הוא נשלח לדפדפן בכל מקרה, אבל כללי האבטחה הם שמגנים על המסד. לעולם אל תפרסמו Service Account Key או מפתחות של צד שרת.

## 2. פרסום בחינם דרך GitHub Pages

מאגר היעד: https://github.com/eliron8565/anima-list

אם הקבצים עדיין אינם במאגר, במסך **Code** של GitHub בחרו **Add file → Upload files**, העלו את כל קובצי הפרויקט לשורש המאגר ולחצו **Commit changes**. כשמעדכנים Firebase Config, ערכו את הקובץ **firebase-config.js** במאגר ושמרו ב-Commit.

1. פתחו https://github.com/eliron8565/anima-list/settings/pages
2. באזור **Build and deployment** הגדירו **Source: Deploy from a branch**.
3. תחת **Branch**, בחרו **main**, ותיקייה **/(root)**.
4. לחצו **Save**.
5. כשפרסום האתר הסתיים, כתובת האתר תהיה:
   **https://eliron8565.github.io/anima-list/**

אם האתר לא עולה מיד, בדקו את תהליך הפרסום בלשונית **Actions** של GitHub. פרסום עשוי לקחת מספר דקות.

## 3. בדיקה

1. בקרו באתר אחרי שפרסמתם והגדרתם את Firebase Config ואת Rules.
2. הוסיפו סדרה עם **שם בלבד**. קישור לפוסטר וקישור לצפייה הם **לא חובה**. אם אין פוסטר יוצג עיצוב חלופי; אם אין קישור צפייה, כפתור Play לא יוצג. קישורים שמוזנים חייבים להתחיל ב־HTTPS.
3. פתחו את האתר בשני דפדפנים שונים. הוספה, מחיקה, דירוג ושינוי "צפיתי" אמורים להופיע בשניהם בזמן אמת.
4. אם מופיעה הודעת חיבור או שגיאת הרשאה, פתחו כלי מפתחים בדפדפן (F12 → Console), וודאו ש-Anonymous Authentication פועל, שכתובת databaseURL נכונה וש-Rules פורסמו.

### הרצה מקומית

הקוד משתמש ב-JavaScript modules, לכן רצוי לשרת אותו ב-HTTP ולא לפתוח את index.html דרך file://.

מתוך תיקיית הפרויקט:

~~~bash
python -m http.server 8000
~~~

ואז פתחו http://localhost:8000/ בדפדפן.

## הערות

- SDK: Firebase JavaScript **9.23.0** דרך CDN מודולרי של Firebase (gstatic).
- גופנים ואייקונים נטענים מ-Google Fonts ומ-Font Awesome CDN; נדרש חיבור לאינטרנט.
- נתוני הסדרות אינם נשמרים ב-GitHub; GitHub Pages מאחסן רק את ממשק האפליקציה.
- מבקרים שבוחרים בקישור צפייה יוצאים לאתר חיצוני, ולכן כדאי לשתף רק קישורים חוקיים ומהימנים.
- אפשר להתחיל ברמת שימוש חינמית, בכפוף למכסות ולתנאי הזכאות של Firebase ו-GitHub.
