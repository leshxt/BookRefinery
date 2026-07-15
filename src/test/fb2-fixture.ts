import { strToU8, zipSync } from 'fflate'

export interface Fb2FixtureOptions {
  readonly xml?: string
  readonly zipped?: boolean
}

const DEFAULT_FB2 = `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
  <description>
    <title-info>
      <genre>science</genre>
      <author><first-name>Ada</first-name><last-name>Beispiel</last-name></author>
      <book-title>Visual FB2 Test</book-title>
      <coverpage><image l:href="#cover.png"/></coverpage>
      <lang>de</lang>
    </title-info>
  </description>
  <body>
    <section id="chapter-one">
      <title><p>Kapitel Eins</p></title>
      <p>Vor der Grafik.</p>
      <image l:href="#diagram.png" title="Entscheidungsdiagramm"/>
      <p>Nach der Grafik mit <a l:href="#note-one" type="note">einer Notiz</a>.</p>
      <section><title><p>Unterabschnitt</p></title><p>Weiterer Text.</p></section>
    </section>
  </body>
  <body name="notes">
    <section id="note-one"><title><p>Notiz eins</p></title><p>Wichtiger Notiztext.</p></section>
  </body>
  <binary id="cover.png" content-type="image/png">iVBORw0KGgo=</binary>
  <binary id="diagram.png" content-type="image/png">iVBORw0KGgo=</binary>
</FictionBook>`

export function makeFb2(options: Fb2FixtureOptions = {}): Uint8Array {
  const document = strToU8(options.xml ?? DEFAULT_FB2)
  return options.zipped ? zipSync({ 'book.fb2': document }, { level: 6 }) : document
}
