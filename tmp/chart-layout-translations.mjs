import fs from 'node:fs';

const keys = ['Add chart', 'Maximum {{limit}} charts are open', 'Change symbol for {{symbol}}', 'Minimize chart {{symbol}}', 'Restore chart {{symbol}}', 'Close chart {{symbol}}', 'Chart limit reached', 'Change chart symbol'];
const translations = {
  en: keys,
  de: ['Chart hinzufügen', 'Die maximale Anzahl von {{limit}} Charts ist geöffnet', 'Symbol für {{symbol}} ändern', 'Chart {{symbol}} minimieren', 'Chart {{symbol}} wiederherstellen', 'Chart {{symbol}} schließen', 'Maximale Anzahl an Charts erreicht', 'Chartsymbol ändern'],
  fr: ['Ajouter un graphique', 'Le maximum de {{limit}} graphiques est ouvert', 'Changer le symbole de {{symbol}}', 'Réduire le graphique {{symbol}}', 'Restaurer le graphique {{symbol}}', 'Fermer le graphique {{symbol}}', 'Limite de graphiques atteinte', 'Changer le symbole du graphique'],
  es: ['Añadir gráfico', 'Se ha alcanzado el máximo de {{limit}} gráficos abiertos', 'Cambiar el símbolo de {{symbol}}', 'Minimizar gráfico {{symbol}}', 'Restaurar gráfico {{symbol}}', 'Cerrar gráfico {{symbol}}', 'Límite de gráficos alcanzado', 'Cambiar símbolo del gráfico'],
  it: ['Aggiungi grafico', 'È aperto il numero massimo di {{limit}} grafici', 'Cambia il simbolo di {{symbol}}', 'Riduci a icona il grafico {{symbol}}', 'Ripristina il grafico {{symbol}}', 'Chiudi il grafico {{symbol}}', 'Limite di grafici raggiunto', 'Cambia simbolo del grafico'],
  'pt-BR': ['Adicionar gráfico', 'O máximo de {{limit}} gráficos está aberto', 'Alterar símbolo de {{symbol}}', 'Minimizar gráfico {{symbol}}', 'Restaurar gráfico {{symbol}}', 'Fechar gráfico {{symbol}}', 'Limite de gráficos atingido', 'Alterar símbolo do gráfico'],
  nl: ['Grafiek toevoegen', 'Het maximum van {{limit}} grafieken is geopend', 'Symbool voor {{symbol}} wijzigen', 'Grafiek {{symbol}} minimaliseren', 'Grafiek {{symbol}} herstellen', 'Grafiek {{symbol}} sluiten', 'Maximaal aantal grafieken bereikt', 'Grafieksymbool wijzigen'],
  pl: ['Dodaj wykres', 'Otwarto maksymalną liczbę wykresów: {{limit}}', 'Zmień symbol dla {{symbol}}', 'Minimalizuj wykres {{symbol}}', 'Przywróć wykres {{symbol}}', 'Zamknij wykres {{symbol}}', 'Osiągnięto limit wykresów', 'Zmień symbol wykresu'],
  tr: ['Grafik ekle', 'En fazla {{limit}} grafik açılabilir; sınıra ulaşıldı', '{{symbol}} için sembolü değiştir', '{{symbol}} grafiğini simge durumuna küçült', '{{symbol}} grafiğini geri yükle', '{{symbol}} grafiğini kapat', 'Grafik sınırına ulaşıldı', 'Grafik sembolünü değiştir'],
  ru: ['Добавить график', 'Открыто максимально допустимое число графиков: {{limit}}', 'Изменить символ для {{symbol}}', 'Свернуть график {{symbol}}', 'Восстановить график {{symbol}}', 'Закрыть график {{symbol}}', 'Достигнут лимит графиков', 'Изменить символ графика'],
  'zh-CN': ['添加图表', '已达到最多 {{limit}} 个图表的上限', '更改 {{symbol}} 的品种', '最小化 {{symbol}} 图表', '还原 {{symbol}} 图表', '关闭 {{symbol}} 图表', '已达到图表数量上限', '更改图表品种'],
  'zh-TW': ['新增圖表', '已達到最多 {{limit}} 個圖表的上限', '變更 {{symbol}} 的商品', '最小化 {{symbol}} 圖表', '還原 {{symbol}} 圖表', '關閉 {{symbol}} 圖表', '已達到圖表數量上限', '變更圖表商品'],
  ja: ['チャートを追加', 'チャートの上限（{{limit}} 個）に達しています', '{{symbol}} の銘柄を変更', '{{symbol}} のチャートを最小化', '{{symbol}} のチャートを元に戻す', '{{symbol}} のチャートを閉じる', 'チャート数の上限に達しました', 'チャートの銘柄を変更'],
  ko: ['차트 추가', '최대 {{limit}}개의 차트가 열려 있습니다', '{{symbol}}의 종목 변경', '{{symbol}} 차트 최소화', '{{symbol}} 차트 복원', '{{symbol}} 차트 닫기', '최대 차트 수에 도달했습니다', '차트 종목 변경'],
  id: ['Tambah grafik', 'Batas maksimum {{limit}} grafik terbuka telah tercapai', 'Ubah simbol untuk {{symbol}}', 'Minimalkan grafik {{symbol}}', 'Pulihkan grafik {{symbol}}', 'Tutup grafik {{symbol}}', 'Batas grafik tercapai', 'Ubah simbol grafik'],
  vi: ['Thêm biểu đồ', 'Đã mở tối đa {{limit}} biểu đồ', 'Đổi mã giao dịch của {{symbol}}', 'Thu nhỏ biểu đồ {{symbol}}', 'Khôi phục biểu đồ {{symbol}}', 'Đóng biểu đồ {{symbol}}', 'Đã đạt giới hạn biểu đồ', 'Đổi mã giao dịch trên biểu đồ'],
  th: ['เพิ่มกราฟ', 'เปิดกราฟครบจำนวนสูงสุด {{limit}} กราฟแล้ว', 'เปลี่ยนสัญลักษณ์ของ {{symbol}}', 'ย่อกราฟ {{symbol}}', 'คืนค่ากราฟ {{symbol}}', 'ปิดกราฟ {{symbol}}', 'เปิดกราฟถึงจำนวนสูงสุดแล้ว', 'เปลี่ยนสัญลักษณ์กราฟ'],
  ar: ['إضافة مخطط', 'تم فتح الحد الأقصى البالغ {{limit}} مخططات', 'تغيير رمز {{symbol}}', 'تصغير مخطط {{symbol}}', 'استعادة مخطط {{symbol}}', 'إغلاق مخطط {{symbol}}', 'تم بلوغ الحد الأقصى للمخططات', 'تغيير رمز المخطط'],
  hi: ['चार्ट जोड़ें', 'अधिकतम {{limit}} चार्ट खुले हैं', '{{symbol}} का प्रतीक बदलें', '{{symbol}} चार्ट छोटा करें', '{{symbol}} चार्ट पुनर्स्थापित करें', '{{symbol}} चार्ट बंद करें', 'चार्ट की सीमा पूरी हो गई है', 'चार्ट का प्रतीक बदलें'],
};

const tokens = value => [...value.matchAll(/\{\{[^}]+\}\}/g)].map(match => match[0]).sort().join('|');
for (const [language, values] of Object.entries(translations)) {
  if (values.length !== keys.length) throw new Error(`Incomplete ${language}`);
  const path = `src/locales/${language}/ui.json`;
  const catalog = JSON.parse(fs.readFileSync(path, 'utf8'));
  keys.forEach((key, index) => {
    if (!values[index] || tokens(key) !== tokens(values[index])) throw new Error(`Invalid ${language}: ${key}`);
    catalog[key] = values[index];
  });
  catalog['Add chart ({{count}}/{{limit}})'] = `${values[0]} ({{count}}/{{limit}})`;
  fs.writeFileSync(path, JSON.stringify(catalog, null, 2) + '\n');
}
console.log(`Translated ${keys.length + 1} chart layout labels in ${Object.keys(translations).length} languages; placeholders preserved.`);
