import fs from 'node:fs';
const keys = ['Minimize a floating window before arranging icons', 'Display resolution is controlled by your operating system', 'When floating windows are minimized'];
const translations = {
  en: keys,
  de: ['Minimieren Sie ein schwebendes Fenster, bevor Sie die Symbole anordnen', 'Die Bildschirmauflösung wird durch Ihr Betriebssystem gesteuert', 'Wenn schwebende Fenster minimiert sind'],
  fr: ['Réduisez une fenêtre flottante avant d’organiser les icônes', 'La résolution de l’écran est gérée par votre système d’exploitation', 'Lorsque des fenêtres flottantes sont réduites'],
  es: ['Minimice una ventana flotante antes de organizar los iconos', 'El sistema operativo controla la resolución de pantalla', 'Cuando hay ventanas flotantes minimizadas'],
  it: ['Riduci a icona una finestra mobile prima di disporre le icone', 'La risoluzione dello schermo è gestita dal sistema operativo', 'Quando le finestre mobili sono ridotte a icona'],
  'pt-BR': ['Minimize uma janela flutuante antes de organizar os ícones', 'A resolução da tela é controlada pelo sistema operacional', 'Quando há janelas flutuantes minimizadas'],
  nl: ['Minimaliseer een zwevend venster voordat u de pictogrammen schikt', 'De schermresolutie wordt door uw besturingssysteem geregeld', 'Wanneer zwevende vensters zijn geminimaliseerd'],
  pl: ['Zminimalizuj pływające okno przed rozmieszczeniem ikon', 'Rozdzielczość ekranu jest ustawiana w systemie operacyjnym', 'Gdy pływające okna są zminimalizowane'],
  tr: ['Simgeleri düzenlemeden önce bir yüzen pencereyi simge durumuna küçültün', 'Ekran çözünürlüğü işletim sisteminiz tarafından yönetilir', 'Yüzen pencereler simge durumuna küçültüldüğünde'],
  ru: ['Сверните плавающее окно перед упорядочиванием значков', 'Разрешением экрана управляет операционная система', 'Когда плавающие окна свёрнуты'],
  'zh-CN': ['请先最小化一个浮动窗口，再排列图标', '显示分辨率由操作系统控制', '浮动窗口已最小化时'],
  'zh-TW': ['請先最小化一個浮動視窗，再排列圖示', '顯示解析度由作業系統控制', '浮動視窗已最小化時'],
  ja: ['アイコンを整列する前にフローティングウィンドウを最小化してください', '画面の解像度はオペレーティングシステムで設定します', 'フローティングウィンドウが最小化されているとき'],
  ko: ['아이콘을 정렬하기 전에 떠 있는 창을 최소화하세요', '화면 해상도는 운영 체제에서 설정합니다', '떠 있는 창이 최소화되어 있을 때'],
  id: ['Minimalkan jendela mengambang sebelum menata ikon', 'Resolusi layar diatur oleh sistem operasi Anda', 'Saat jendela mengambang diminimalkan'],
  vi: ['Thu nhỏ cửa sổ nổi trước khi sắp xếp biểu tượng', 'Độ phân giải màn hình được quản lý bởi hệ điều hành', 'Khi các cửa sổ nổi được thu nhỏ'],
  th: ['ย่อหน้าต่างลอยก่อนจัดเรียงไอคอน', 'ความละเอียดหน้าจอควบคุมโดยระบบปฏิบัติการของคุณ', 'เมื่อหน้าต่างลอยถูกย่ออยู่'],
  ar: ['صغّر نافذة عائمة قبل ترتيب الأيقونات', 'يتحكم نظام التشغيل في دقة العرض', 'عندما تكون النوافذ العائمة مصغّرة'],
  hi: ['आइकन व्यवस्थित करने से पहले किसी फ़्लोटिंग विंडो को छोटा करें', 'डिस्प्ले रिज़ॉल्यूशन आपके ऑपरेटिंग सिस्टम से नियंत्रित होता है', 'जब फ़्लोटिंग विंडो छोटी की गई हों'],
};
for (const [language, values] of Object.entries(translations)) {
  if (values.length !== keys.length || values.some(value => !value.trim())) throw new Error(`Incomplete ${language}`);
  const path = `src/locales/${language}/ui.json`;
  const catalog = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (!catalog['Arrange Icons']) throw new Error(`Arrange Icons missing: ${language}`);
  keys.forEach((key, index) => { catalog[key] = values[index]; });
  fs.writeFileSync(path, JSON.stringify(catalog, null, 2) + '\n');
}
console.log(`Translated ${keys.length} window labels in ${Object.keys(translations).length} languages; existing Arrange Icons checked.`);
