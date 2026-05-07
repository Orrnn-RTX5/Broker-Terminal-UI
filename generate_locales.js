import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const localesDir = path.join(__dirname, 'src', 'locales');

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
        "insert": {
            "label": "Insert",
            "indicators": "Indicators",
            "objects": "Objects",
            "experts": "Experts",
            "scripts": "Scripts"
        },
        "charts": {
            "label": "Charts",
            "depthOfMarket": "Depth of Market",
            "indicatorList": "Indicator List",
            "objects": "Objects",
            "barChart": "Bar Chart",
            "candlesticks": "Candlesticks",
            "lineChart": "Line Chart",
            "grid": "Grid",
            "autoScroll": "Auto Scroll",
            "chartShift": "Chart Shift",
            "volumes": "Volumes",
            "tickVolumes": "Tick Volumes",
            "zoomIn": "Zoom In",
            "zoomOut": "Zoom Out",
            "properties": "Properties"
        },
        "tools": {
            "label": "Tools",
            "newOrder": "New Order",
            "strategyTester": "Strategy Tester",
            "scriptEditor": "RTX5 Script Editor",
            "agentsManager": "Agents Manager",
            "taskManager": "Task Manager",
            "globalVariables": "Global Variables",
            "marketplace": "RTX5 Marketplace",
            "signalsHub": "RTX5 Signals Hub",
            "cloudHosting": "RTX5 Cloud Hosting",
            "options": "Options"
        },
        "window": {
            "label": "Window",
            "tileWindows": "Tile Windows",
            "cascade": "Cascade",
            "tileHorizontally": "Tile Horizontally",
            "tileVertically": "Tile Vertically",
            "arrangeIcons": "Arrange Icons",
            "resolution": "Resolution"
        },
        "help": {
            "label": "Help",
            "helpTopics": "Help Topics",
            "whatsNew": "What's New",
            "telegramChannel": "RTX5 Telegram Channel",
            "videoGuides": "Video Guides",
            "webTrader": "RTX5 Web Trader",
            "documentation": "RTX5 Documentation",
            "algoBook": "RTX5 AlgoBook",
            "neuroBook": "RTX5 NeuroBook",
            "articles": "RTX5 Articles",
            "codeBase": "RTX5 Code Base",
            "jobs": "RTX5 Jobs",
            "marketplace": "RTX5 Marketplace",
            "signals": "RTX5 Signals",
            "quotes": "RTX5 Quotes",
            "forum": "RTX5 Forum",
            "cloudHosting": "RTX5 Cloud Hosting",
            "mobile": "Mobile",
            "mac": "RTX5 for Mac",
            "linux": "RTX5 for Linux",
            "checkForUpdates": "Check For Updates",
            "about": "About"
        }
    }
};

const translations = {
    de: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Datei", newChart: "Neues Chart", exit: "Beenden" }, view: { ...baseStructure.menu.view, label: "Ansicht" }, help: { ...baseStructure.menu.help, label: "Hilfe" } } },
    fr: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Fichier", newChart: "Nouveau Graphique", exit: "Quitter" }, view: { ...baseStructure.menu.view, label: "Affichage" }, help: { ...baseStructure.menu.help, label: "Aide" } } },
    it: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "File", newChart: "Nuovo Grafico", exit: "Esci" }, view: { ...baseStructure.menu.view, label: "Visualizza" }, help: { ...baseStructure.menu.help, label: "Aiuto" } } },
    "pt-BR": { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Arquivo", newChart: "Novo Gráfico", exit: "Sair" }, view: { ...baseStructure.menu.view, label: "Exibir" }, help: { ...baseStructure.menu.help, label: "Ajuda" } } },
    "pt-PT": { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Ficheiro", newChart: "Novo Gráfico", exit: "Sair" }, view: { ...baseStructure.menu.view, label: "Ver" }, help: { ...baseStructure.menu.help, label: "Ajuda" } } },
    nl: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Bestand", newChart: "Nieuwe Grafiek", exit: "Afsluiten" }, view: { ...baseStructure.menu.view, label: "Beeld" }, help: { ...baseStructure.menu.help, label: "Hulp" } } },
    ru: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Файл", newChart: "Новый график", exit: "Выход" }, view: { ...baseStructure.menu.view, label: "Вид" }, help: { ...baseStructure.menu.help, label: "Справка" } } },
    "zh-CN": { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "文件", newChart: "新图表", exit: "退出" }, view: { ...baseStructure.menu.view, label: "查看" }, help: { ...baseStructure.menu.help, label: "帮助" } } },
    ja: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "ファイル", newChart: "新規チャート", exit: "終了" }, view: { ...baseStructure.menu.view, label: "表示" }, help: { ...baseStructure.menu.help, label: "ヘルプ" } } },
    ko: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "파일", newChart: "새 차트", exit: "종료" }, view: { ...baseStructure.menu.view, label: "보기" }, help: { ...baseStructure.menu.help, label: "도움말" } } },

    // Adding placeholders for others with native names where possible or english fallback with updated labels
    da: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Fil" }, view: { ...baseStructure.menu.view, label: "Vis" }, help: { ...baseStructure.menu.help, label: "Hjælp" } } },
    sv: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Arkiv" }, view: { ...baseStructure.menu.view, label: "Visa" }, help: { ...baseStructure.menu.help, label: "Hjälp" } } },
    fi: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Tiedosto" }, view: { ...baseStructure.menu.view, label: "Näytä" }, help: { ...baseStructure.menu.help, label: "Ohje" } } },
    lt: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Failas" }, view: { ...baseStructure.menu.view, label: "Rodymas" }, help: { ...baseStructure.menu.help, label: "Pagalba" } } },
    lv: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Fails" }, view: { ...baseStructure.menu.view, label: "Skats" }, help: { ...baseStructure.menu.help, label: "Palīdzība" } } },
    et: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Fail" }, view: { ...baseStructure.menu.view, label: "Vaade" }, help: { ...baseStructure.menu.help, label: "Abi" } } },
    pl: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Plik" }, view: { ...baseStructure.menu.view, label: "Widok" }, help: { ...baseStructure.menu.help, label: "Pomoc" } } },
    cs: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Soubor" }, view: { ...baseStructure.menu.view, label: "Zobrazit" }, help: { ...baseStructure.menu.help, label: "Nápověda" } } },
    sk: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Súbor" }, view: { ...baseStructure.menu.view, label: "Zobraziť" }, help: { ...baseStructure.menu.help, label: "Pomocník" } } },
    hu: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Fájl" }, view: { ...baseStructure.menu.view, label: "Nézet" }, help: { ...baseStructure.menu.help, label: "Súgó" } } },
    ro: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Fișier" }, view: { ...baseStructure.menu.view, label: "Vizualizare" }, help: { ...baseStructure.menu.help, label: "Ajutor" } } },
    sl: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Datoteka" }, view: { ...baseStructure.menu.view, label: "Pogled" }, help: { ...baseStructure.menu.help, label: "Pomoč" } } },
    hr: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Datoteka" }, view: { ...baseStructure.menu.view, label: "Pogled" }, help: { ...baseStructure.menu.help, label: "Pomoć" } } },

    bg: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Файл" }, view: { ...baseStructure.menu.view, label: "Изглед" }, help: { ...baseStructure.menu.help, label: "Помощ" } } },
    sr: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Датотека" }, view: { ...baseStructure.menu.view, label: "Приказ" }, help: { ...baseStructure.menu.help, label: "Помоћ" } } },
    mn: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Файл" }, view: { ...baseStructure.menu.view, label: "Харах" }, help: { ...baseStructure.menu.help, label: "Тусламж" } } },

    "zh-TW": { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "檔案", newChart: "新圖表", exit: "退出" }, view: { ...baseStructure.menu.view, label: "檢視" }, help: { ...baseStructure.menu.help, label: "說明" } } },
    id: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Berkas" }, view: { ...baseStructure.menu.view, label: "Tampilan" }, help: { ...baseStructure.menu.help, label: "Bantuan" } } },
    ms: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Fail" }, view: { ...baseStructure.menu.view, label: "Paparan" }, help: { ...baseStructure.menu.help, label: "Bantuan" } } },
    jv: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Berkas" } } },
    vi: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Tập tin" }, view: { ...baseStructure.menu.view, label: "Xem" }, help: { ...baseStructure.menu.help, label: "Trợ giúp" } } },
    th: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "ไฟล์" }, view: { ...baseStructure.menu.view, label: "มุมมอง" }, help: { ...baseStructure.menu.help, label: "ช่วยเหลือ" } } },

    ar: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "ملف" }, view: { ...baseStructure.menu.view, label: "عرض" }, help: { ...baseStructure.menu.help, label: "مساعدة" } } },
    fa: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "پرونده" }, view: { ...baseStructure.menu.view, label: "نما" }, help: { ...baseStructure.menu.help, label: "راهنما" } } },
    he: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "קובץ" }, view: { ...baseStructure.menu.view, label: "תצוגה" }, help: { ...baseStructure.menu.help, label: "עזרה" } } },
    tr: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Dosya" }, view: { ...baseStructure.menu.view, label: "Görünüm" }, help: { ...baseStructure.menu.help, label: "Yardım" } } },
    hi: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "फाइल" }, view: { ...baseStructure.menu.view, label: "देखें" }, help: { ...baseStructure.menu.help, label: "मदद" } } },
    pa: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "ਫਾਇਲ" } } },
    "pa-PK": { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "فائل" } } },
    bn: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "ফাইল" } } },
    mr: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "फाईल" } } },
    sw: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Faili" } } },
    ha: { ...baseStructure, menu: { ...baseStructure.menu, file: { ...baseStructure.menu.file, label: "Fayil" } } }
};

Object.keys(translations).forEach(lang => {
    const dir = path.join(localesDir, lang);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
        path.join(dir, 'translation.json'),
        JSON.stringify(translations[lang], null, 2)
    );
    console.log(`Created ${lang}/translation.json`);
});
