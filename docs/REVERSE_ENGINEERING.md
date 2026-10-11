# ぶらばん！（PC版）を iOS で遊べるようにした手順

所有している PC 版ディスクイメージ（`ぶらばん！_BRABAN_P.ISO`、2021年の再販版）を、個人で iPhone / iPad で遊ぶために移植した記録です。
ゲームのデータ・復号鍵・変換済み素材はこのリポジトリに含めていません。手元のディスクから毎回作り直します。

---

## 0. 全体像

```
ISO ──7-Zip──▶ XP3 アーカイブ（Hxv4 暗号）
        │
        ├─ ① ゲームを起動して復号鍵を取り出す（Frida）
        ├─ ② 鍵で全アーカイブを復号（ファイル名はハッシュのまま）
        ├─ ③ ハッシュからファイル名を復元
        ├─ ④ 画像→WebP / 音声→AAC / 動画→H.264、シナリオ→JS データ
        ├─ ⑤ HTML5 製の KAG/KAGEX 互換エンジン（game/）で再生
        └─ ⑥ SwiftUI + WKWebView の iOS アプリに同梱（WSL + xtool で未署名 IPA）
                 → LiveContainer で起動
```

| 段階 | 主なファイル |
|---|---|
| ISO 展開 | 7-Zip（`7z x`） |
| XP3 解析 | `tools/xp3.py` |
| 鍵の取り出し | `tools/dumpkey.py` + 外部の `krkr_hxv4_dumpkey.js` |
| 復号 | `tools/hxv4_extract.py`, `tools/extract_all.ps1` |
| 名前復元 | `tools/unhash.py`, `tools/unhash2.py` |
| 素材変換 | `tools/build_assets.py` |
| 静的チェック | `tools/check_scripts.js` |
| 開発サーバー | `tools/serve.js` |
| エンジン | `game/`（`index.html`, `js/*.js`, `css/style.css`） |
| iOS アプリ | `ios/`, `tools/sync_ios.sh`, `tools/dedup_package.py` |
| iPhone へ転送 | `pymobiledevice3`, `tools/push_progress.py` |

---

## 1. ISO の中身を調べる

```
7z l ぶらばん！_BRABAN_P.ISO
```

- UDF の DVD イメージ。`ぶらばん！/braban!.exe`（吉里吉里Z、`tvpwin32.exe`）と `data/scenario/bgimage/fgimage/voice/video.xp3`、`plugin/*.dll` が入っている。
- 各ファイルに `.sig`（署名）が付いている。
- PS2 版などではなく **PC 版（吉里吉里Z / KAG）** なので、iOS では吉里吉里互換の仕組みを用意してデータを読ませる方針にした。

## 2. 暗号方式の特定

`tools/xp3.py` で XP3 のインデックスを読むと、`File` チャンク以外に **`Hxv4`** チャンクがあり、ファイル名が意味のない文字列になっていた。

- 2021年11月以降の Wamsoft / 柚子ソフト系 **Hxv4** 方式。
  - インデックス本体を ChaCha20 で暗号化（key 32 byte / nonce）。
  - 中身は CX 系のフィルタ（filterkey / mask / offset / randtype / 並び順 / 4KB の control block）。
  - ファイル名とディレクトリ名はハッシュ化（後述）。
- exe の PE リソースに `BOOTSTRAP` は無く（それより新しい世代の方式ではない）、鍵は実行時に読み込まれる `krkr_*.dll` の中で使われる。

参考にした公開資料：

- [YuriSizuku/GalgameReverse](https://github.com/YuriSizuku/GalgameReverse) の `project/krkr/src/`（`krkr_hxv4_dumpkey.js`, `krkr_xp3_hxv4.py`, `krkr_hxcrypt.py`, `krkr_hxv4_hash.py`）
- [crskycode/GARbro](https://github.com/crskycode/GARbro) の `HxCrypt.cs`（上記スクリプトの元）

## 3. 鍵を取り出す（Frida）

ゲーム本体（Windows）を Frida 付きで起動し、`krkr_*.dll` が読み込まれた時点で復号関数にフックして鍵を表示させる。

```powershell
python -m venv venv
venv\Scripts\pip install frida-tools pycryptodome siphash pillow
& venv\Scripts\python.exe tools\dumpkey.py "<ゲームの>\braban!.exe" "<GalgameReverse>\project\krkr\src\krkr_hxv4_dumpkey.js" 25
```

- 出力の `key / nonce / filterkey / mask / offset / randtype / PrologOrder / OddBranchOrder / EvenBranchOrder` を `keys/params.txt` に保存し、ゲームのフォルダにできる `control_block.bin` を `keys/` へ移す。
- **鍵はこのゲーム専用の値なので、リポジトリには入れていない**（`keys/` は .gitignore 済み）。
- PowerShell では、引用符で囲んだパスを実行するときに先頭の `&` が必要（無いと構文エラーになる）。

## 4. 全アーカイブを復号する

`tools/hxv4_extract.py` は、GalgameReverse の `krkr_xp3_hxv4.py` を読み込み、遅い1バイトずつの XOR を整数演算に置き換えたもの。6つのアーカイブを並列に処理する。

```powershell
powershell -ExecutionPolicy Bypass -File tools\extract_all.ps1
```

- 出力は `out/<アーカイブ>/<dirhash>/<filehash>` と `out/<アーカイブ>/index.tsv`。
- 中身は平文になる：シナリオは UTF-16LE の `.ks`、画像は PNG（TLG ではない）、音声は Ogg Vorbis、動画は MPEG-1。
- PowerShell 5.1 は BOM なし UTF-8 のスクリプト中の日本語を読み違えるので、`.ps1` は ASCII だけで書く。

## 5. ファイル名を復元する

Hxv4 のハッシュ（seed は `xp3hnp`）：

- ファイル名：`blake2s(utf16le(名前) + utf16le("xp3hnp"), digest_size=32)`
- ディレクトリ：`SipHash-2-4(key=0x00×16, utf16le(パス) + utf16le("xp3hnp"))`（例：ルートは `""`、`"bgm/"` など）

1. `tools/unhash.py`：復号したスクリプト・TJS・CSV に出てくる語を集め、拡張子を付けて総当たり。
2. `tools/unhash2.py`：`envinit.tjs`（KAGEX の定義）の規則で総当たり。
   - ボイス：`voiceFile`（例 `tae%06d%s.ogg`）× 0〜999999 → **14,208 件すべて**
   - 立ち絵：`<名前>_<レベル>_<服>_<表情>`（例 `tae_0_0_01`、レベルは 0/1/2/f）
   - 背景：`BG01TIME` の `TIME` を A/B/C/D（昼/夕/夜/室内）に置換
3. 結果は `out/names.tsv`。最終的に約97%を復元。残りは PC 版メニュー用の UI 部品と、シナリオから参照されない立ち絵で、移植には不要だった。
   - 名前が分からなかったルール画像1枚は、見た目（縞模様）から `kosuri` トランジション用と判断して割り当てた。

## 6. 素材を変換する

```
venv\Scripts\python.exe -I tools\build_assets.py          # 全部（冪等）
venv\Scripts\python.exe -I tools\build_assets.py --only data
```

- 画像：PNG → WebP（品質90、アルファ維持）
- 音声：Ogg → AAC `.m4a`（ボイス 64kbps モノラル、BGM・効果音 128kbps）。iOS の WebKit で確実に再生できる形式にするため。
- 動画：MPEG-1 → H.264 `.mp4`
- BGM のループ位置：`bgmXX.ogg.sli`（`Link { From=…; To=…; }`）を `LOOPS` に変換
- シナリオ・TJS：`game/data/scripts.js`、名前→ファイルの対応表：`game/data/manifest.js`
- 合計で約1GB（画像177MB・音声709MB・動画132MB）

## 7. HTML5 エンジン（game/）

元のエンジン（吉里吉里Z）は移植せず、**ゲームが使っている範囲の KAG / KAGEX を JavaScript で再実装**した。演出の挙動は、データに入っていた `world.ks`（KAGEX のキャラ・背景・イベントCG・トランジション）をそのまま移植している。

| ファイル | 役割 |
|---|---|
| `js/tjs.js` | `envinit.tjs` の TJS2 リテラル（`%[ ]` 辞書など）を読むパーサー |
| `js/ks.js` | `.ks` パーサー。`【名前/表示名】` 行・行末クリック待ち（linemode page）・マクロ・iscript |
| `js/vm.js` | 実行器。if/else、call/jump、式評価、セーブ/ロード、既読、スキップ/オート |
| `js/env.js` | `world.ks` の移植（キャラ・舞台・時間帯の色補正・独立レイヤ・イベントCG・ボイス） |
| `js/render.js` | canvas 合成、移動/フェード、アクションモジュール、トランジション（crossfade / ルール画像 / mosaic）、画面揺れ |
| `js/audio.js` | ブラウザでは Web Audio、iOS アプリ内ではネイティブにコマンドを送る |
| `js/ui.js` | メッセージ窓、選択肢、マップ選択、タイトル（sakura.ks の桜を移植）、セーブ/ロード、設定、バックログ、iPhone 向けレイアウト |

ハマりどころ：

- KAG のタグ名・属性名は ASCII だけ小文字化する（JS の `toLowerCase` は全角Ａも小文字にしてしまい、`[男子部員Ａ]` が別名になる）。`[EV]` は `ev`（イベントCG）として扱われる。
- タグの属性は**順序つき配列**で持つ（`[妙 中 前 制服 11 fade]` のように順番に意味がある。JS のオブジェクトだと `"11"` などの数字キーが先頭に並び替わる）。
- `canskip=&"sf[ tf.moviename ]"` のような `&"…"` 形式の値がある。
- `practice.ks`（指導モード）の `iscript` は手で JS に移植した。
- 桜の画像 `sakuraall.png` は **75px × 60コマ**。20ms ごとにコマ送り（50px と誤解するとちらつく）。

### 検証

```
node tools\check_scripts.js     # 全32シナリオのジャンプ先・ラベル・素材・ボイスの欠けを確認
node tools\serve.js 8765        # http://localhost:8765/ で動作確認
```

- `?jump=03.ks` で途中から開始、`?autotest=妙` で選択肢を自動で選びながら最後まで通しプレイ。
- 開発サーバーに Python の `http.server` を使うと、待ち行列が小さく並列リクエストで接続が切れる（画像が途中までしか届かない）。Node 版を使う。

## 8. iOS アプリ（ios/）

- SwiftUI + `WKWebView`。ゲームは独自スキーム `app://game/…` で配信し、動画のシーク用に HTTP Range に対応（`GameView.swift`）。
- セーブデータは `Documents/save/*.json` に保存し、起動時にページへ注入。
- **音声はネイティブ（AVAudioEngine）で再生**（`AudioBridge.swift`）。WebView の Web Audio は画面オフ・割り込みのあと無音になったため、普通のゲームと同じ仕組みにした。
  - ファイルは少しずつ読み出して再生し、BGM のループ区間は継ぎ目なく繰り返す。
  - 画面オフ・アプリ切り替え・ホームでは一時停止し、戻ると続きから。
  - 通知センター表示中は設定に従って鳴らし続ける。下端からのスワイプ（アプリ切り替え）は `EdgeGestureRecorder.swift` で見分けて止める。
- アプリ切り替え画面・ホームに移ったら、**ゲーム自体も一時停止**する（`window.__gamePause`）。描画の時計（`Render.clock`）を止め、`wait`・オート・文字送り・動画も止まった所から再開する。
- アプリアイコン（`Assets.xcassets/AppIcon.appiconset/AppIcon.png`）はゲームの絵から作ったため、リポジトリには入れていない。1024×1024 の PNG を各自で置く。

### ビルド（Mac なし、Windows + WSL）

WSL の Arch Linux に Swift 6.4 / xtool / Apple SDK（Xcode 27 から生成）を用意した環境で、`wsl-swift-ipa` スキルの `build_ipa.py` を使う。

```bash
bash tools/sync_ios.sh --full      # ios/ と game/ を ~/braban-ios へ（2回目からは --full なしでコードだけ）
python3 <skill>/scripts/build_ipa.py --project ~/braban-ios --output-dir ~/braban-ipa --bundle-id local.braban.player
python3 tools/dedup_package.py ~/braban-ios ~/braban-ipa/<run>/Braban-unsigned-dedup.ipa
```

- `ship.sh` はリソースバンドルの中身をアプリ直下にもコピーするため、`Game/` が二重に入り IPA が2GBになる。`dedup_package.py` でバンドル側を消して再パッケージする（約1.0GB）。
- Git Bash から WSL を呼ぶときは `MSYS_NO_PATHCONV=1` を付ける。

## 9. iPhone へ送る

未署名 IPA を、AltStore で入れた **LiveContainer** の書類フォルダへ USB で送り、LiveContainer の「＋」から読み込む。

```bash
MSYS_NO_PATHCONV=1 venv/Scripts/pymobiledevice3 apps push --documents com.kdt.livecontainer.<TEAMID> dist/Braban-unsigned.ipa /Documents/Braban-unsigned.ipa
MSYS_NO_PATHCONV=1 venv/Scripts/python.exe -u tools/push_progress.py com.kdt.livecontainer.<TEAMID> /Documents/Braban-unsigned.ipa dist/Braban-unsigned.ipa
```

- Git Bash は `/Documents/…` を `C:/Program Files/Git/Documents/…` に書き換えてしまうので、`MSYS_NO_PATHCONV=1` が必須。
- 転送を途中で止めると、iPhone 側のファイル共有（house_arrest）が全アプリで応答しなくなることがあった。残ったプロセスを止め、USB を挿し直すと直った。転送コマンドには `timeout` を付ける。

## 10. 注意

- 個人で所有しているゲームを自分で遊ぶための記録です。ゲームのデータ、復号鍵、変換済み素材、それらを含む IPA は配布しないでください。
- このリポジトリのコード（`tools/`, `game/js` など）は移植のために書いたもので、ゲームの著作物は含みません。
