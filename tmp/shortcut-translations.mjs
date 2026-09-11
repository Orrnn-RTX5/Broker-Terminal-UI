import fs from 'node:fs';

const keys = ['Clear search', 'Documentation is not configured for this deployment', 'Drag', 'Emojis, Icons and Stamps', 'Finish drawing', 'In Last Symbol', 'Navigation', 'On the chart', 'Redo layout', 'Space', 'Undo layout', 'While drawing a path or ghost feed', '{{value0}} shortcuts'];
const rows = {
  de: ['Suche löschen', 'Für diese Bereitstellung ist keine Dokumentation konfiguriert', 'Ziehen', 'Emojis, Symbole und Stempel', 'Zeichnung abschließen', 'Im Bereich „Letztes Symbol“', 'Navigation', 'Im Chart', 'Layout wiederherstellen', 'Leertaste', 'Layoutänderung rückgängig machen', 'Beim Zeichnen eines Pfads oder Ghost-Feeds', '{{value0}} Tastenkürzel'],
  fr: ['Effacer la recherche', 'La documentation n’est pas configurée pour ce déploiement', 'Glisser', 'Émojis, icônes et tampons', 'Terminer le dessin', 'Dans « Dernier symbole »', 'Navigation', 'Sur le graphique', 'Rétablir la disposition', 'Espace', 'Annuler la modification de disposition', 'Lors du tracé d’un chemin ou d’un flux fantôme', '{{value0}} raccourcis'],
  es: ['Borrar búsqueda', 'La documentación no está configurada para este despliegue', 'Arrastrar', 'Emojis, iconos y sellos', 'Finalizar dibujo', 'En «Último símbolo»', 'Navegación', 'En el gráfico', 'Rehacer diseño', 'Espacio', 'Deshacer cambio de diseño', 'Al dibujar un trazado o una proyección fantasma', '{{value0}} atajos'],
  it: ['Cancella ricerca', 'La documentazione non è configurata per questa distribuzione', 'Trascina', 'Emoji, icone e timbri', 'Completa disegno', 'In «Ultimo simbolo»', 'Navigazione', 'Sul grafico', 'Ripristina disposizione', 'Spazio', 'Annulla modifica della disposizione', 'Durante il disegno di un percorso o di una proiezione fantasma', '{{value0}} scorciatoie'],
  'pt-BR': ['Limpar pesquisa', 'A documentação não está configurada para esta implantação', 'Arrastar', 'Emojis, ícones e carimbos', 'Concluir desenho', 'Em “Último Símbolo”', 'Navegação', 'No gráfico', 'Refazer layout', 'Espaço', 'Desfazer alteração de layout', 'Ao desenhar um caminho ou uma projeção fantasma', '{{value0}} atalhos'],
  nl: ['Zoekopdracht wissen', 'Er is geen documentatie ingesteld voor deze implementatie', 'Slepen', 'Emoji’s, pictogrammen en stempels', 'Tekening voltooien', 'In ‘Laatste symbool’', 'Navigatie', 'Op de grafiek', 'Indeling opnieuw toepassen', 'Spatie', 'Indelingswijziging ongedaan maken', 'Tijdens het tekenen van een pad of spookfeed', '{{value0}} sneltoetsen'],
  pl: ['Wyczyść wyszukiwanie', 'Dokumentacja nie została skonfigurowana dla tego wdrożenia', 'Przeciągnij', 'Emoji, ikony i stemple', 'Zakończ rysowanie', 'W panelu „Ostatni symbol”', 'Nawigacja', 'Na wykresie', 'Ponów zmianę układu', 'Spacja', 'Cofnij zmianę układu', 'Podczas rysowania ścieżki lub kanału widmowego', 'Skróty klawiszowe: {{value0}}'],
  tr: ['Aramayı temizle', 'Bu dağıtım için belgeler yapılandırılmamış', 'Sürükle', 'Emojiler, simgeler ve damgalar', 'Çizimi tamamla', '“Son Sembol” panelinde', 'Gezinme', 'Grafik üzerinde', 'Düzen değişikliğini yinele', 'Boşluk', 'Düzen değişikliğini geri al', 'Yol veya hayalet beslemesi çizerken', '{{value0}} kısayol'],
  ru: ['Очистить поиск', 'Документация для этого развёртывания не настроена', 'Перетаскивание', 'Эмодзи, значки и штампы', 'Завершить рисование', 'В панели «Последний символ»', 'Навигация', 'На графике', 'Повторить изменение расположения', 'Пробел', 'Отменить изменение расположения', 'При рисовании пути или призрачного канала', 'Сочетаний клавиш: {{value0}}'],
  'zh-CN': ['清除搜索', '此部署尚未配置文档', '拖动', '表情、图标和图章', '完成绘图', '在“最后一个符号”面板中', '导航', '在图表上', '重做布局更改', '空格', '撤销布局更改', '绘制路径或幽灵走势时', '{{value0}} 个快捷键'],
  'zh-TW': ['清除搜尋', '此部署尚未設定文件', '拖曳', '表情符號、圖示與圖章', '完成繪圖', '在「最後一個符號」面板中', '導覽', '在圖表上', '重做版面配置變更', '空白鍵', '復原版面配置變更', '繪製路徑或幽靈走勢時', '{{value0}} 個快捷鍵'],
  ja: ['検索をクリア', 'この環境にはドキュメントが設定されていません', 'ドラッグ', '絵文字、アイコン、スタンプ', '描画を完了', '「最後のシンボル」パネル内', 'ナビゲーション', 'チャート上', 'レイアウト変更をやり直す', 'スペース', 'レイアウト変更を元に戻す', 'パスまたはゴーストフィードの描画中', 'ショートカット {{value0}} 件'],
  ko: ['검색 지우기', '이 배포 환경에는 문서가 설정되어 있지 않습니다', '드래그', '이모지, 아이콘 및 스탬프', '그리기 완료', '최근 종목 패널에서', '탐색', '차트에서', '레이아웃 변경 다시 실행', '스페이스', '레이아웃 변경 실행 취소', '경로 또는 고스트 피드를 그리는 동안', '단축키 {{value0}}개'],
  id: ['Hapus pencarian', 'Dokumentasi belum dikonfigurasi untuk penerapan ini', 'Seret', 'Emoji, ikon, dan stempel', 'Selesaikan gambar', 'Di panel Simbol Terakhir', 'Navigasi', 'Pada grafik', 'Ulangi perubahan tata letak', 'Spasi', 'Batalkan perubahan tata letak', 'Saat menggambar jalur atau proyeksi bayangan', '{{value0}} pintasan'],
  vi: ['Xóa tìm kiếm', 'Chưa cấu hình tài liệu cho bản triển khai này', 'Kéo', 'Biểu tượng cảm xúc, biểu tượng và dấu', 'Hoàn tất vẽ', 'Trong bảng “Biểu tượng cuối cùng”', 'Điều hướng', 'Trên biểu đồ', 'Làm lại thay đổi bố cục', 'Dấu cách', 'Hoàn tác thay đổi bố cục', 'Khi vẽ đường dẫn hoặc diễn biến giá giả định', '{{value0}} phím tắt'],
  th: ['ล้างการค้นหา', 'ยังไม่ได้ตั้งค่าเอกสารสำหรับการติดตั้งนี้', 'ลาก', 'อีโมจิ ไอคอน และตราประทับ', 'วาดให้เสร็จ', 'ในแผงสัญลักษณ์สุดท้าย', 'การนำทาง', 'บนกราฟ', 'ทำซ้ำการเปลี่ยนเค้าโครง', 'เว้นวรรค', 'เลิกทำการเปลี่ยนเค้าโครง', 'ขณะวาดเส้นทางหรือฟีดผี', 'แป้นพิมพ์ลัด {{value0}} รายการ'],
  ar: ['مسح البحث', 'لم يتم إعداد الوثائق لهذا النشر', 'سحب', 'الرموز التعبيرية والأيقونات والأختام', 'إنهاء الرسم', 'في لوحة «الرمز الأخير»', 'التنقل', 'على الرسم البياني', 'إعادة تغيير التخطيط', 'مسافة', 'التراجع عن تغيير التخطيط', 'أثناء رسم مسار أو تغذية شبحية', 'عدد اختصارات لوحة المفاتيح: {{value0}}'],
  hi: ['खोज साफ़ करें', 'इस परिनियोजन के लिए दस्तावेज़ कॉन्फ़िगर नहीं किए गए हैं', 'खींचें', 'इमोजी, आइकन और स्टैम्प', 'आरेख पूरा करें', '“अंतिम प्रतीक” पैनल में', 'नेविगेशन', 'चार्ट पर', 'लेआउट बदलाव फिर से करें', 'स्पेस', 'लेआउट बदलाव पूर्ववत करें', 'पथ या घोस्ट फ़ीड बनाते समय', '{{value0}} शॉर्टकट'],
};
for (const [language, values] of Object.entries(rows)) {
  if (values.length !== keys.length) throw new Error(`Invalid translation row ${language}`);
}
const printPreviewScopes = {
  de: 'In der Druckvorschau', fr: 'Dans l’aperçu avant impression', es: 'En la vista previa de impresión',
  it: 'Nell’anteprima di stampa', 'pt-BR': 'Na visualização de impressão', nl: 'In het afdrukvoorbeeld',
  pl: 'W podglądzie wydruku', tr: 'Baskı Önizleme ekranında', ru: 'В окне предварительного просмотра печати',
  'zh-CN': '在打印预览中', 'zh-TW': '在列印預覽中', ja: '印刷プレビュー内', ko: '인쇄 미리보기에서',
  id: 'Di Pratinjau Cetak', vi: 'Trong bản xem trước khi in', th: 'ในตัวอย่างก่อนพิมพ์',
  ar: 'في معاينة الطباعة', hi: 'प्रिंट पूर्वावलोकन में',
};
fs.writeFileSync('tmp/shortcut-translations.json', JSON.stringify(Object.fromEntries(Object.entries(rows).map(([language, values]) => [language, {
  ...Object.fromEntries(keys.map((key, index) => [key, values[index]])), 'In Print Preview': printPreviewScopes[language],
}])), null, 2) + '\n');
