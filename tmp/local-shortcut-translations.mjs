import fs from 'node:fs';

const keys = [
  'While Last Symbol is open',
  'While editing an annotation',
  'While editing a table cell',
  'Save annotation',
  'Save cell',
  'Save and move to next cell',
  'Save and move to previous cell',
];
const translations = {
  en: keys,
  de: ['Solange „Letztes Symbol“ geöffnet ist', 'Beim Bearbeiten einer Anmerkung', 'Beim Bearbeiten einer Tabellenzelle', 'Anmerkung speichern', 'Zelle speichern', 'Speichern und zur nächsten Zelle wechseln', 'Speichern und zur vorherigen Zelle wechseln'],
  fr: ['Lorsque « Dernier symbole » est ouvert', 'Pendant la modification d’une annotation', 'Pendant la modification d’une cellule du tableau', 'Enregistrer l’annotation', 'Enregistrer la cellule', 'Enregistrer et passer à la cellule suivante', 'Enregistrer et passer à la cellule précédente'],
  es: ['Mientras «Último símbolo» esté abierto', 'Al editar una anotación', 'Al editar una celda de la tabla', 'Guardar anotación', 'Guardar celda', 'Guardar y pasar a la siguiente celda', 'Guardar y pasar a la celda anterior'],
  it: ['Quando «Ultimo simbolo» è aperto', 'Durante la modifica di un’annotazione', 'Durante la modifica di una cella della tabella', 'Salva annotazione', 'Salva cella', 'Salva e passa alla cella successiva', 'Salva e passa alla cella precedente'],
  'pt-BR': ['Enquanto “Último Símbolo” estiver aberto', 'Ao editar uma anotação', 'Ao editar uma célula da tabela', 'Salvar anotação', 'Salvar célula', 'Salvar e ir para a próxima célula', 'Salvar e ir para a célula anterior'],
  nl: ['Terwijl ‘Laatste symbool’ geopend is', 'Tijdens het bewerken van een annotatie', 'Tijdens het bewerken van een tabelcel', 'Annotatie opslaan', 'Cel opslaan', 'Opslaan en naar de volgende cel gaan', 'Opslaan en naar de vorige cel gaan'],
  pl: ['Gdy panel „Ostatni symbol” jest otwarty', 'Podczas edytowania adnotacji', 'Podczas edytowania komórki tabeli', 'Zapisz adnotację', 'Zapisz komórkę', 'Zapisz i przejdź do następnej komórki', 'Zapisz i przejdź do poprzedniej komórki'],
  tr: ['“Son Sembol” paneli açıkken', 'Ek açıklama düzenlenirken', 'Tablo hücresi düzenlenirken', 'Ek açıklamayı kaydet', 'Hücreyi kaydet', 'Kaydet ve sonraki hücreye geç', 'Kaydet ve önceki hücreye geç'],
  ru: ['Когда открыта панель «Последний символ»', 'При редактировании аннотации', 'При редактировании ячейки таблицы', 'Сохранить аннотацию', 'Сохранить ячейку', 'Сохранить и перейти к следующей ячейке', 'Сохранить и перейти к предыдущей ячейке'],
  'zh-CN': ['“最后一个符号”面板打开时', '编辑注释时', '编辑表格单元格时', '保存注释', '保存单元格', '保存并移至下一个单元格', '保存并移至上一个单元格'],
  'zh-TW': ['「最後一個符號」面板開啟時', '編輯註釋時', '編輯表格儲存格時', '儲存註釋', '儲存儲存格', '儲存並移至下一個儲存格', '儲存並移至上一個儲存格'],
  ja: ['「最後のシンボル」パネルが開いている間', '注釈の編集中', '表のセルの編集中', '注釈を保存', 'セルを保存', '保存して次のセルへ移動', '保存して前のセルへ移動'],
  ko: ['최근 종목 패널이 열려 있을 때', '주석을 편집하는 동안', '표 셀을 편집하는 동안', '주석 저장', '셀 저장', '저장하고 다음 셀로 이동', '저장하고 이전 셀로 이동'],
  id: ['Saat panel Simbol Terakhir terbuka', 'Saat mengedit anotasi', 'Saat mengedit sel tabel', 'Simpan anotasi', 'Simpan sel', 'Simpan dan pindah ke sel berikutnya', 'Simpan dan pindah ke sel sebelumnya'],
  vi: ['Khi bảng “Biểu tượng cuối cùng” đang mở', 'Khi chỉnh sửa chú thích', 'Khi chỉnh sửa ô trong bảng', 'Lưu chú thích', 'Lưu ô', 'Lưu và chuyển đến ô tiếp theo', 'Lưu và chuyển đến ô trước'],
  th: ['ขณะที่แผงสัญลักษณ์สุดท้ายเปิดอยู่', 'ขณะแก้ไขคำอธิบายประกอบ', 'ขณะแก้ไขเซลล์ในตาราง', 'บันทึกคำอธิบายประกอบ', 'บันทึกเซลล์', 'บันทึกและไปยังเซลล์ถัดไป', 'บันทึกและไปยังเซลล์ก่อนหน้า'],
  ar: ['عندما تكون لوحة «الرمز الأخير» مفتوحة', 'أثناء تحرير تعليق توضيحي', 'أثناء تحرير خلية جدول', 'حفظ التعليق التوضيحي', 'حفظ الخلية', 'حفظ والانتقال إلى الخلية التالية', 'حفظ والانتقال إلى الخلية السابقة'],
  hi: ['जब “अंतिम प्रतीक” पैनल खुला हो', 'एनोटेशन संपादित करते समय', 'तालिका के सेल को संपादित करते समय', 'एनोटेशन सहेजें', 'सेल सहेजें', 'सहेजें और अगले सेल पर जाएँ', 'सहेजें और पिछले सेल पर जाएँ'],
};

for (const [language, values] of Object.entries(translations)) {
  if (values.length !== keys.length || values.some(value => !value.trim())) throw new Error(`Incomplete ${language}`);
  const path = `src/locales/${language}/ui.json`;
  const catalog = JSON.parse(fs.readFileSync(path, 'utf8'));
  for (let index = 0; index < keys.length; index++) catalog[keys[index]] = values[index];
  fs.writeFileSync(path, JSON.stringify(catalog, null, 2) + '\n');
}
console.log(`Translated ${keys.length} labels in ${Object.keys(translations).length} languages.`);
