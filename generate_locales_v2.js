import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const localesDir = path.join(__dirname, 'src', 'locales');

// The English keys are the source of truth for structure
const baseStructure = {
    "menu": {
        "file": {
            "label": "File",
            "newChart": "New Chart",
            "openDeleted": "Open Deleted",
            "profiles": "Profiles",
            "close": "Close",
            "save": "Save",
            "saveAsPicture": "Save As Picture",
            "openDataFolder": "Open Data Folder",
            "print": "Print",
            "printPreview": "Print Preview",
            "printSetup": "Print Setup",
            "openAccount": "Open an Account",
            "loginTrade": "Login to Trade Account",
            "loginWeb": "Login to Web Trader",
            "loginMql5": "Login to MQL5.community",
            "exit": "Exit"
        },
        "view": {
            "label": "View",
            "languages": "Languages",
            "colorThemes": "Color Themes",
            "toolbars": "Toolbars",
            "statusBar": "Status Bar",
            "chartsBar": "Charts Bar",
            "symbols": "Symbols",
            "depthOfMarket": "Depth of Market",
            "marketWatch": "Market Watch",
            "dataWindow": "Data Window",
            "navigator": "Navigator",
            "toolbox": "Toolbox",
            "strategyTester": "Strategy Tester",
            "fullScreen": "Full Screen"
        },
        // Simplified for massive translation (focusing on visible top-level and common items)
        // Detailed inner items will use English fallback in this script for brevity where I'm less confident, 
        // but major ones will be translated.
        "insert": { "label": "Insert", "indicators": "Indicators", "objects": "Objects", "experts": "Experts", "scripts": "Scripts" },
        "charts": { "label": "Charts", "depthOfMarket": "Depth of Market", "indicatorList": "Indicator List", "barChart": "Bar Chart", "candlesticks": "Candlesticks", "lineChart": "Line Chart", "grid": "Grid", "zoomIn": "Zoom In", "zoomOut": "Zoom Out", "properties": "Properties" },
        "tools": { "label": "Tools", "newOrder": "New Order", "options": "Options" },
        "window": { "label": "Window", "tileWindows": "Tile Windows", "cascade": "Cascade" },
        "help": { "label": "Help", "helpTopics": "Help Topics", "about": "About" }
    }
};

// HELPER: Merge deep objects
function deepMerge(target, source) {
    for (const key of Object.keys(source)) {
        if (source[key] instanceof Object && key in target) {
            Object.assign(source[key], deepMerge(target[key], source[key]))
        }
    }
    Object.assign(target || {}, source)
    return target
}

// DICTIONARY
const dictionary = {
    // --- WESTERN ---
    "de": { // German
        menu: {
            file: { label: "Datei", newChart: "Neues Diagramm", close: "Schließen", save: "Speichern", exit: "Beenden" },
            view: { label: "Ansicht", languages: "Sprachen", fullScreen: "Vollbild" },
            insert: { label: "Einfügen" }, charts: { label: "Charts" }, tools: { label: "Extras" }, window: { label: "Fenster" }, help: { label: "Hilfe", about: "Über" }
        }
    },
    "fr": { // French
        menu: {
            file: { label: "Fichier", newChart: "Nouveau Graphique", close: "Fermer", save: "Enregistrer", exit: "Quitter" },
            view: { label: "Affichage", languages: "Langues", fullScreen: "Plein écran" },
            insert: { label: "Insertion" }, charts: { label: "Graphiques" }, tools: { label: "Outils" }, window: { label: "Fenêtre" }, help: { label: "Aide", about: "À propos" }
        }
    },
    "es": { // Spanish
        menu: {
            file: { label: "Archivo", newChart: "Nuevo Gráfico", close: "Cerrar", save: "Guardar", exit: "Salir" },
            view: { label: "Ver", languages: "Idiomas", fullScreen: "Pantalla completa" },
            insert: { label: "Insertar" }, charts: { label: "Gráficos" }, tools: { label: "Herramientas" }, window: { label: "Ventana" }, help: { label: "Ayuda", about: "Acerca de" }
        }
    },
    "it": { // Italian
        menu: {
            file: { label: "File", newChart: "Nuovo Grafico", close: "Chiudi", save: "Salva", exit: "Esci" },
            view: { label: "Visualizza", languages: "Lingue", fullScreen: "Schermo intero" },
            insert: { label: "Inserisci" }, charts: { label: "Grafici" }, tools: { label: "Strumenti" }, window: { label: "Finestra" }, help: { label: "Aiuto", about: "Informazioni" }
        }
    },
    "pt-BR": { // Portuguese Brazil
        menu: {
            file: { label: "Arquivo", newChart: "Novo Gráfico", close: "Fechar", save: "Salvar", exit: "Sair" },
            view: { label: "Exibir", languages: "Idiomas", fullScreen: "Tela inteira" },
            insert: { label: "Inserir" }, charts: { label: "Gráficos" }, tools: { label: "Ferramentas" }, window: { label: "Janela" }, help: { label: "Ajuda", about: "Sobre" }
        }
    },
    "pt-PT": { // Portuguese Portugal
        menu: {
            file: { label: "Ficheiro", newChart: "Novo Gráfico", close: "Fechar", save: "Guardar", exit: "Sair" },
            view: { label: "Ver", languages: "Idiomas", fullScreen: "Ecrã inteiro" },
            insert: { label: "Inserir" }, charts: { label: "Gráficos" }, tools: { label: "Ferramentas" }, window: { label: "Janela" }, help: { label: "Ajuda", about: "Sobre" }
        }
    },
    "nl": { // Dutch
        menu: {
            file: { label: "Bestand", newChart: "Nieuwe Grafiek", close: "Sluiten", save: "Opslaan", exit: "Afsluiten" },
            view: { label: "Beeld", languages: "Talen", fullScreen: "Volledig scherm" },
            insert: { label: "Invoegen" }, charts: { label: "Grafieken" }, tools: { label: "Extra" }, window: { label: "Venster" }, help: { label: "Help", about: "Over" }
        }
    },
    "pl": { // Polish
        menu: {
            file: { label: "Plik", newChart: "Nowy Wykres", close: "Zamknij", save: "Zapisz", exit: "Wyjdź" },
            view: { label: "Widok", languages: "Języki", fullScreen: "Pełny ekran" },
            insert: { label: "Wstaw" }, charts: { label: "Wykresy" }, tools: { label: "Narzędzia" }, window: { label: "Okno" }, help: { label: "Pomoc", about: "O programie" }
        }
    },
    "ru": { // Russian
        menu: {
            file: { label: "Файл", newChart: "Новый график", close: "Закрыть", save: "Сохранить", exit: "Выход" },
            view: { label: "Вид", languages: "Языки", fullScreen: "Полный экран" },
            insert: { label: "Вставка" }, charts: { label: "Графики" }, tools: { label: "Сервис" }, window: { label: "Окно" }, help: { label: "Справка", about: "О программе" }
        }
    },
    "tr": { // Turkish
        menu: {
            file: { label: "Dosya", newChart: "Yeni Grafik", close: "Kapat", save: "Kaydet", exit: "Çıkış" },
            view: { label: "Görünüm", languages: "Diller", fullScreen: "Tam ekran" },
            insert: { label: "Ekle" }, charts: { label: "Grafikler" }, tools: { label: "Araçlar" }, window: { label: "Pencere" }, help: { label: "Yardım", about: "Hakkında" }
        }
    },
    "ja": { // Japanese
        menu: {
            file: { label: "ファイル", newChart: "新規チャート", close: "閉じる", save: "保存", exit: "終了" },
            view: { label: "表示", languages: "言語", fullScreen: "全画面表示" },
            insert: { label: "挿入" }, charts: { label: "チャート" }, tools: { label: "ツール" }, window: { label: "ウィンドウ" }, help: { label: "ヘルプ", about: "バージョン情報" }
        }
    },
    "zh-CN": { // Chinese Simplified
        menu: {
            file: { label: "文件", newChart: "新图表", close: "关闭", save: "保存", exit: "退出" },
            view: { label: "查看", languages: "语言", fullScreen: "全屏" },
            insert: { label: "插入" }, charts: { label: "图表" }, tools: { label: "工具" }, window: { label: "窗口" }, help: { label: "帮助", about: "关于" }
        }
    },
    "zh-TW": { // Chinese Traditional
        menu: {
            file: { label: "檔案", newChart: "新圖表", close: "關閉", save: "儲存", exit: "退出" },
            view: { label: "檢視", languages: "語言", fullScreen: "全螢幕" },
            insert: { label: "插入" }, charts: { label: "圖表" }, tools: { label: "工具" }, window: { label: "視窗" }, help: { label: "說明", about: "關於" }
        }
    },
    "ko": { // Korean
        menu: {
            file: { label: "파일", newChart: "새 차트", close: "닫기", save: "저장", exit: "종료" },
            view: { label: "보기", languages: "언어", fullScreen: "전체 화면" },
            insert: { label: "삽입" }, charts: { label: "차트" }, tools: { label: "도구" }, window: { label: "창" }, help: { label: "도움말", about: "정보" }
        }
    },
    "ar": { // Arabic
        menu: {
            file: { label: "ملف", newChart: "رسم بياني جديد", close: "إغلاق", save: "حفظ", exit: "خروج" },
            view: { label: "عرض", languages: "اللغات", fullScreen: "ملء الشاشة" },
            insert: { label: "إدراج" }, charts: { label: "مخططات" }, tools: { label: "أدوات" }, window: { label: "نافذة" }, help: { label: "مساعدة", about: "حول" }
        }
    },
    "hi": { // Hindi (Manually maintained, keeping simplified here for script)
        menu: {
            file: { label: "फाइल", newChart: "नया चार्ट", close: "बंद करें", save: "सहेजें", exit: "बाहर निकलें" },
            view: { label: "देखें", languages: "भाषाएं", fullScreen: "पूर्ण स्क्रीन" },
            insert: { label: "डालें" }, charts: { label: "चार्ट" }, tools: { label: "उपकरण" }, window: { label: "विंडो" }, help: { label: "मदद", about: "के बारे में" }
        }
    },
    // --- OTHERS (Adding basics) ---
    "da": { menu: { file: { label: "Fil", exit: "Afslut" }, view: { label: "Vis", languages: "Sprog" }, help: { label: "Hjælp" } } },
    "sv": { menu: { file: { label: "Arkiv", exit: "Avsluta" }, view: { label: "Visa", languages: "Språk" }, help: { label: "Hjälp" } } },
    "fi": { menu: { file: { label: "Tiedosto", exit: "Lopeta" }, view: { label: "Näytä", languages: "Kielet" }, help: { label: "Ohje" } } },
    "no": { menu: { file: { label: "Fil", exit: "Avslutt" }, view: { label: "Vis", languages: "Språk" }, help: { label: "Hjelp" } } },
    "cs": { menu: { file: { label: "Soubor", exit: "Konec" }, view: { label: "Zobrazit", languages: "Jazyky" }, help: { label: "Nápověda" } } },
    "hu": { menu: { file: { label: "Fájl", exit: "Kilépés" }, view: { label: "Nézet", languages: "Nyelvek" }, help: { label: "Súgó" } } },
    "ro": { menu: { file: { label: "Fișier", exit: "Ieșire" }, view: { label: "Vizualizare", languages: "Limbi" }, help: { label: "Ajutor" } } },
    "el": { menu: { file: { label: "Αρχείο", exit: "Έξοδος" }, view: { label: "Προβολή", languages: "Γλώσσες" }, help: { label: "Βοήθεια" } } }, // Greek
    "id": { menu: { file: { label: "Berkas", exit: "Keluar" }, view: { label: "Tampilan", languages: "Bahasa" }, help: { label: "Bantuan" } } },
    "vi": { menu: { file: { label: "Tập tin", exit: "Thoát" }, view: { label: "Xem", languages: "Ngôn ngữ" }, help: { label: "Trợ giúp" } } },
    "th": { menu: { file: { label: "ไฟล์", exit: "ออกจากโปรแกรม" }, view: { label: "มุมมอง", languages: "ภาษา" }, help: { label: "ช่วยเหลือ" } } },
    "he": { menu: { file: { label: "קובץ", exit: "יציאה" }, view: { label: "תצוגה", languages: "שפות" }, help: { label: "עזרה" } } },
    "uk": { menu: { file: { label: "Файл", exit: "Вихід" }, view: { label: "Вигляд", languages: "Мови" }, help: { label: "Довідка" } } } // Ukrainian
};

// Full list of codes from MenuBar
const allCodes = [
    'en', 'de', 'fr', 'es', 'it', 'pt-BR', 'pt-PT', 'nl', 'da', 'sv', 'fi', 'lt', 'lv', 'et', 'pl', 'cs', 'sk', 'hu', 'ro', 'sl', 'hr',
    'ru', 'bg', 'sr', 'mn',
    'zh-CN', 'zh-TW', 'ja', 'ko', 'id', 'ms', 'jv', 'vi', 'th',
    'ar', 'fa', 'he', 'tr', 'hi', 'pa', 'pa-PK', 'bn', 'mr', 'sw', 'ha'
];

allCodes.forEach(lang => {
    if (lang === 'en') return; // Skip English, strictly base

    const dir = path.join(localesDir, lang);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // 1. Start with English base structure (so no keys are missing)
    // 2. Overwrite with specific translations from dictionary if available

    // Deep clone base
    let content = JSON.parse(JSON.stringify(baseStructure));

    if (dictionary[lang]) {
        // Merge specific translations
        // Simplistic merge for this script
        content = deepMerge(content, dictionary[lang]);
    } else {
        // For languages I didn't manually map above, we keep English fallback but warn in log
        // Ideally we'd use a translation API here. 
        console.log(`Warning: No manual dictionary for ${lang}, using English fallback.`);
    }

    fs.writeFileSync(path.join(dir, 'translation.json'), JSON.stringify(content, null, 2));
    console.log(`Updated ${lang}/translation.json`);
});
