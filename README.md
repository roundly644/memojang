# 📝 메모장 (memojang)

에버노트 스타일의 나만의 메모장. **Turso(libSQL)** 데이터베이스 + **Express** 백엔드 + **Quill** 리치 에디터로 만들었습니다.

## 기능

- 📔 노트북(폴더)로 노트 분류
- 🏷️ 태그로 노트 분류 및 필터
- ✍️ 리치 텍스트 에디터 (제목/굵게/목록/체크박스/이미지/코드 등)
- 🔍 제목·본문 전체 검색
- 📌 노트 고정 (핀)
- 🗑️ 휴지통 (이동 / 복원 / 영구삭제)
- 💾 자동 저장 (입력 후 0.8초 debounce)

## 로컬 실행

```bash
npm install
npm start          # http://localhost:3000
```

`.env` 파일에 Turso 자격증명이 필요합니다:

```
TURSO_URL=libsql://<your-db>.turso.io
TURSO_TOKEN=<your-auth-token>
```

> `.env`는 `.gitignore`에 포함되어 커밋되지 않습니다.

## Render 배포 (Blueprint)

이 저장소를 GitHub에 push하면 `render.yaml` Blueprint로 자동 배포됩니다.

1. [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**
2. 이 GitHub 저장소 연결 → `render.yaml` 자동 감지
3. 환경변수 입력 (Blueprint에서 `sync: false`로 지정되어 수동 입력):
   - `TURSO_URL`
   - `TURSO_TOKEN`
4. 배포 완료 후 이후 `git push` 할 때마다 자동 재배포 (`autoDeploy: true`)

## 기술 스택

| 구분 | 사용 기술 |
|------|-----------|
| DB | Turso (libSQL) — `@libsql/client` |
| 서버 | Node.js + Express (ESM) |
| 에디터 | Quill 2 (CDN) |
| 배포 | Render Blueprint (`render.yaml`) |

## 구조

```
memojang/
├── server.js        # Express API 서버
├── db.js            # Turso 연결 & 스키마 초기화
├── render.yaml      # Render Blueprint
├── public/
│   ├── index.html   # 3-pane 레이아웃
│   ├── styles.css
│   └── app.js       # 프론트엔드 로직
└── .env             # Turso 자격증명 (커밋 안 함)
```
